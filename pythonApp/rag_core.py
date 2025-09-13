# rag_core.py
# Flask Blueprint for Retrieval-Augmented Generation (RAG)
# Endpoints (all prefixed with /api/rag):
#   POST /api/rag/search       { query, k?, db?, min_wo?, max_wo?, files? }
#   POST /api/rag/ask          { question, k?, db?, min_wo?, max_wo?, files?, mode? }
#   GET  /api/rag/stats        ?db=
#   GET  /api/rag/files        ?db=
#   POST /api/rag/embed-missing{ db?, batch? }
#   POST /api/rag/repair       { folder, db?, pattern?, no_embed?, target_words?, overlap? }
#   GET  /api/rag/_debug       ?db=

import os, re, glob, time, sqlite3
from typing import List, Tuple, Dict, Any, Optional
import numpy as np
from flask import Blueprint, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# ---- Optional Gemini client ----
try:
    import google.generativeai as genai
except Exception:
    genai = None

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DEFAULT_DB = os.path.join(UPLOADS_DIR, "reports.db")
GEMINI_EMBED_MODEL = "text-embedding-004"
GEMINI_CHAT_MODEL  = "gemini-2.5-pro"

DEBUG = bool(int(os.getenv("RAG_DEBUG", "0")))
rag_bp = Blueprint("rag", __name__)
CORS(rag_bp, resources={r"/api/*": {"origins": "*"}})

def dprint(*a):
    if DEBUG: print("[RAG]", *a, flush=True)

# ---------------------- DB utils ----------------------
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
    try: conn.execute("PRAGMA mmap_size=30000000000;")
    except Exception: pass
    return conn

def ensure_db(db_path: str) -> None:
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

def _schema_kind(conn: sqlite3.Connection) -> str:
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    names = {r[0] for r in cur.fetchall()}
    if {"files", "chunks", "chunks_fts"}.issubset(names): return "rag"
    if "chunks" in names and "files" not in names: return "admin"
    return "unknown"

# ---------------------- Work-Order helpers ----------------------
_WO_RE = re.compile(r"^(\d{3,5})")
def _extract_wo_int(file_name: str) -> Optional[int]:
    base = os.path.basename(file_name or "")
    m = _WO_RE.match(base)
    if not m: return None
    try: return int((m.group(1) or "").lstrip("0") or "0")
    except Exception: return None

def _wo_in_range(file_name: str, min_wo: Optional[int], max_wo: Optional[int]) -> bool:
    if min_wo is None and max_wo is None: return True
    w = _extract_wo_int(file_name)
    if w is None: return False
    if min_wo is not None and w < min_wo: return False
    if max_wo is not None and w > max_wo: return False
    return True

def _apply_wo_filter(rows, min_wo: Optional[int], max_wo: Optional[int]):
    if min_wo is None and max_wo is None: return rows
    return [r for r in rows if _wo_in_range(r["file"], min_wo, max_wo)]

# ---------------------- Text / query utils ----------------------
def _extract_terms(q: str, max_terms: int = 8) -> List[str]:
    terms = re.findall(r"[A-Za-z0-9]+", q or "")
    terms = [t for t in terms if len(t) >= 2]
    out, seen = [], set()
    for t in terms:
        tl = t.lower()
        if tl not in seen:
            seen.add(tl); out.append(t)
        if len(out) >= max_terms: break
    return out

def _fts_query_variants(q: str) -> List[str]:
    terms = _extract_terms(q)
    orq = " OR ".join(terms) if terms else q
    return [q, orq]

# ---------------------- Embedding helpers ----------------------
def need_key():
    if genai is None:
        raise RuntimeError("google-generativeai not installed. pip install google-generativeai")
    load_dotenv()
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    genai.configure(api_key=key)

def embed_texts_gemini(texts: List[str]) -> np.ndarray:
    need_key()
    vecs = []
    for t in texts:
        t = (t or "").strip()
        if not t:
            vecs.append(np.zeros((768,), dtype=np.float32))
            continue
        emb = genai.embed_content(model=GEMINI_EMBED_MODEL, content=t)
        vecs.append(np.array(emb["embedding"], dtype=np.float32))
    return np.vstack(vecs)

def embed_query_gemini(q: str) -> np.ndarray:
    return embed_texts_gemini([q])[0]

