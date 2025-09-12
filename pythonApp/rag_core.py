# rag_core.py
# ------------------------------------------------------------
# Flask Blueprint for your Retrieval-Augmented Generation (RAG) core
# Endpoints (/api/rag/*):
#   POST  /search        { query, k?, db?, min_wo?, max_wo? }
#   POST  /ask           { question, k?, db?, min_wo?, max_wo? }
#   GET   /stats         ?db=
#   GET   /files         ?db=
#   POST  /embed-missing { db?, batch? }
#   POST  /repair        { folder, db?, pattern?, no_embed?, target_words?, overlap? }
#   GET   /_debug        ?db=
#
# Register in app.py:
#   from rag_core import rag_bp
#   app.register_blueprint(rag_bp)
# ------------------------------------------------------------

import os
import re
import glob
import time
import sqlite3
from typing import List, Tuple, Dict, Any, Optional

import numpy as np
from flask import Blueprint, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# ---- Optional Gemini client (embeddings + answers) ----
try:
    import google.generativeai as genai
except Exception:
    genai = None

# ---------------------- CONFIG ----------------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DEFAULT_DB = os.path.join(UPLOADS_DIR, "reports.db")
GEMINI_EMBED_MODEL = "text-embedding-004"   # 768-dim
GEMINI_CHAT_MODEL  = "gemini-2.5-pro"

DEBUG = bool(int(os.getenv("RAG_DEBUG", "0")))
def dprint(*args):
    if DEBUG:
        print("[RAG DEBUG]", *args, flush=True)

rag_bp = Blueprint("rag", __name__)
CORS(rag_bp, resources={r"/api/*": {"origins": "*"}})

# ---------------------- Small utils ----------------------
def _db_path(db_param: Optional[str]) -> str:
    if not db_param:
        return DEFAULT_DB
    if os.path.isabs(db_param):
        return db_param
    return os.path.join(UPLOADS_DIR, db_param)

