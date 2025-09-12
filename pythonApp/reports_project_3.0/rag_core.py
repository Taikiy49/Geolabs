# rag_core.py
# retrieval-augmented generation core
# ------------------------------------------------------------
# Robust local RAG core for plain-text reports (no web server).
# ------------------------------------------------------------

import os
import re
import glob
import time
import math
import sqlite3
import argparse
from typing import List, Tuple, Dict, Any, Optional

import numpy as np
from tqdm import tqdm
from dotenv import load_dotenv

# ---- Gemini client (embeddings + answers) ----
try:
    import google.generativeai as genai
except Exception:
    genai = None

GEMINI_EMBED_MODEL = "text-embedding-004"   # 768-dim
GEMINI_CHAT_MODEL  = "gemini-2.5-pro"       # or "gemini-1.5-pro"

# ---- Paths / DB ----
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
DB_PATH = os.path.join(UPLOADS_DIR, "reports.db")

# ---- Debug flag ----
DEBUG = bool(int(os.getenv("RAG_DEBUG", "0")))
def dprint(*args):
    if DEBUG:
        print("[DEBUG]", *args, flush=True)

# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------
def log(msg: str) -> None:
    print(msg, flush=True)

def need_key():
    if genai is None:
        raise RuntimeError("google-generativeai is not installed. `pip install google-generativeai`")
    load_dotenv()
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set in environment.")
    genai.configure(api_key=key)

def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def normalize_text(s: str) -> str:
    s = s.replace("\r", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def _extract_terms(q: str, max_terms: int = 8) -> List[str]:
    terms = re.findall(r"[A-Za-z0-9]+", q)
    terms = [t for t in terms if len(t) >= 2]
    seen, out = set(), []
    for t in terms:
        tl = t.lower()
        if tl not in seen:
            seen.add(tl); out.append(t)
        if len(out) >= max_terms:
            break
    dprint("extract_terms:", out)
    return out

def _fts_query_variants(q: str) -> List[str]:
    terms = _extract_terms(q)
    or_query = " OR ".join(terms) if terms else q
    variants = [q, or_query]
    dprint("fts_query_variants:", variants)
    return variants

def words(s: str) -> List[str]:
    return re.findall(r"\S+", s)

def chunk_text(text: str, target_words: int = 220, overlap_words: int = 60) -> Tuple[List[str], List[Tuple[int,int]]]:
    w = words(text)
    if not w:
        return [], []
    chunks, spans = [], []
    start_i = 0
    while start_i < len(w):
        end_i = min(len(w), start_i + target_words)
        seg_words = w[start_i:end_i]
        prefix_words = w[:start_i]
        start_char = len(" ".join(prefix_words))
        if start_char > 0:
            start_char += 1
        chunk_text_ = " ".join(seg_words)
        end_char = start_char + len(chunk_text_)
        chunks.append(chunk_text_)
        spans.append((start_char, end_char))
        if end_i == len(w):
            break
        start_i = max(0, end_i - overlap_words)
    return chunks, spans

def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    return float(np.dot(a, b))

# ------------------------------------------------------------
# DB setup / connections
# ------------------------------------------------------------
def get_conn(db_path: str = DB_PATH) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA mmap_size=30000000000;")
    return conn

def ensure_db(db_path: str = DB_PATH) -> None:
    with get_conn(db_path) as conn:
        c = conn.cursor()
        c.execute("""
        CREATE TABLE IF NOT EXISTS files(
          file_id    INTEGER PRIMARY KEY AUTOINCREMENT,
          file       TEXT UNIQUE,
          size_bytes INTEGER,
          mtime      REAL
        )""")
        c.execute("""
        CREATE TABLE IF NOT EXISTS chunks(
          file_id    INTEGER,
          chunk_id   INTEGER,
          start_char INTEGER,
          end_char   INTEGER,
          text       TEXT,
          embedding  BLOB,
          PRIMARY KEY(file_id, chunk_id)
        )""")
        c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          file_id UNINDEXED,
          chunk_id UNINDEXED,
          content=''
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)")
        conn.commit()

