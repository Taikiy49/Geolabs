#!/usr/bin/env python3
# geolabs_search_verbose.py
#
# UNC filename search for \\geolabs.lan\fs with incremental indexing + VERY VERBOSE LOGGING.
# - First run: full index into a local SQLite DB (WAL).
# - Subsequent runs: fast incremental scan using per-directory mtime pruning.
# - Parallel processing of changed directories (ThreadPoolExecutor).
# - Logs: every step (dirs seen, changed/unchanged, files upserted, files purged, timings, thread names).
#
# Usage (interactive prompt):
#   python geolabs_search_verbose.py
#
# Admin / scheduled:
#   python geolabs_search_verbose.py index            # incremental
#   python geolabs_search_verbose.py index --full     # full rescan
#   python geolabs_search_verbose.py index --quiet    # less noisy
#
# Search examples:
#   python geolabs_search_verbose.py search 8120 --ext pdf
#   python geolabs_search_verbose.py search 8120 --ext pdf --startswith
#   python geolabs_search_verbose.py search "^8120.*\\.pdf$" --regex
#
# DB location (override with GEOSEARCH_DB):
#   %USERPROFILE%\geosearch.db (Windows) or ~/geosearch.db

import argparse
import os
import re
import sqlite3
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Iterable, Iterator, List, Optional, Tuple

# ----------------------------
# Config
# ----------------------------
ROOT = r"\\geolabs.lan\fs"  # ONLY this root

DB_FILE = os.environ.get("GEOSEARCH_DB", os.path.join(os.path.expanduser("~"), "geosearch.db"))
DEFAULT_WORKERS = max(8, (os.cpu_count() or 8) * 2)

SQL_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ext  TEXT,
    size INTEGER,
    mtime REAL
);
CREATE INDEX IF NOT EXISTS idx_name ON files(name);
CREATE INDEX IF NOT EXISTS idx_ext ON files(ext);
CREATE INDEX IF NOT EXISTS idx_mtime ON files(mtime);