# ---------------------- Indexing (minimal – used by /repair) ----------------------
def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def _normalize_text(s: str) -> str:
    s = s.replace("\r", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def _chunk_words(text: str, target_words: int = 220, overlap: int = 60):
    w = re.findall(r"\S+", text or "")
    if not w: return [], []
    chunks, spans, i = [], [], 0
    while i < len(w):
        j = min(len(w), i + target_words)
        seg = w[i:j]
        start_char = len(" ".join(w[:i])) + (1 if i > 0 else 0)
        ch = " ".join(seg)
        chunks.append(ch); spans.append((start_char, start_char + len(ch)))
        if j == len(w): break
        i = max(0, j - overlap)
    return chunks, spans

def ensure_rag_db(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS files(
          file_id    INTEGER PRIMARY KEY AUTOINCREMENT,
          file       TEXT UNIQUE,
          size_bytes INTEGER,
          mtime      REAL
        )""")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS chunks(
          file_id    INTEGER, chunk_id INTEGER,
          start_char INTEGER, end_char INTEGER,
          text TEXT, embedding BLOB,
          PRIMARY KEY(file_id, chunk_id)
        )""")
    cur.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text, file_id UNINDEXED, chunk_id UNINDEXED, content=''
        )""")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)")
    conn.commit()

def index_text_file(path: str, db_path: str, *, embed: bool = True,
                    target_words: int = 220, overlap: int = 60):
    txt = _normalize_text(_read_text(path))
    chunks, spans = _chunk_words(txt, target_words, overlap)
    if not chunks: return 0, 0
    with get_conn(db_path) as conn:
        ensure_rag_db(conn)
        base = os.path.basename(path); st = os.stat(path)
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

        vecs = embed_texts_gemini(chunks) if embed else None
        for i, (ch, (stc, enc)) in enumerate(zip(chunks, spans)):
            emb_blob = vecs[i].astype(np.float32).tobytes() if vecs is not None else None
            cur.execute("""INSERT OR REPLACE INTO chunks(file_id,chunk_id,start_char,end_char,text,embedding)
                           VALUES(?,?,?,?,?,?)""", (fid, i, stc, enc, ch, emb_blob))
            cur.execute("INSERT INTO chunks_fts(text,file_id,chunk_id) VALUES(?,?,?)", (ch, fid, i))
        conn.commit()
    return 1, len(chunks)

def repair_empty_files(source_folder: str, db_path: str,
                       pattern: str = "*.txt", embed: bool = True,
                       target_words: int = 220, overlap: int = 60):
    with get_conn(db_path) as conn:
        ensure_rag_db(conn)
        cur = conn.cursor()
        cur.execute("""
          SELECT f.file_id, f.file
          FROM files f LEFT JOIN chunks c ON c.file_id=f.file_id
          GROUP BY f.file_id HAVING COUNT(c.chunk_id)=0
        """)
        empties = [(r[0], r[1]) for r in cur.fetchall()]
    if not empties: return {"repaired": 0, "missing": 0}
    all_paths = {os.path.basename(p): p for p in glob.glob(os.path.join(source_folder, "**", pattern), recursive=True)}
    repaired = missing = 0
    for fid, base in empties:
        p = all_paths.get(base)
        if not p: missing += 1; continue
        try:
            index_text_file(p, db_path, embed=embed, target_words=target_words, overlap=overlap)
            repaired += 1
        except Exception: pass
    return {"repaired": repaired, "missing": missing}

# ---------------------- Retrieval ----------------------
def _fts_candidates_rag(conn: sqlite3.Connection, q: str, limit: int = 400) -> List[sqlite3.Row]:
    cur = conn.cursor()
    for attempt in _fts_query_variants(q):
        try:
            cur.execute("""
              SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
                     f.file, bm25(chunks_fts) AS bm25
              FROM chunks_fts
              JOIN chunks c ON c.file_id=chunks_fts.file_id AND c.chunk_id=chunks_fts.chunk_id
              JOIN files  f ON f.file_id=c.file_id
              WHERE chunks_fts MATCH ?
              ORDER BY bm25
              LIMIT ?
            """, (attempt, limit))
            rows = cur.fetchall()
            if rows: return rows
        except sqlite3.OperationalError:
            pass
    # LIKE fallback
    terms = _extract_terms(q, max_terms=6)
    if not terms: return []
    where = " OR ".join(["LOWER(c.text) LIKE ?"] * len(terms))
    params = [f"%{t.lower()}%" for t in terms]
    cur.execute(f"""
      SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
             f.file, 0.0 AS bm25
      FROM chunks c JOIN files f ON f.file_id=c.file_id
      WHERE {where}
      LIMIT ?
    """, params + [limit])
    return cur.fetchall()

def _fts_candidates_rag_by_files(conn: sqlite3.Connection, q: str, files: List[str], limit: int = 400) -> List[sqlite3.Row]:
    if not files: return []
    cur = conn.cursor()
    ph = ",".join(["?"] * len(files))
    for attempt in _fts_query_variants(q):
        try:
            cur.execute(f"""
              SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
                     f.file, bm25(chunks_fts) AS bm25
              FROM chunks_fts
              JOIN chunks c ON c.file_id=chunks_fts.file_id AND c.chunk_id=chunks_fts.chunk_id
              JOIN files  f ON f.file_id=c.file_id
              WHERE chunks_fts MATCH ? AND f.file IN ({ph})
              ORDER BY bm25
              LIMIT ?
            """, (attempt, *files, limit))
            rows = cur.fetchall()
            if rows: return rows
        except sqlite3.OperationalError:
            pass
    # LIKE fallback restricted to files
    terms = _extract_terms(q, max_terms=6)
    if not terms: return []
    where = " AND f.file IN (" + ph + ") AND (" + " OR ".join(["LOWER(c.text) LIKE ?"]*len(terms)) + ")"
    params = [*files] + [f"%{t.lower()}%" for t in terms]
    cur.execute(f"""
      SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding,
             f.file, 0.0 AS bm25
      FROM chunks c JOIN files f ON f.file_id=c.file_id
      WHERE {where}
      LIMIT ?
    """, params + [limit])
    return cur.fetchall()

def _bm25_norm(vals):
    if not vals: return (lambda _: 1.0)
    vmin, vmax = min(vals), max(vals)
    if vmax - vmin < 1e-9: return (lambda _: 1.0)
    return (lambda v: 1.0 - ((v - vmin) / (vmax - vmin)))

def _blend_score(rows, q: str) -> List[Dict[str, Any]]:
    any_emb = any(r["embedding"] for r in rows)
    bm_norm = _bm25_norm([r["bm25"] for r in rows])
    vec_map = {}
    if any_emb:
        try:
            qv = embed_query_gemini(q); qv = qv / (np.linalg.norm(qv)+1e-12)
            for r in rows:
                if r["embedding"] is None:
                    vec_map[(r["file_id"], r["chunk_id"])] = 0.0
                else:
                    v = np.frombuffer(r["embedding"], dtype=np.float32)
                    v = v / (np.linalg.norm(v)+1e-12)
                    vec_map[(r["file_id"], r["chunk_id"])] = float(np.dot(qv, v))
        except Exception as e:
            dprint("vec disabled:", e)
            any_emb = False
    out = []
    for r in rows:
        key = (r["file_id"], r["chunk_id"])
        base = bm_norm(r["bm25"])
        final = 0.65*vec_map.get(key, 0.0) + 0.35*base if any_emb else base
        out.append({
            "score": float(final), "file": r["file"], "chunk_id": r["chunk_id"],
            "start": r["start_char"], "end": r["end_char"], "text": r["text"] or ""
        })
    out.sort(key=lambda x: x["score"], reverse=True)
    # de-dupe (file,chunk)
    keep, seen = [], set()
    for s in out:
        k = (s["file"], s["chunk_id"])
        if k in seen: continue
        seen.add(k); keep.append(s)
    return keep

def _round_robin(lists: List[List[Dict[str, Any]]], total_k: int) -> List[Dict[str, Any]]:
    out = []
    i = 0
    while len(out) < total_k and any(lists):
        for lst in lists:
            if i < len(lst):
                out.append(lst[i])
                if len(out) >= total_k: break
        i += 1
        if i > max(len(x) for x in lists): break
    return out

def search(db_path: str, q: str, top_k: int = 12,
           min_wo: Optional[int] = None, max_wo: Optional[int] = None,
           files: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Search across index; optionally within a file whitelist and WO range."""
    ensure_db(db_path)

    # filename-targeting shortcut: "file:<name> ..."
    if q.lower().startswith("file:") and not files:
        after = q.split(":", 1)[1].strip()
        parts = after.split()
        name_part = parts[0] if parts else after
        q_resid = " ".join(parts[1:]) if len(parts) > 1 else after
        with get_conn(db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT file_id, file FROM files WHERE file LIKE ? LIMIT 1", (f"%{name_part}%",))
            hit = cur.fetchone()
            if not hit: return []
            fname = hit["file"]
        files = [fname]
        q = q_resid or q

    with get_conn(db_path) as conn:
        if files:
            cands = _fts_candidates_rag_by_files(conn, q, files, limit=400)
        else:
            cands = _fts_candidates_rag(conn, q, limit=400)

        if not cands:
            # semantic fallback over recent chunks (respect filters)
            cur = conn.cursor()
            cur.execute("""
              SELECT c.file_id, c.chunk_id, c.start_char, c.end_char, c.text, c.embedding, f.file, 0.0 AS bm25
              FROM chunks c JOIN files f ON f.file_id=c.file_id
              WHERE c.embedding IS NOT NULL
              ORDER BY f.mtime DESC
              LIMIT 3000
            """)
            rows = cur.fetchall()
        else:
            rows = cands

    rows = _apply_wo_filter(rows, min_wo, max_wo)
    if files:
        rows = [r for r in rows if r["file"] in set(files)]
    if not rows: return []

    scored = _blend_score(rows, q)
    return scored[:top_k]

# ---------------------- Ask ----------------------
def _extractive_answer(question: str, snippets: List[Dict[str, Any]]) -> str:
    if not snippets: return "No supporting snippets found."
    lines = ["Extractive answer (quotes with citations):", ""]
    for i, s in enumerate(snippets, 1):
        lines.append(f"[{i}] {s['file']} (chunk {s['chunk_id']})")
        # keep it compact
        txt = (s["text"] or "").strip()
        txt = re.sub(r"\s+", " ", txt)
        lines.append(f"  “{txt[:400]}{'…' if len(txt) > 400 else ''}”")
        lines.append("")
    lines.append("Tip: switch to Generative mode to summarize these quotes.")
    return "\n".join(lines)

def _generative_answer(question: str, snippets: List[Dict[str, Any]]) -> str:
    need_key()
    blocks = []
    for i, m in enumerate(snippets, 1):
        blocks.append(f"[{i}] {m['file']} | chunk {m['chunk_id']}\n{m['text']}\n")
    prompt = (
        "You are a precise technical assistant. Answer ONLY from the context snippets.\n"
        "When you state a fact, add citations like [1], [2] mapping to the numbered snippets.\n"
        "If the context is insufficient, say so briefly.\n\n"
        f"Question: {question}\n\n"
        "Context:\n" + "\n".join(blocks) + "\n"
        "Answer:"
    )
    model = genai.GenerativeModel(GEMINI_CHAT_MODEL)
    resp = model.generate_content(prompt)
    return (getattr(resp, "text", "") or "").strip() or "(no answer)"

def ask(db_path: str, question: str, k: int = 12,
        min_wo: Optional[int] = None, max_wo: Optional[int] = None,
        files: Optional[List[str]] = None,
        mode: str = "extractive") -> Dict[str, Any]:
    """
    returns: { answer, snippets }
    - If files provided: fairly allocate chunks per file (round-robin).
    - mode: 'extractive' (default) or 'generative'
    """
    ensure_db(db_path)
    files = [f for f in (files or []) if f] or None

    # Get a generous pool first (so round-robin has material)
    pool_k = max(k * 3, 60) if files else max(k * 2, 40)
    all_hits = search(db_path, question, top_k=pool_k, min_wo=min_wo, max_wo=max_wo, files=files)

    if not all_hits:
        return {"answer": "I couldn't find anything relevant in the index.", "snippets": []}

    if files:
        # group by file, keep order, then round-robin
        by_file: Dict[str, List[Dict[str, Any]]] = {}
        for h in all_hits:
            by_file.setdefault(h["file"], []).append(h)
        per_file_lists = [by_file[f] for f in files if f in by_file]
        snippets = _round_robin(per_file_lists, k)
    else:
        snippets = all_hits[:k]

    if mode == "extractive":
        answer = _extractive_answer(question, snippets)
    else:
        try:
            answer = _generative_answer(question, snippets)
        except Exception as e:
            dprint("generative failed; falling back to extractive:", e)
            answer = _extractive_answer(question, snippets)

    return {"answer": answer, "snippets": snippets}

# ---------------------- Stats / maintenance ----------------------
def stats(db_path: str) -> Dict[str, Any]:
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn)
        cur = conn.cursor()
        if kind == "rag":
            cur.execute("SELECT COUNT(*) FROM files"); files = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM chunks"); chunks = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL"); emb = cur.fetchone()[0]
            return {"files": files, "chunks": chunks, "embedded_chunks": emb, "schema": "rag"}
        if kind == "admin":
            cur.execute("SELECT COUNT(*) FROM chunks"); chunks = cur.fetchone()[0]
            try:
                cur.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL"); emb = cur.fetchone()[0]
            except Exception: emb = 0
            return {"files": None, "chunks": chunks, "embedded_chunks": emb, "schema": "admin"}
        return {"files": None, "chunks": None, "embedded_chunks": None, "schema": "unknown"}