def get_conn(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    try:
        conn.execute("PRAGMA mmap_size=30000000000;")
    except Exception:
        pass
    return conn

def _schema_kind(conn: sqlite3.Connection) -> str:
    """Detect schema flavor: 'rag', 'admin', or 'unknown'."""
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    names = {r[0] for r in cur.fetchall()}
    if {"files", "chunks", "chunks_fts"}.issubset(names):
        return "rag"
    if "chunks" in names and "files" not in names:
        return "admin"
    return "unknown"

def _extract_terms(q: str, max_terms: int = 8) -> List[str]:
    terms = re.findall(r"[A-Za-z0-9]+", q or "")
    terms = [t for t in terms if len(t) >= 2]
    seen, out = set(), []
    for t in terms:
        tl = t.lower()
        if tl not in seen:
            seen.add(tl); out.append(t)
        if len(out) >= max_terms:
            break
    return out

def _fts_query_variants(q: str) -> List[str]:
    terms = _extract_terms(q)
    or_query = " OR ".join(terms) if terms else q
    return [q, or_query]

# ---------------------- Work-order helpers ----------------------
_WO_RE = re.compile(r"^(\d{3,5})")  # leading 3–5 digits

def _extract_wo_int(file_name: str) -> Optional[int]:
    base = os.path.basename(file_name or "")
    m = _WO_RE.match(base)
    if not m:
        return None
    s = m.group(1)
    try:
        return int(s.lstrip("0") or "0")
    except Exception:
        return None

def _wo_in_range(file_name: str, min_wo: Optional[int], max_wo: Optional[int]) -> bool:
    if min_wo is None and max_wo is None:
        return True
    w = _extract_wo_int(file_name)
    if w is None:
        return False
    if min_wo is not None and w < min_wo:
        return False
    if max_wo is not None and w > max_wo:
        return False
    return True

def _apply_wo_filter_to_rows(rows, min_wo: Optional[int], max_wo: Optional[int]):
    if min_wo is None and max_wo is None:
        return rows
    return [r for r in rows if _wo_in_range(r["file"], min_wo, max_wo)]

# ---------------------- Gemini helpers ----------------------
def need_key():
    if genai is None:
        raise RuntimeError("google-generativeai is not installed. `pip install google-generativeai`")
    load_dotenv()
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set in environment.")
    genai.configure(api_key=key)

def embed_texts_gemini(texts: List[str]) -> np.ndarray:
    need_key()
    vecs: List[np.ndarray] = []
    for t in texts:
        content = (t or "").strip()
        if not content:
            vecs.append(np.zeros((768,), dtype=np.float32))
            continue
        emb = genai.embed_content(model=GEMINI_EMBED_MODEL, content=content)
        v = np.array(emb["embedding"], dtype=np.float32)
        vecs.append(v)
    return np.vstack(vecs)

def embed_query_gemini(q: str) -> np.ndarray:
    return embed_texts_gemini([q])[0]

# ---------------------- Optional: RAG indexing (used by /repair) ----------------------
def ensure_rag_db(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS files(
          file_id    INTEGER PRIMARY KEY AUTOINCREMENT,
          file       TEXT UNIQUE,
          size_bytes INTEGER,
          mtime      REAL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS chunks(
          file_id    INTEGER,
          chunk_id   INTEGER,
          start_char INTEGER,
          end_char   INTEGER,
          text       TEXT,
          embedding  BLOB,
          PRIMARY KEY(file_id, chunk_id)
        )
    """)
    cur.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          file_id UNINDEXED,
          chunk_id UNINDEXED,
          content=''
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)")
    conn.commit()

def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def _normalize_text(s: str) -> str:
    s = s.replace("\r", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def _chunk_words(text: str, target_words: int = 220, overlap: int = 60) -> Tuple[List[str], List[Tuple[int,int]]]:
    w = re.findall(r"\S+", text or "")
    if not w:
        return [], []
    chunks, spans, i = [], [], 0
    while i < len(w):
        j = min(len(w), i + target_words)
        seg_words = w[i:j]
        prefix_words = w[:i]
        start_char = len(" ".join(prefix_words)) + (1 if i > 0 else 0)
        chunk_text = " ".join(seg_words)
        end_char = start_char + len(chunk_text)
        chunks.append(chunk_text); spans.append((start_char, end_char))
        if j == len(w): break
        i = max(0, j - overlap)
    return chunks, spans

def index_text_file(path: str, db_path: str, *, embed: bool = True,
                    target_words: int = 220, overlap: int = 60) -> Tuple[int, int]:
    txt = _normalize_text(_read_text(path))
    chunks, spans = _chunk_words(txt, target_words, overlap)
    if not chunks:
        return 0, 0
    with get_conn(db_path) as conn:
        ensure_rag_db(conn)
        base = os.path.basename(path)
        st = os.stat(path)
        cur = conn.cursor()
        cur.execute("SELECT file_id, size_bytes, mtime FROM files WHERE file=?", (base,))
        row = cur.fetchone()
        if row and row["size_bytes"] == st.st_size and abs(row["mtime"] - st.st_mtime) < 1e-6:
            return 0, 0
        if row:
            fid = row["file_id"]
            cur.execute("UPDATE files SET size_bytes=?, mtime=? WHERE file_id=?", (st.st_size, st.st_mtime, fid))
            cur.execute("DELETE FROM chunks WHERE file_id=?", (fid,))
            cur.execute("DELETE FROM chunks_fts WHERE file_id=?", (fid,))
        else:
            cur.execute("INSERT INTO files(file,size_bytes,mtime) VALUES(?,?,?)", (base, st.st_size, st.st_mtime))
            fid = cur.lastrowid

        vecs = None
        if embed:
            try:
                vecs = embed_texts_gemini(chunks)
            except Exception:
                vecs = None

        for i, (ch, (stc, enc)) in enumerate(zip(chunks, spans)):
            emb_blob = vecs[i].astype(np.float32).tobytes() if vecs is not None else None
            cur.execute("""
                INSERT OR REPLACE INTO chunks(file_id,chunk_id,start_char,end_char,text,embedding)
                VALUES(?,?,?,?,?,?)
            """, (fid, i, stc, enc, ch, emb_blob))
            cur.execute("INSERT INTO chunks_fts(text,file_id,chunk_id) VALUES(?,?,?)", (ch, fid, i))
        conn.commit()
    return 1, len(chunks)

def repair_empty_files(source_folder: str, db_path: str,
                       pattern: str = "*.txt", embed: bool = True,
                       target_words: int = 220, overlap: int = 60) -> Dict[str, Any]:
    with get_conn(db_path) as conn:
        ensure_rag_db(conn)
        cur = conn.cursor()
        cur.execute("""
            SELECT f.file_id, f.file
            FROM files f LEFT JOIN chunks c ON c.file_id=f.file_id
            GROUP BY f.file_id HAVING COUNT(c.chunk_id)=0
        """)
        empties = [(r[0], r[1]) for r in cur.fetchall()]

    if not empties:
        return {"repaired": 0, "missing": 0}

    all_paths = {os.path.basename(p): p for p in glob.glob(os.path.join(source_folder, "**", pattern), recursive=True)}
    repaired = 0
    missing = 0
    for fid, base in empties:
        p = all_paths.get(base)
        if not p:
            missing += 1
            continue
        try:
            index_text_file(p, db_path, embed=embed, target_words=target_words, overlap=overlap)
            repaired += 1
        except Exception:
            pass
    return {"repaired": repaired, "missing": missing}

# ---------------------- Retrieval (schema-aware) ----------------------
def _fts_candidates_rag(conn: sqlite3.Connection, q: str, limit: int = 400) -> List[sqlite3.Row]:
    """RAG schema (files/chunks/chunks_fts)."""
    cur = conn.cursor()
    for attempt in _fts_query_variants(q):
        try:
            cur.execute("""
                SELECT
                  c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
                  f.file,
                  bm25(chunks_fts) AS bm25
                FROM chunks_fts
                JOIN chunks c ON c.file_id=chunks_fts.file_id AND c.chunk_id=chunks_fts.chunk_id
                JOIN files  f ON f.file_id=c.file_id
                WHERE chunks_fts MATCH ?
                ORDER BY bm25
                LIMIT ?
            """, (attempt, limit))
            rows = cur.fetchall()
            if rows:
                return rows
        except sqlite3.OperationalError:
            pass

    # LIKE fallback
    terms = _extract_terms(q, max_terms=6)
    if not terms:
        return []
    where = " OR ".join(["LOWER(c.text) LIKE ?"] * len(terms))
    params = [f"%{t.lower()}%" for t in terms]
    cur.execute(f"""
        SELECT
          c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
          f.file,
          0.0 AS bm25
        FROM chunks c
        JOIN files f ON f.file_id=c.file_id
        WHERE {where}
        LIMIT ?
    """, params + [limit])
    return cur.fetchall()

def _fts_candidates_admin(conn: sqlite3.Connection, q: str, limit: int = 400) -> List[sqlite3.Row]:
    """Admin schema (single chunks table). LIKE-only search."""
    cur = conn.cursor()
    terms = _extract_terms(q, max_terms=8)
    if not terms:
        return []
    where = " OR ".join(["LOWER(text) LIKE ?"] * len(terms))
    params = [f"%{t.lower()}%" for t in terms]
    cur.execute(f"""
        SELECT
          0 AS file_id,
          chunk AS chunk_id,
          0   AS start_char,
          LENGTH(text) AS end_char,
          text,
          embedding,
          file,
          0.0 AS bm25
        FROM chunks
        WHERE {where}
        LIMIT ?
    """, params + [limit])
    return cur.fetchall()

def _semantic_rerank(rows: List[sqlite3.Row], q: str, top_k: int) -> List[Dict[str, Any]]:
    """Cosine rerank if embeddings & key exist; otherwise bm25/LIKE order."""
    if not rows:
        return []

    # If no embeddings at all, normalize bm25 and return
    any_emb = any(r["embedding"] for r in rows)
    bm_vals = [r["bm25"] for r in rows]
    bm_min, bm_max = (min(bm_vals), max(bm_vals)) if bm_vals else (0.0, 1.0)

    def bm_norm(v: float) -> float:
        d = bm_max - bm_min
        if d <= 1e-9:
            return 1.0
        return 1.0 - ((v - bm_min) / d)

    vec_scores: List[float] = [0.0] * len(rows)
    if any_emb:
        try:
            qvec = embed_query_gemini(q)
            qvec = qvec / (np.linalg.norm(qvec) + 1e-12)
            for i, r in enumerate(rows):
                if r["embedding"] is None:
                    vec_scores[i] = 0.0
                else:
                    v = np.frombuffer(r["embedding"], dtype=np.float32)
                    v = v / (np.linalg.norm(v) + 1e-12)
                    vec_scores[i] = float(np.dot(qvec, v))
        except Exception as e:
            dprint("cosine rerank disabled (no key?):", e)
            vec_scores = [0.0] * len(rows)

    scored = []
    for i, r in enumerate(rows):
        final = 0.65 * vec_scores[i] + 0.35 * bm_norm(r["bm25"])
        scored.append({
            "score": float(final),
            "file": r["file"],
            "chunk_id": r["chunk_id"],
            "start": r["start_char"],
            "end": r["end_char"],
            "text": r["text"] or "",
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

# --- Backward-compat names (prevents NameError if other code references them)
def _fts_candidates(conn, q, limit=400):  # noqa
    # choose by schema
    kind = _schema_kind(conn)
    return _fts_candidates_rag(conn, q, limit) if kind == "rag" else _fts_candidates_admin(conn, q, limit)

def _semantic_rank(rows, q, top_k):  # noqa
    return _semantic_rerank(rows, q, top_k)

# ---------------------- High-level search ----------------------
def search(db_path: str, q: str, top_k: int = 12,
           min_wo: Optional[int] = None, max_wo: Optional[int] = None) -> List[Dict[str, Any]]:
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn)

        # filename targeting ("file:Wahiawa ..." or "file:8210 ...")
        if q.lower().startswith("file:"):
            after = q.split(":", 1)[1].strip()
            parts = after.split()
            name_part = parts[0] if parts else after
            q_for_rank = " ".join(parts[1:]) if len(parts) > 1 else after

            if kind == "rag":
                cur = conn.cursor()
                cur.execute("SELECT file_id, file FROM files WHERE file LIKE ? LIMIT 1", (f"%{name_part}%",))
                row = cur.fetchone()
                if not row:
                    return []
                fname = row["file"]
                if not _wo_in_range(fname, min_wo, max_wo):
                    return []
                cur.execute("""
                    SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding, ? AS file
                    FROM chunks c WHERE c.file_id=?
                """, (fname, row["file_id"]))
                rows = cur.fetchall()
                return _semantic_rerank(rows, q_for_rank or q, top_k)

            # admin schema
            cur = conn.cursor()
            cur.execute("SELECT DISTINCT file FROM chunks WHERE file LIKE ? LIMIT 1", (f"%{name_part}%",))
            row = cur.fetchone()
            if not row:
                return []
            fname = row[0]
            if not _wo_in_range(fname, min_wo, max_wo):
                return []
            cur.execute("""
                SELECT
                  0 AS file_id,
                  chunk AS chunk_id,
                  0   AS start_char,
                  LENGTH(text) AS end_char,
                  text,
                  embedding,
                  file,
                  0.0 AS bm25
                FROM chunks
                WHERE file = ?
            """, (fname,))
            rows = cur.fetchall()
            return _semantic_rerank(rows, q_for_rank or q, top_k)

        # normal query
        rows = _fts_candidates(conn, q, limit=400)
        rows = _apply_wo_filter_to_rows(rows, min_wo, max_wo)

        if not rows:
            # semantic fallback over recent embedded chunks
            cur = conn.cursor()
            if kind == "rag":
                cur.execute("""
                  SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding, f.file
                  FROM chunks c JOIN files f ON f.file_id=c.file_id
                  WHERE c.embedding IS NOT NULL
                  ORDER BY f.mtime DESC
                  LIMIT 3000
                """)
            elif kind == "admin":
                cur.execute("""
                  SELECT
                    0 AS file_id,
                    chunk AS chunk_id,
                    0   AS start_char,
                    LENGTH(text) AS end_char,
                    text,
                    embedding,
                    file,
                    0.0 AS bm25
                  FROM chunks
                  WHERE embedding IS NOT NULL
                  ORDER BY rowid DESC
                  LIMIT 3000
                """)
            else:
                return []

            rows = cur.fetchall()
            rows = _apply_wo_filter_to_rows(rows, min_wo, max_wo)
            if not rows:
                return []
            return _semantic_rerank(rows, q, top_k)

        return _semantic_rerank(rows, q, top_k)

# ---------------------- Ask ----------------------
def answer_with_gemini(question: str, snippets: List[Dict[str, Any]]) -> str:
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
    resp = model.generate_content(prompt)
    return resp.text.strip() if hasattr(resp, "text") and resp.text else "(no answer)"

# ---------------------- Stats / Maintenance ----------------------
def stats(db_path: str) -> Dict[str, Any]:
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn)
        cur = conn.cursor()
        if kind == "rag":
            cur.execute("SELECT COUNT(*) FROM files"); files = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM chunks"); chunks = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL"); embedded = cur.fetchone()[0]
            return {"files": files, "chunks": chunks, "embedded_chunks": embedded, "schema": "rag"}
        if kind == "admin":
            cur.execute("SELECT COUNT(*) FROM chunks"); chunks = cur.fetchone()[0]
            embedded = 0
            try:
                cur.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL")
                embedded = cur.fetchone()[0]
            except Exception:
                pass
            return {"files": None, "chunks": chunks, "embedded_chunks": embedded, "schema": "admin"}
        return {"files": None, "chunks": None, "embedded_chunks": None, "schema": "unknown"}

def list_files(db_path: str) -> List[str]:
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn)
        cur = conn.cursor()
        if kind == "rag":
            try:
                cur.execute("SELECT file FROM files ORDER BY file")
                files = [r[0] for r in cur.fetchall()]
                if files:
                    return files
            except Exception:
                pass
            cur.execute("SELECT DISTINCT file FROM chunks ORDER BY file")
            return [r[0] for r in cur.fetchall()]
        if kind == "admin":
            cur.execute("SELECT DISTINCT file FROM chunks ORDER BY file")
            return [r[0] for r in cur.fetchall()]
        return []

def embed_missing(db_path: str, batch: int = 32) -> int:
    """Fill NULL embeddings for whichever schema is present. Returns updated count."""
    need_key()
    updated = 0
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn)
        cur = conn.cursor()
        if kind == "rag":
            cur.execute("""
              SELECT rowid, text FROM chunks WHERE embedding IS NULL
              ORDER BY file_id, chunk_id
            """)
        elif kind == "admin":
            try:
                cur.execute("SELECT rowid, text FROM chunks WHERE embedding IS NULL")
            except Exception:
                return 0
        else:
            return 0

        rows = cur.fetchall()
        for i in range(0, len(rows), batch):
            part = rows[i:i+batch]
            vecs = embed_texts_gemini([r["text"] or "" for r in part])
            for r, v in zip(part, vecs):
                cur.execute("UPDATE chunks SET embedding=? WHERE rowid=?",
                            (v.astype(np.float32).tobytes(), r["rowid"]))
            conn.commit()
            updated += len(part)
    return updated

# ---------------------- Routes ----------------------
@rag_bp.route("/api/rag/search", methods=["POST"])
def api_search():
    data = request.get_json() or {}
    q = (data.get("query") or "").strip()
    k = int(data.get("k") or 12)
    db = _db_path(data.get("db"))

    def _to_int(x):
        try:
            if x is None or str(x).strip() == "":
                return None
            return int(str(x).strip())
        except Exception:
            return None

    min_wo = _to_int(data.get("min_wo"))
    max_wo = _to_int(data.get("max_wo"))

    if not q:
        return jsonify({"error": "Missing query"}), 400
    try:
        res = search(db, q, top_k=k, min_wo=min_wo, max_wo=max_wo)
        return jsonify({"results": res})
    except Exception as e:
        return jsonify({"error": f"Search failed: {e}"}), 500

@rag_bp.route("/api/rag/ask", methods=["POST"])
def api_ask():
    data = request.get_json() or {}
    question = (data.get("question") or "").strip()
    k = int(data.get("k") or 8)
    db = _db_path(data.get("db"))

    def _to_int(x):
        try:
            if x is None or str(x).strip() == "":
                return None
            return int(str(x).strip())
        except Exception:
            return None

    min_wo = _to_int(data.get("min_wo"))
    max_wo = _to_int(data.get("max_wo"))

    if not question:
        return jsonify({"error": "Missing question"}), 400
    try:
        snippets = search(db, question, top_k=k, min_wo=min_wo, max_wo=max_wo)
        try:
            ans = answer_with_gemini(question, snippets)
        except Exception as e:
            if "GEMINI_API_KEY" in str(e) or "google-generativeai" in str(e):
                return jsonify({
                    "answer": "No LLM key configured; here are the most relevant snippets.",
                    "snippets": snippets
                })
            raise
        return jsonify({"answer": ans, "snippets": snippets})
    except Exception as e:
        return jsonify({"error": f"Ask failed: {e}"}), 500

@rag_bp.route("/api/rag/stats", methods=["GET"])
def api_stats():
    db = _db_path(request.args.get("db"))
    try:
        s = stats(db)
        s["db"] = os.path.basename(db)
        return jsonify(s)
    except Exception as e:
        return jsonify({"error": f"Stats failed: {e}"}), 500

@rag_bp.route("/api/rag/files", methods=["GET"])
def api_files():
    db = _db_path(request.args.get("db"))
    try:
        files = list_files(db)
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": f"Files failed: {e}"}), 500

@rag_bp.route("/api/rag/embed-missing", methods=["POST"])
def api_embed_missing():
    data = request.get_json() or {}
    db = _db_path(data.get("db"))
    batch = int(data.get("batch") or 32)
    try:
        updated = embed_missing(db, batch=batch)
        return jsonify({"updated": updated})
    except Exception as e:
        return jsonify({"error": f"Embedding unavailable or failed: {e}"}), 400

@rag_bp.route("/api/rag/repair", methods=["POST"])
def api_repair():
    data = request.get_json() or {}
    folder = data.get("folder")
    db = _db_path(data.get("db"))
    pattern = data.get("pattern") or "*.txt"
    no_embed = bool(data.get("no_embed") or False)
    target_words = int(data.get("target_words") or 220)
    overlap = int(data.get("overlap") or 60)
    if not folder or not os.path.exists(folder):
        return jsonify({"error": "Missing or invalid folder"}), 400
    try:
        result = repair_empty_files(folder, db, pattern=pattern, embed=(not no_embed),
                                    target_words=target_words, overlap=overlap)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"repair failed: {e}"}), 500

@rag_bp.route("/api/rag/_debug", methods=["GET"])
def api_debug():
    db = _db_path(request.args.get("db"))
    try:
        with get_conn(db) as conn:
            kind = _schema_kind(conn)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cur.fetchall()]
            info = {"db": os.path.basename(db), "schema": kind, "tables": tables}
            if kind == "rag":
                cur.execute("SELECT COUNT(*) FROM files"); info["files_count"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM chunks"); info["chunks_count"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL"); info["embedded_chunks"] = cur.fetchone()[0]
            elif kind == "admin":
                cur.execute("SELECT COUNT(*) FROM chunks"); info["chunks_count"] = cur.fetchone()[0]
            return jsonify(info)
    except Exception as e:
        return jsonify({"error": f"debug failed: {e}"}), 500