-- Track directory mtimes to skip unchanged subtrees on subsequent runs
CREATE TABLE IF NOT EXISTS dirs (
    path TEXT PRIMARY KEY,
    mtime REAL
);
"""

# ----------------------------
# Logging (thread-safe, verbose by default)
# ----------------------------
_print_lock = threading.Lock()
VERBOSE = True

def vlog(msg: str):
    if not VERBOSE:
        return
    with _print_lock:
        tname = threading.current_thread().name
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [{tname}] {msg}", flush=True)

def ilog(msg: str):
    # Always-important logs (shown even in quiet mode)
    with _print_lock:
        tname = threading.current_thread().name
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [{tname}] {msg}", flush=True)

# ----------------------------
# DB helpers
# ----------------------------
def get_conn(db_path: str = DB_FILE) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA case_sensitive_like = OFF;")
    conn.create_function("REGEXP", 2, lambda expr, item: 1 if item and re.search(expr, item, re.IGNORECASE) else 0)
    return conn

def ensure_schema(conn: sqlite3.Connection):
    for stmt in SQL_SCHEMA.strip().split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s + ";")
    conn.commit()

# ----------------------------
# Indexing
# ----------------------------
@dataclass
class FileRec:
    path: str
    name: str
    ext: str
    size: int
    mtime: float

def chunked(iterable: Iterable, size: int):
    chunk = []
    for item in iterable:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk

def upsert_files(conn: sqlite3.Connection, recs: List[FileRec]):
    if not recs:
        return
    conn.executemany(
        "INSERT INTO files(path,name,ext,size,mtime) VALUES(?,?,?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET name=excluded.name, ext=excluded.ext, size=excluded.size, mtime=excluded.mtime;",
        [(r.path, r.name, r.ext, r.size, r.mtime) for r in recs],
    )
    for r in recs:
        vlog(f"UPSERT file: {r.path} (ext={r.ext or '-'} size={r.size} mtime={r.mtime})")

def upsert_dir_mtime(conn: sqlite3.Connection, dpath: str, mtime: float):
    conn.execute(
        "INSERT INTO dirs(path, mtime) VALUES(?, ?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime;",
        (dpath, mtime),
    )
    vlog(f"DIR mtime snapshot saved: {dpath} -> {mtime}")

def get_dir_mtime(conn: sqlite3.Connection, dpath: str) -> Optional[float]:
    cur = conn.execute("SELECT mtime FROM dirs WHERE path = ?", (dpath,))
    row = cur.fetchone()
    return row[0] if row else None

def iter_changed_dirs(root: str, conn: sqlite3.Connection, full: bool) -> Iterator[Tuple[str, float, bool]]:
    """
    Yields (dir_path, dir_mtime, changed_flag)
    If full=True, every directory is yielded as changed.
    Otherwise, compare current dir mtime to stored and mark changed=True only if different/new.
    """
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            stat = os.stat(d)
            d_mtime = stat.st_mtime
        except (PermissionError, FileNotFoundError) as e:
            vlog(f"SKIP dir (stat error): {d} ({e})")
            continue

        if full:
            changed = True
            vlog(f"DIR seen (FULL mode, marked changed): {d}")
        else:
            prev = get_dir_mtime(conn, d)
            changed = (prev is None) or (abs(prev - d_mtime) > 1e-6)
            if changed:
                vlog(f"DIR changed: {d} (prev={prev}, now={d_mtime})")
            else:
                vlog(f"DIR unchanged (prune subtree): {d} (prev={prev}, now={d_mtime})")

        yield d, d_mtime, changed

        # descend only if full or dir changed
        if full or changed:
            try:
                with os.scandir(d) as it:
                    for entry in it:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
            except (PermissionError, FileNotFoundError) as e:
                vlog(f"SKIP descend (scandir error): {d} ({e})")

def scan_dir_files(d: str) -> Iterator[FileRec]:
    vlog(f"SCAN files in dir: {d}")
    try:
        with os.scandir(d) as it:
            for entry in it:
                try:
                    if entry.is_file(follow_symlinks=False):
                        try:
                            st = entry.stat(follow_symlinks=False)
                        except PermissionError as e:
                            vlog(f"SKIP file (stat denied): {entry.path} ({e})")
                            continue
                        p = entry.path
                        name = entry.name
                        ext = os.path.splitext(name)[1][1:].lower()
                        vlog(f"FOUND file: {p} (ext={ext or '-'} size={st.st_size} mtime={st.st_mtime})")
                        yield FileRec(p, name, ext, st.st_size, st.st_mtime)
                except PermissionError as e:
                    vlog(f"SKIP entry (permission): {getattr(entry, 'path', '<unknown>')} ({e})")
    except (PermissionError, FileNotFoundError) as e:
        vlog(f"SKIP dir (open error): {d} ({e})")

def purge_missing_under(conn: sqlite3.Connection, dir_path: str) -> int:
    """Delete file rows under dir_path that no longer exist."""
    like = dir_path.rstrip("\\/") + "%"
    cur = conn.execute("SELECT path FROM files WHERE path LIKE ?", (like,))
    to_check = [row[0] for row in cur.fetchall()]
    if not to_check:
        vlog(f"PURGE none (no rows under): {dir_path}")
        return 0
    removed = 0
    for p in to_check:
        if not os.path.exists(p):
            conn.execute("DELETE FROM files WHERE path = ?", (p,))
            removed += 1
            vlog(f"PURGE removed missing: {p}")
    return removed

def index_incremental(root: str, workers: int = DEFAULT_WORKERS, full: bool = False, db_path: str = DB_FILE):
    start = time.time()
    ilog(f"INDEX start: root={root}  mode={'FULL' if full else 'INCREMENTAL'}  workers={workers}  db={db_path}")

    total_files = 0
    total_dirs = 0
    changed_dirs: List[Tuple[str, float]] = []

    with get_conn(db_path) as conn:
        ensure_schema(conn)

        # 1) Collect dirs + changed flags (single-threaded to consult DB)
        ilog("COLLECT pass: walking directories and comparing mtimes…")
        for d, d_mtime, changed in iter_changed_dirs(root, conn, full):
            total_dirs += 1
            if changed:
                changed_dirs.append((d, d_mtime))

        ilog(f"COLLECT done: dirs_total={total_dirs}, dirs_to_update={len(changed_dirs)}")

        # 2) Scan changed dirs in parallel, upsert files, purge deletions, update dir mtimes
        def process_dir(d_and_m):
            d, d_mtime = d_and_m
            t0 = time.time()
            vlog(f"PROCESS dir begin: {d}")
            count = 0
            purged = 0
            with get_conn(db_path) as c2:
                # Upsert files in batches
                batch = []
                for rec in scan_dir_files(d):
                    batch.append(rec)
                    if len(batch) >= 500:
                        upsert_files(c2, batch)
                        count += len(batch)
                        vlog(f"UPSERT batch: {len(batch)} files (dir={d})")
                        batch.clear()
                if batch:
                    upsert_files(c2, batch)
                    count += len(batch)
                    vlog(f"UPSERT batch: {len(batch)} files (final batch for {d})")

                # Purge deleted files under this dir
                purged = purge_missing_under(c2, d)

                # Update dir mtime snapshot
                upsert_dir_mtime(c2, d, d_mtime)
                c2.commit()

            t1 = time.time()
            vlog(f"PROCESS dir end: {d}  upserts={count}  purged={purged}  took={t1-t0:.3f}s")
            return count

        if changed_dirs:
            ilog("PARALLEL phase: processing changed directories…")
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = {ex.submit(process_dir, dm): dm[0] for dm in changed_dirs}
                for fut in as_completed(futs):
                    d = futs[fut]
                    try:
                        cnt = fut.result()
                        total_files += cnt
                        ilog(f"DIR done: {d}  files_upserted={cnt}")
                    except Exception as e:
                        ilog(f"ERROR scanning {d}: {e}")
        else:
            ilog("No changed directories. Index is already up-to-date.")

    dur = time.time() - start
    ilog(f"INDEX done: mode={'FULL' if full else 'INCREMENTAL'}  dirs_updated={len(changed_dirs)}  files_upserted={total_files}  time={dur:.2f}s")

# ----------------------------
# Searching
# ----------------------------
def search_db(query: str, ext: Optional[str], regex: bool, startswith: bool, limit: int):
    with get_conn(DB_FILE) as conn:
        ensure_schema(conn)
        wheres = []
        params = []

        if regex:
            wheres.append("name REGEXP ?")
            params.append(query)
            ilog(f"SEARCH using REGEX: {query}")
        elif startswith:
            wheres.append("name LIKE ?")
            params.append(query + "%")
            ilog(f"SEARCH startswith: {query}%")
        else:
            wheres.append("name LIKE ?")
            params.append(f"%{query}%")
            ilog(f"SEARCH contains: %{query}%")

        if ext:
            wheres.append("ext = ?")
            params.append(ext.lower())
            ilog(f"FILTER ext: .{ext.lower()}")

        wheres.append("path LIKE ?")
        params.append(ROOT.rstrip("\\/") + "%")

        sql = (
            "SELECT path, size, datetime(mtime, 'unixepoch') AS modified "
            "FROM files WHERE " + " AND ".join(wheres) +
            " ORDER BY mtime DESC LIMIT ?"
        )
        params.append(limit)

        ilog(f"SQL: {sql}")
        vlog(f"PARAMS: {params}")

        t0 = time.time()
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        t1 = time.time()

        for p, size, mod in rows:
            print(f"{p} ({size} bytes)  [modified {mod}]", flush=True)
        ilog(f"RESULTS: {len(rows)}  query_time={t1-t0:.3f}s")

# ----------------------------
# Prompt app (interactive)
# ----------------------------
def ensure_index_ready(full_first: bool = True, workers: int = DEFAULT_WORKERS):
    with get_conn(DB_FILE) as conn:
        ensure_schema(conn)
        cur = conn.execute("SELECT COUNT(1) FROM files WHERE path LIKE ?", (ROOT.rstrip('\\/') + "%",))
        cnt = cur.fetchone()[0]
    if cnt == 0:
        ilog(f"[setup] No index for {ROOT}. Building initial {'FULL' if full_first else 'INCREMENTAL'} index…")
        index_incremental(ROOT, full=full_first, workers=workers)
        ilog("[setup] Initial index complete.")
    else:
        ilog(f"[ready] Existing index with {cnt} files under {ROOT}. Incremental updates will be fast.")

def prompt_loop():
    print(f"\nRoot: {ROOT}")
    print("Type a filename to search (e.g., 8120).")
    print("Optional extension filter (e.g., pdf). Press Enter on an empty line to quit.\n")
    while True:
        try:
            q = input("Search text: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n[exit]")
            break
        if not q:
            print("[bye]")
            break

        ext = input("Extension (e.g., pdf) [Enter to skip]: ").strip().lower()
        starts = input("Match start only? (y/N): ").strip().lower() == "y"

        regex = False
        if q.startswith("^") or any(ch in q for ch in ".*[]()|?+"):
            ans = input("Treat as regex? (y/N): ").strip().lower()
            regex = (ans == "y")

        limit = 200
        lim_in = input("Max results [200]: ").strip()
        if lim_in.isdigit():
            limit = int(lim_in)

        print("\n--- results ---")
        search_db(q, ext or None, regex, starts, limit)
        print("--------------\n")

# ----------------------------
# CLI
# ----------------------------
def cli():
    global VERBOSE
    ap = argparse.ArgumentParser(description="GeoLabs UNC filename indexer & search (verbose, parallel) for \\\\geolabs.lan\\fs.")
    sub = ap.add_subparsers(dest="cmd")

    p_index = sub.add_parser("index", help="Incremental index (default). Use --full for full rescan.")
    p_index.add_argument("--full", action="store_true", help="Force full rescan (ignore dir mtime pruning).")
    p_index.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Scanning threads (default: CPU*2)")
    p_index.add_argument("--quiet", action="store_true", help="Reduce logging verbosity.")

    p_search = sub.add_parser("search", help="Search indexed filenames quickly.")
    p_search.add_argument("query", nargs="?", help="Text to search (use --regex for regex).")
    p_search.add_argument("--ext", help="Extension filter, e.g. pdf, docx")
    p_search.add_argument("--startswith", action="store_true", help="Match at the start of filename.")
    p_search.add_argument("--regex", action="store_true", help="Treat query as a regex (case-insensitive).")
    p_search.add_argument("--limit", type=int, default=200, help="Max results to show.")
    p_search.add_argument("--quiet", action="store_true", help="Reduce logging verbosity.")

    # no subcommand -> interactive prompt (will index on first run if needed)
    args = ap.parse_args()

    if args.cmd == "index":
        VERBOSE = not args.quiet
        index_incremental(ROOT, workers=args.workers, full=args.full, db_path=DB_FILE)
        return
    elif args.cmd == "search":
        VERBOSE = not args.quiet
        if not args.query:
            print("Provide a query (e.g., 8120) or run without subcommand for the interactive prompt.")
            sys.exit(1)
        search_db(args.query, args.ext, args.regex, args.startswith, args.limit)
        return
    else:
        # interactive
        VERBOSE = True
        ensure_index_ready(full_first=True, workers=DEFAULT_WORKERS)
        prompt_loop()

if __name__ == "__main__":
    cli()