def list_files(db_path: str) -> List[str]:
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn); cur = conn.cursor()
        if kind == "rag":
            try:
                cur.execute("SELECT file FROM files ORDER BY file"); files = [r[0] for r in cur.fetchall()]
                if files: return files
            except Exception: pass
            cur.execute("SELECT DISTINCT file FROM chunks ORDER BY file")
            return [r[0] for r in cur.fetchall()]
        if kind == "admin":
            cur.execute("SELECT DISTINCT file FROM chunks ORDER BY file")
            return [r[0] for r in cur.fetchall()]
        return []

def embed_missing(db_path: str, batch: int = 32) -> int:
    need_key()
    updated = 0
    with get_conn(db_path) as conn:
        kind = _schema_kind(conn); cur = conn.cursor()
        if kind == "rag":
            cur.execute("SELECT rowid, text FROM chunks WHERE embedding IS NULL ORDER BY file_id, chunk_id")
        elif kind == "admin":
            try: cur.execute("SELECT rowid, text FROM chunks WHERE embedding IS NULL")
            except Exception: return 0
        else:
            return 0
        rows = cur.fetchall()
        for i in range(0, len(rows), batch):
            part = rows[i:i+batch]
            vecs = embed_texts_gemini([r["text"] or "" for r in part])
            for r, v in zip(part, vecs):
                cur.execute("UPDATE chunks SET embedding=? WHERE rowid=?",
                            (v.astype(np.float32).tobytes(), r["rowid"]))
            conn.commit(); updated += len(part)
    return updated