# ------------------------------------------------------------
# File tracking / idempotency
# ------------------------------------------------------------
def upsert_file(conn: sqlite3.Connection, path: str) -> Tuple[int, bool]:
    st = os.stat(path)
    base = os.path.basename(path)
    cur = conn.cursor()
    cur.execute("SELECT file_id, size_bytes, mtime FROM files WHERE file=?", (base,))
    row = cur.fetchone()
    if row and row["size_bytes"] == st.st_size and abs(row["mtime"] - st.st_mtime) < 1e-6:
        dprint(f"upsert_file: unchanged {base}")
        return row["file_id"], False
    if row:
        file_id = row["file_id"]
        dprint(f"upsert_file: updating {base}")
        cur.execute("UPDATE files SET size_bytes=?, mtime=? WHERE file_id=?", (st.st_size, st.st_mtime, file_id))
        cur.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
        cur.execute("DELETE FROM chunks_fts WHERE file_id=?", (file_id,))
    else:
        dprint(f"upsert_file: inserting {base}")
        cur.execute("INSERT INTO files(file,size_bytes,mtime) VALUES(?,?,?)", (base, st.st_size, st.st_mtime))
        file_id = cur.lastrowid
    conn.commit()
    return file_id, True

# ------------------------------------------------------------
# Embeddings (Gemini) with retry/backoff and progress
# ------------------------------------------------------------
def embed_texts_gemini(texts: List[str], retries: int = 4, backoff: float = 1.6, sleep_between: float = 0.0) -> np.ndarray:
    need_key()
    vecs: List[np.ndarray] = []
    pbar = tqdm(total=len(texts), desc="Embedding", unit="chunk", disable=not DEBUG)
    for idx, t in enumerate(texts):
        content = (t or "").strip()
        if not content:
            vecs.append(np.zeros((768,), dtype=np.float32))
            pbar.update(1)
            continue
        attempt, wait = 0, 0.8
        while True:
            try:
                emb = genai.embed_content(model=GEMINI_EMBED_MODEL, content=content)
                v = np.array(emb["embedding"], dtype=np.float32)
                vecs.append(v)
                break
            except KeyboardInterrupt:
                pbar.close()
                raise
            except Exception as e:
                attempt += 1
                dprint(f"embed idx={idx} attempt={attempt} error={e}")
                if attempt > retries:
                    log(f"  ⚠️  embed failed after {retries} retries; inserting zero vector. Error: {e}")
                    vecs.append(np.zeros((768,), dtype=np.float32))
                    break
                time.sleep(wait)
                wait *= backoff
        if sleep_between > 0:
            time.sleep(sleep_between)
        pbar.update(1)
    pbar.close()
    return np.vstack(vecs)

def embed_query_gemini(q: str) -> np.ndarray:
    dprint("embed_query:", q)
    return embed_texts_gemini([q])[0]

# ------------------------------------------------------------
# Indexing
# ------------------------------------------------------------
def index_text_file(path: str, db_path: str = DB_PATH, *, embed: bool = True,
                    target_words: int = 220, overlap: int = 60) -> Tuple[int, int]:
    ensure_db(db_path)
    txt = normalize_text(read_text(path))
    chunks, spans = chunk_text(txt, target_words, overlap)
    dprint(f"index_text_file: {os.path.basename(path)} chunks={len(chunks)} embed={embed}")
    if not chunks:
        return 0, 0

    with get_conn(db_path) as conn:
        file_id, changed = upsert_file(conn, path)
        if not changed:
            return 0, 0

        vecs = None
        if embed:
            log(f"  🧠 Embedding {len(chunks)} chunk(s)...")
            vecs = embed_texts_gemini(chunks)

        cur = conn.cursor()
        for i, (ch, (st, en)) in enumerate(zip(chunks, spans)):
            emb_blob = None
            if vecs is not None:
                emb_blob = vecs[i].astype(np.float32).tobytes()
            cur.execute("""INSERT OR REPLACE INTO chunks(file_id, chunk_id, start_char, end_char, text, embedding)
                           VALUES(?,?,?,?,?,?)""",
                        (file_id, i, st, en, ch, emb_blob))
            cur.execute("""INSERT INTO chunks_fts(text, file_id, chunk_id) VALUES(?,?,?)""",
                        (ch, file_id, i))
        conn.commit()
    return 1, len(chunks)

