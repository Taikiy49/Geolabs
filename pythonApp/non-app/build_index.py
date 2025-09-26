#!/usr/bin/env python3
"""
Build / update SQLite FTS5 index for reports.

Usage:
  python build_index.py --jsonl-dir ./processed_reports --db ../data/reports_index.db
  python build_index.py --jsonl latest
  python build_index.py --rebuild
"""
import argparse, hashlib, json, os, sqlite3, sys, time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  filename TEXT,
  s3_key TEXT,
  project TEXT,
  date TEXT,
  title TEXT,
  content_hash TEXT,
  created_ts INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  content='',
  tokenize='unicode61'
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project);
"""

def connect(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript(SCHEMA)
    return conn

def content_hash(text: str):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:40]

def ingest_jsonl(conn, jsonl: Path, verbose=False):
    added = 0
    with jsonl.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            rid = rec["id"]
            ch = content_hash(rec.get("text") or "")
            cur = conn.execute("SELECT content_hash FROM reports WHERE id=?", (rid,)).fetchone()
            if cur and cur[0] == ch:
                continue  # unchanged
            conn.execute(
                "REPLACE INTO reports (id, filename, s3_key, project, date, title, content_hash, created_ts) VALUES (?,?,?,?,?,?,?,?)",
                (
                    rid,
                    rec.get("filename"),
                    rec.get("s3_key"),
                    rec.get("project"),
                    rec.get("date"),
                    rec.get("title"),
                    ch,
                    int(time.time()),
                ),
            )
            conn.execute("DELETE FROM reports_fts WHERE id=?", (rid,))
            conn.execute(
                "INSERT INTO reports_fts (rowid, id, title, body) VALUES ((SELECT rowid FROM reports WHERE id=?),?,?,?)",
                (rid, rec.get("title") or "", rec.get("title") or "", rec.get("text") or ""),
            )
            added += 1
    conn.commit()
    if verbose:
        print(f"Ingested {added} new/updated rows from {jsonl.name}")
    return added

def rebuild(conn):
    conn.execute("DELETE FROM reports_fts;")
    # Reinsert from stored content (not stored full text -> can't, so recommend full rebuild from JSONL)
    # Implement full purge only.
    conn.commit()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl-dir", default="./processed_reports")
    ap.add_argument("--db", default="../data/reports_index.db")
    ap.add_argument("--jsonl", help="'latest' or explicit file", default=None)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    db_path = Path(args.db).resolve()
    conn = connect(db_path)

    if args.rebuild:
        rebuild(conn)

    jsonl_dir = Path(args.jsonl_dir)
    if args.jsonl == "latest":
        files = sorted(jsonl_dir.glob("reports_*.jsonl"))
        if not files:
            print("No JSONL files.", file=sys.stderr)
            return
        ingest_jsonl(conn, files[-1], verbose=args.verbose)
    elif args.jsonl:
        ingest_jsonl(conn, Path(args.jsonl), verbose=args.verbose)
    else:
        for f in sorted(jsonl_dir.glob("reports_*.jsonl")):
            ingest_jsonl(conn, f, verbose=args.verbose)

    total = conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]
    print(f"Index ready: {total} documents")

if __name__ == "__main__":
    main()
     