# ---------------------- Routes ----------------------
def _to_int(x):
    try:
        if x is None or str(x).strip() == "": return None
        return int(str(x).strip())
    except Exception:
        return None

@rag_bp.route("/api/rag/search", methods=["POST"])
def api_search():
    data = request.get_json() or {}
    q = (data.get("query") or "").strip()
    k = int(data.get("k") or 12)
    db = _db_path(data.get("db"))
    min_wo = _to_int(data.get("min_wo")); max_wo = _to_int(data.get("max_wo"))
    files = data.get("files") or None
    if files and not isinstance(files, list): files = None
    if not q: return jsonify({"error": "Missing query"}), 400
    try:
        res = search(db, q, top_k=k, min_wo=min_wo, max_wo=max_wo, files=files)
        return jsonify({"results": res})
    except Exception as e:
        return jsonify({"error": f"Search failed: {e}"}), 500

@rag_bp.route("/api/rag/ask", methods=["POST"])
def api_ask():
    data = request.get_json() or {}
    question = (data.get("question") or "").strip()
    k = int(data.get("k") or 12)
    db = _db_path(data.get("db"))
    min_wo = _to_int(data.get("min_wo")); max_wo = _to_int(data.get("max_wo"))
    files = data.get("files") or None
    if files and not isinstance(files, list): files = None
    mode = (data.get("mode") or "extractive").lower().strip()
    if mode not in ("extractive", "generative"): mode = "extractive"
    if not question: return jsonify({"error": "Missing question"}), 400
    try:
        res = ask(db, question, k=k, min_wo=min_wo, max_wo=max_wo, files=files, mode=mode)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": f"Ask failed: {e}"}), 500

@rag_bp.route("/api/rag/stats", methods=["GET"])
def api_stats():
    db = _db_path(request.args.get("db"))
    try:
        s = stats(db); s["db"] = os.path.basename(db)
        return jsonify(s)
    except Exception as e:
        return jsonify({"error": f"Stats failed: {e}"}), 500

@rag_bp.route("/api/rag/files", methods=["GET"])
def api_files():
    db = _db_path(request.args.get("db"))
    try:
        return jsonify({"files": list_files(db)})
    except Exception as e:
        return jsonify({"error": f"Files failed: {e}"}), 500

@rag_bp.route("/api/rag/embed-missing", methods=["POST"])
def api_embed_missing():
    data = request.get_json() or {}
    db = _db_path(data.get("db")); batch = int(data.get("batch") or 32)
    try:
        return jsonify({"updated": embed_missing(db, batch=batch)})
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
        res = repair_empty_files(folder, db, pattern=pattern, embed=(not no_embed),
                                 target_words=target_words, overlap=overlap)
        return jsonify(res)
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