def bulk_index_folder(folder: str, db_path: str = DB_PATH, *, embed: bool = True,
                      pattern: str = "*.txt", target_words: int = 220, overlap: int = 60) -> None:
    paths = sorted(glob.glob(os.path.join(folder, "**", pattern), recursive=True))
    if not paths:
        log("No .txt files found.")
        return
    log(f"📚 Found {len(paths)} file(s) to scan.")
    file_cnt, chunk_cnt = 0, 0
    for idx, p in enumerate(paths, 1):
        log(f"→ [{idx}/{len(paths)}] {os.path.basename(p)}")
        try:
            f, c = index_text_file(p, db_path=db_path, embed=embed, target_words=target_words, overlap=overlap)
            file_cnt += f
            chunk_cnt += c
            if f == 0:
                log("  (unchanged — skipped)")
            else:
                log(f"  ✓ indexed {c} chunks")
        except KeyboardInterrupt:
            log("⛔ Interrupted by user.")
            break
        except Exception as e:
            log(f"  ❌ Error indexing {p}: {e}")
    log(f"✅ Done. Files indexed: {file_cnt} | Chunks inserted: {chunk_cnt} | DB: {db_path}")

# ------------------------------------------------------------
# Post-crash hygiene / maintenance
# ------------------------------------------------------------
def find_empty_files(db_path: str = DB_PATH) -> List[Tuple[int, str]]:
    ensure_db(db_path)
    with get_conn(db_path) as conn:
        c = conn.cursor()
        c.execute("""
          SELECT f.file_id, f.file
          FROM files f
          LEFT JOIN chunks c ON c.file_id = f.file_id
          GROUP BY f.file_id
          HAVING COUNT(c.chunk_id) = 0
        """)
        return [(row[0], row[1]) for row in c.fetchall()]

def repair_empty_files(source_folder: str, db_path: str = DB_PATH,
                       pattern: str = "*.txt", embed: bool = True,
                       target_words: int = 220, overlap: int = 60) -> None:
    empties = find_empty_files(db_path)
    if not empties:
        log("No empty files to repair.")
        return
    all_paths = {os.path.basename(p): p for p in glob.glob(os.path.join(source_folder, "**", pattern), recursive=True)}
    log(f"🧰 Repairing {len(empties)} empty file(s)...")
    for fid, base in empties:
        p = all_paths.get(base)
        if not p:
            log(f"  ⚠️ Missing source for {base}; skipped.")
            continue
        log(f"  ↻ Re-indexing {base}")
        try:
            index_text_file(p, db_path=db_path, embed=embed, target_words=target_words, overlap=overlap)
            log("    ✓ repaired")
        except Exception as e:
            log(f"    ❌ repair failed: {e}")

# ------------------------------------------------------------
# Retrieval
# ------------------------------------------------------------
def _fts_candidates(conn: sqlite3.Connection, q: str, limit: int = 400) -> List[sqlite3.Row]:
    cur = conn.cursor()

    # Try MATCH with two variants, JOINing directly to chunks/files
    for attempt in _fts_query_variants(q):
        try:
            cur.execute("""
                SELECT
                  c.file_id,
                  c.chunk_id,
                  c.start_char,
                  c.end_char,
                  c.text,
                  c.embedding,
                  f.file,
                  bm25(chunks_fts) AS bm25
                FROM chunks_fts
                JOIN chunks c ON c.file_id = chunks_fts.file_id AND c.chunk_id = chunks_fts.chunk_id
                JOIN files  f ON f.file_id = c.file_id
                WHERE chunks_fts MATCH ?
                ORDER BY bm25
                LIMIT ?
            """, (attempt, limit))
            rows = cur.fetchall()
            if rows:
                return rows
        except sqlite3.OperationalError:
            # MATCH rejected the syntax; try next attempt or fall back to LIKE
            pass

    # LIKE fallback over chunks.text (NOT chunks_fts.text)
    terms = _extract_terms(q, max_terms=6)
    if not terms:
        return []
    like_where = " OR ".join(["c.text LIKE ?"] * len(terms))
    like_params = [f"%{t}%" for t in terms]

    cur.execute(f"""
        SELECT
          c.file_id,
          c.chunk_id,
          c.start_char,
          c.end_char,
          c.text,
          c.embedding,
          f.file,
          0.0 AS bm25
        FROM chunks c
        JOIN files f ON f.file_id = c.file_id
        WHERE {like_where}
        LIMIT ?
    """, like_params + [limit])

    return cur.fetchall()


def _semantic_rank(rows: List[sqlite3.Row], q: str, top_k: int) -> List[Dict[str, Any]]:
    dprint("semantic_rank: rows_in:", len(rows), "top_k:", top_k)
    need_key()
    qvec = embed_query_gemini(q)
    qvec = qvec / (np.linalg.norm(qvec) + 1e-12)
    scored = []
    for r in rows:
        if r["embedding"] is None:
            continue
        v = np.frombuffer(r["embedding"], dtype=np.float32)
        v = v / (np.linalg.norm(v) + 1e-12)
        scored.append({
            "score": float(np.dot(qvec, v)),
            "file": r["file"], "chunk_id": r["chunk_id"],
            "start": r["start_char"], "end": r["end_char"], "text": r["text"]
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    dprint("semantic_rank: rows_out:", len(scored))
    out, seen = [], set()
    for s in scored:
        k = (s["file"], s["chunk_id"])
        if k in seen:
            continue
        seen.add(k); out.append(s)
        if len(out) >= top_k:
            break
    return out

def search(db_path: str, q: str, top_k: int = 12) -> List[Dict[str, Any]]:
    ensure_db(db_path)

    # filename targeting (works for you already)
    if q.lower().startswith("file:"):
        after = q.split(":", 1)[1].strip()
        parts = after.split()
        name_part = parts[0] if parts else after
        q_for_rank = " ".join(parts[1:]) if len(parts) > 1 else after
        dprint("filename targeting:", name_part, "| residual query:", q_for_rank)
        with get_conn(db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT file_id, file FROM files WHERE file LIKE ? LIMIT 1", (f"%{name_part}%",))
            row = cur.fetchone()
            dprint("filename match:", bool(row))
            if not row:
                return []
            fid, fname = row["file_id"], row["file"]
            cur.execute("""
                SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding, ? AS file
                FROM chunks c
                WHERE c.file_id=?
            """, (fname, fid))
            rows = cur.fetchall()
        return _semantic_rank(rows, q_for_rank or q, top_k)

    with get_conn(db_path) as conn:
        cands = _fts_candidates(conn, q, limit=400)
        if not cands:
            # semantic fallback over recent chunks
            cur = conn.cursor()
            cur.execute("""
              SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding, f.file
              FROM chunks c JOIN files f ON f.file_id=c.file_id
              WHERE c.embedding IS NOT NULL
              ORDER BY f.mtime DESC
              LIMIT 3000
            """)
            rows = cur.fetchall()
            if not rows:
                return []
            return _semantic_rank(rows, q, top_k)

        # cands already have: text, embedding, file, and a bm25 value
        rows = cands

    # blend bm25 + vector similarity
    bm_vals = [r["bm25"] for r in rows]
    bm_min, bm_max = (min(bm_vals), max(bm_vals)) if bm_vals else (0.0, 0.0)

    def bm_norm(v: float) -> float:
        if not bm_vals or (bm_max - bm_min) < 1e-9:
            return 1.0
        return 1.0 - ((v - bm_min) / (bm_max - bm_min))

    any_emb = any(r["embedding"] for r in rows)
    vec_score: Dict[Tuple[int,int], float] = {}
    if any_emb:
        need_key()
        qvec = embed_query_gemini(q)
        qvec = qvec / (np.linalg.norm(qvec) + 1e-12)
        for r in rows:
            key = (r["file_id"], r["chunk_id"])
            if r["embedding"] is None:
                vec_score[key] = 0.0
            else:
                v = np.frombuffer(r["embedding"], dtype=np.float32)
                v = v / (np.linalg.norm(v) + 1e-12)
                vec_score[key] = float(np.dot(qvec, v))

    scored = []
    for r in rows:
        key = (r["file_id"], r["chunk_id"])
        bm = bm_norm(r["bm25"])
        final = 0.65 * vec_score.get(key, 0.0) + 0.35 * bm if any_emb else bm
        scored.append({
            "score": float(final),
            "file": r["file"],
            "chunk_id": r["chunk_id"],
            "start": r["start_char"],
            "end": r["end_char"],
            "text": r["text"]
        })

    scored.sort(key=lambda x: x["score"], reverse=True)

    out, seen = [], set()
    for s in scored:
        k = (s["file"], s["chunk_id"])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
        if len(out) >= top_k:
            break
    return out


# ------------------------------------------------------------
# Ask (LLM answer with citations)
# ------------------------------------------------------------
def answer_with_gemini(question: str, snippets: List[Dict[str, Any]]) -> str:
    dprint("ask: snippets_in", len(snippets))
    need_key()
    if not snippets:
        return "I couldn't find anything relevant in the index."
    blocks = []
    for i, m in enumerate(snippets, 1):
        blocks.append(f"[{i}] {m['file']} | chunk {m['chunk_id']}\n{m['text']}\n")
    prompt = (
        "You are a precise technical assistant. Answer ONLY from the context snippets.\n"
        "When you state a fact, add citations like [1], [2] that map to the numbered snippets.\n"
        "If the context is insufficient, say so briefly.\n\n"
        f"Question: {question}\n\n"
        "Context:\n" + "\n".join(blocks) + "\n"
        "Answer:"
    )
    model = genai.GenerativeModel(GEMINI_CHAT_MODEL)
    t0 = time.time()
    resp = model.generate_content(prompt)
    dprint("ask: model call elapsed_s:", round(time.time() - t0, 3))
    return resp.text.strip() if hasattr(resp, "text") and resp.text else "(no answer)"

# ------------------------------------------------------------
# Stats
# ------------------------------------------------------------
def stats(db_path: str = DB_PATH) -> Dict[str, int]:
    ensure_db(db_path)
    with get_conn(db_path) as conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM files")
        files = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM chunks")
        chunks = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL")
        embedded = c.fetchone()[0]
    return {"files": files, "chunks": chunks, "embedded_chunks": embedded}

# ------------------------------------------------------------
# Embed any chunks that currently have NULL embeddings
# ------------------------------------------------------------
def embed_missing(db_path: str = DB_PATH, batch: int = 32) -> None:
    ensure_db(db_path)
    need_key()
    with get_conn(db_path) as conn:
        cur = conn.cursor()
        cur.execute("""
          SELECT c.file_id, f.file, c.chunk_id, c.text
          FROM chunks c
          JOIN files f ON f.file_id = c.file_id
          WHERE c.embedding IS NULL
          ORDER BY c.file_id, c.chunk_id
        """)
        rows = cur.fetchall()
        if not rows:
            log("No missing embeddings.")
            return
        log(f"Embedding {len(rows)} chunk(s) with NULL embeddings...")
        for i in tqdm(range(0, len(rows), batch), desc="Embedding missing", unit="batch", disable=not DEBUG):
            batch_rows = rows[i:i+batch]
            texts = [(r["file"], r["chunk_id"], r["text"]) for r in batch_rows]
            vecs = embed_texts_gemini([t[2] for t in texts])
            for (file, chunk_id, _), v in zip(texts, vecs):
                cur.execute("""
                  UPDATE chunks SET embedding=? WHERE rowid = (
                    SELECT rowid FROM chunks WHERE chunk_id=? AND file_id = (
                      SELECT file_id FROM files WHERE file=?
                    )
                  )""", (v.astype(np.float32).tobytes(), chunk_id, file))
            conn.commit()
    log("Done embedding missing chunks.")

# ------------------------------------------------------------
# CLI
# ------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Local RAG core for OCR'ed report .txt files")
    parser.add_argument("--debug", action="store_true", help="Enable verbose debug logging")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_index = sub.add_parser("index", help="Index a folder of .txt files")
    p_index.add_argument("folder", help="Folder containing .txt reports")
    p_index.add_argument("--db", default=DB_PATH, help="SQLite path (default: uploads/reports.db)")
    p_index.add_argument("--pattern", default="*.txt", help="Glob pattern (default: *.txt)")
    p_index.add_argument("--no-embed", action="store_true", help="Index only, skip embeddings")
    p_index.add_argument("--target-words", type=int, default=220, help="Chunk target words")
    p_index.add_argument("--overlap", type=int, default=60, help="Chunk overlap words")

    p_embed = sub.add_parser("embed-missing", help="Embed any chunks with NULL embeddings")
    p_embed.add_argument("--db", default=DB_PATH, help="SQLite path")
    p_embed.add_argument("--batch", type=int, default=32, help="Batch size for update loop")

    p_search = sub.add_parser("search", help="Keyword/semantic search over the index")
    p_search.add_argument("query")
    p_search.add_argument("--db", default=DB_PATH)
    p_search.add_argument("--k", type=int, default=12)

    p_ask = sub.add_parser("ask", help="Answer with Gemini using top snippets (with citations)")
    p_ask.add_argument("question")
    p_ask.add_argument("--db", default=DB_PATH)
    p_ask.add_argument("--k", type=int, default=8)

    p_stats = sub.add_parser("stats", help="Show DB stats")
    p_stats.add_argument("--db", default=DB_PATH)

    p_repair = sub.add_parser("repair", help="Re-index any files that currently have zero chunks")
    p_repair.add_argument("--folder", required=True, help="Source folder to locate original files")
    p_repair.add_argument("--db", default=DB_PATH)
    p_repair.add_argument("--pattern", default="*.txt")
    p_repair.add_argument("--no-embed", action="store_true")
    p_repair.add_argument("--target-words", type=int, default=220)
    p_repair.add_argument("--overlap", type=int, default=60)

    args = parser.parse_args()

    # enable debug if flag passed
    global DEBUG
    if args.debug:
        DEBUG = True
        dprint("DEBUG enabled via --debug")
    else:
        if DEBUG:
            dprint("DEBUG enabled via RAG_DEBUG=1")

    if args.cmd == "index":
        embed = not args.no_embed
        bulk_index_folder(
            args.folder, db_path=args.db, embed=embed, pattern=args.pattern,
            target_words=args.target_words, overlap=args.overlap
        )

    elif args.cmd == "embed-missing":
        embed_missing(db_path=args.db, batch=args.batch)

    elif args.cmd == "search":
        t0 = time.time()
        res = search(args.db, args.query, top_k=args.k)
        dprint("search total elapsed_s:", round(time.time() - t0, 3))
        if not res:
            log("No matches.")
            return
        for i, m in enumerate(res, 1):
            log(f"[{i}] {m['file']}  (chunk {m['chunk_id']}, score {m['score']:.3f})")
            log(f"    {m['text'][:220].replace('\\n', ' ')}")
        log("")

    elif args.cmd == "ask":
        t0 = time.time()
        snippets = search(args.db, args.question, top_k=args.k)
        ans = answer_with_gemini(args.question, snippets)
        dprint("ask total elapsed_s:", round(time.time() - t0, 3))
        log("\n" + ans + "\n")

    elif args.cmd == "stats":
        s = stats(db_path=args.db)
        log(f"Files: {s['files']:,} | Chunks: {s['chunks']:,} | Embedded: {s['embedded_chunks']:,}")

    elif args.cmd == "repair":
        repair_empty_files(
            args.folder, db_path=args.db, pattern=args.pattern,
            embed=not args.no_embed, target_words=args.target_words, overlap=args.overlap
        )

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Interrupted.")
