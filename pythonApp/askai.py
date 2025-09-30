# askai.py
# Flask Blueprint for Ask AI endpoints used by your React front-end.
# Self-contained (no external engine module). Multi-source synthesis from top-20 chunks.

from __future__ import annotations
import os
import re
import sqlite3
from datetime import datetime
from typing import Iterable, List, Dict, Tuple, Optional

from flask import Blueprint, jsonify, request

# -----------------------------
# Gemini setup (google-generativeai)
# -----------------------------
_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")

_gemini_client_ok = False
try:
    if _GEMINI_KEY:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=_GEMINI_KEY)
        _gemini_client_ok = True
    else:
        print("⚠️ GEMINI_API_KEY not set; answers will be extractive only.")
except Exception as _e:
    print("⚠️ Gemini client init failed:", _e)
    _gemini_client_ok = False

# -----------------------------
# Paths & constants
# -----------------------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

# Dedicated chat history DB (separate from content DBs in uploads/)
CHAT_DB = os.path.join(UPLOADS_DIR, "chat_history.db")

# Databases to hide from the "Select database" dropdown
RESTRICTED_DBS = {
    "chat_history.db",
    "reports.db",
    "user_roles.db",
    "pr_data.db",
    "users.db",
}

# Enable admin endpoints to build chunk DBs
ENABLE_ADMIN = os.getenv("ASKAI_ENABLE_ADMIN", "0") == "1"

askai_bp = Blueprint("askai", __name__)

# -----------------------------
# One-time DB init (chat history)
# -----------------------------
def _init_chat_db() -> None:
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with sqlite3.connect(CHAT_DB) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user      TEXT,
                question  TEXT,
                answer    TEXT,
                sources   TEXT,
                timestamp TEXT,
                db_name   TEXT
            )
            """
        )

_init_chat_db()

# -----------------------------
# Utilities (schema + search)
# -----------------------------
_word_re = re.compile(r"[A-Za-z0-9_%-]{2,}")

CONTENT_COL_CANDIDATES = ["content", "text", "body", "chunk"]
FILE_COL_CANDIDATES = ["file", "filename", "source", "doc", "path"]
WO_COL_CANDIDATES = ["wo", "work_order", "wo_num", "workorder"]
KNOWN_BASE_TABLES = ["chunks", "pages", "documents"]

# light synonyms to help HR queries like PTO/bereavement
SYNONYMS = {
    "pto": ["pto", "paid time off", "vacation", "leave", "time off"],
    "bereavement": ["bereavement", "funeral", "death in family", "compassionate leave"],
    "holiday": ["holiday", "holidays", "observed", "company holiday"],
    "sick": ["sick", "illness", "medical leave"],
}

def _terms(q: str) -> List[str]:
    return [t.lower() for t in _word_re.findall(q or "")]

def _expand_terms(ts: List[str]) -> List[str]:
    out = set(ts)
    for t in ts:
        for _, syns in SYNONYMS.items():
            if t in syns:
                out.update(syns)
    for k, syns in SYNONYMS.items():
        if k in ts:
            out.update(syns)
    return list(out)

def _connect(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def _list_user_dbs() -> List[str]:
    """Scan uploads/ for .db files (excluding restricted)."""
    if not os.path.exists(UPLOADS_DIR):
        return []
    out = []
    for name in os.listdir(UPLOADS_DIR):
        if not name.lower().endswith(".db"):
            continue
        if name in RESTRICTED_DBS:
            continue
        out.append(name)
    out.sort()
    return out

def _safe_db_path(name: str) -> str:
    """Constrain to uploads folder and ensure existence."""
    if not name or any(ch in name for ch in ("/", "\\", "..")):
        raise FileNotFoundError("Invalid db name.")
    path = os.path.join(UPLOADS_DIR, name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Database {name} not found.")
    return path

def _list_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return [r[0] for r in rows]

def _table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]

def _table_has_any(conn: sqlite3.Connection, table: str, candidates: Iterable[str]) -> Optional[str]:
    cols = [c.lower() for c in _table_columns(conn, table)]
    for cand in candidates:
        if cand.lower() in cols:
            for wc in _table_columns(conn, table):
                if wc.lower() == cand.lower():
                    return wc
    return None

def _detect_content_table(conn: sqlite3.Connection) -> Tuple[str, str]:
    """
    Find a table with textual chunks. Prefer <known>_fts, then any *_fts,
    then known base tables, then any with a content-like column.
    Returns (table_name, content_col).
    """
    tables = _list_tables(conn)

    # known FTS companions
    for base in KNOWN_BASE_TABLES:
        fts = f"{base}_fts"
        if fts in tables:
            cc = _table_has_any(conn, fts, CONTENT_COL_CANDIDATES)
            if cc:
                return (fts, cc)

    # any FTS
    for t in tables:
        if t.endswith("_fts"):
            cc = _table_has_any(conn, t, CONTENT_COL_CANDIDATES)
            if cc:
                return (t, cc)

    # known base tables
    for base in KNOWN_BASE_TABLES:
        if base in tables:
            cc = _table_has_any(conn, base, CONTENT_COL_CANDIDATES)
            if cc:
                return (base, cc)

    # last resort
    for t in tables:
        cc = _table_has_any(conn, t, CONTENT_COL_CANDIDATES)
        if cc:
            return (t, cc)

    raise RuntimeError("No table with a content-like column found (content/text/body/chunk).")

def _pick_column(conn: sqlite3.Connection, table: str, candidates: List[str]) -> Optional[str]:
    return _table_has_any(conn, table, candidates)

def _file_column(conn: sqlite3.Connection, table: str) -> Optional[str]:
    return _pick_column(conn, table, FILE_COL_CANDIDATES)

def _wo_column(conn: sqlite3.Connection, table: str) -> Optional[str]:
    return _pick_column(conn, table, WO_COL_CANDIDATES)

def _count_hits(text: str, ts: Iterable[str]) -> int:
    if not text:
        return 0
    tl = text.lower()
    return sum(tl.count(t) for t in ts)

def _fts_query_from_terms(ts: List[str]) -> str:
    safe = [re.sub(r'[^A-Za-z0-9_\-./]', ' ', t).strip() for t in ts if t.strip()]
    safe = [s for s in safe if s]
    if not safe: return ""
    # Use OR instead of NEAR; still prefix-match
    return " OR ".join(f"{t}*" for t in safe)


# -----------------------------
# Search + snippet pipeline
# -----------------------------
def search_rows(
    conn: sqlite3.Connection,
    query: str,
    min_wo: int,
    max_wo: int,
    top_k: int = 200,
):
    """
    Returns rows: [{chunk_id, file, content, score}]
    - Prefer FTS5 with BM25; fallback to LIKE
    - Apply WO range if present
    - Soft score by BM25 + term hits
    - De-dup and cap to top_k
    Also prints the selected chunk_ids.
    """
    # Detect table/columns
    table, content_col = _detect_content_table(conn)
    fcol = _file_column(conn, table)
    wcol = _wo_column(conn, table)

    # Figure out a primary key expression we can always SELECT as chunk_id
    # For FTS: use rowid; for normal tables: prefer 'id', else rowid.
    cols_lower = [c.lower() for c in _table_columns(conn, table)]
    is_fts = table.endswith("_fts")
    pk_expr = "rowid" if is_fts else ("id" if "id" in cols_lower else "rowid")

    # Tokenize/expand terms
    ts = _expand_terms(_terms(query))
    if not ts:
        return []

    # Build SELECT column list (include our chunk_id)
    sel_cols = f"{pk_expr} AS chunk_id," \
               f"{(fcol + ',') if fcol else ''}" \
               f"{content_col}" \
               f"{(',' + wcol) if wcol else ''}"

    # Run query via FTS or LIKE
    rows: List[sqlite3.Row] = []
    try:
        if is_fts:
            q = _fts_query_from_terms(ts)
            if not q:
                return []
            rows = conn.execute(
                f"""
                SELECT {sel_cols}, bm25({table}) AS _bm25
                FROM {table}
                WHERE {table} MATCH ?
                ORDER BY _bm25 ASC
                LIMIT ?
                """,
                (q, top_k * 5),
            ).fetchall()
        else:
            like_clauses = " OR ".join([f"{content_col} LIKE ?"] * len(ts))
            like_params = [f"%{t}%" for t in ts]
            rows = conn.execute(
                f"SELECT {sel_cols} FROM {table} WHERE {like_clauses} LIMIT ?",
                (*like_params, top_k * 5),
            ).fetchall()
    except Exception as e:
        # Defensive fallback to LIKE
        print("⚠️ FTS failed; fallback to LIKE:", e)
        like_clauses = " OR ".join([f"{content_col} LIKE ?"] * len(ts))
        like_params = [f"%{t}%" for t in ts]
        rows = conn.execute(
            f"SELECT {sel_cols} FROM {table} WHERE {like_clauses} LIMIT ?",
            (*like_params, top_k * 5),
        ).fetchall()

    # Convert to scored results
    results: List[Dict] = []
    for r in rows:
        content = r[content_col] if isinstance(r, sqlite3.Row) else r[0]
        if not content:
            continue

        # WO range filter if present
        if wcol:
            try:
                wv = r[wcol]
                if wv is not None:
                    m = re.search(r"(\d{1,})", str(wv))
                    wo_int = int(m.group(1)) if m else None
                    if wo_int is not None and (wo_int < min_wo or wo_int > max_wo):
                        continue
            except Exception:
                pass

        # Score: BM25-aware if available, else hit-count only
        hits = _count_hits(content, ts)
        if "_bm25" in r.keys():
            try:
                bm25 = float(r["_bm25"])
            except Exception:
                bm25 = 10.0
            base = 1.0 / (1.0 + max(0.0, bm25))  # smaller bm25 -> higher score
            score = base * (1.0 + 0.1 * hits)
        else:
            if hits <= 0:
                continue
            score = float(hits)

        results.append({
            "chunk_id": r["chunk_id"],
            "file": (r[fcol] if (fcol and fcol in r.keys()) else None),
            "content": str(content).strip(),
            "score": float(score),
        })

    # Sort, de-dup (by file + first 400 chars), cap to top_k
    results.sort(key=lambda x: x["score"], reverse=True)
    out: List[Dict] = []
    seen = set()
    for item in results:
        key = (item.get("file"), hash(item["content"][:400]))
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= top_k:
            break

    # Print which chunk ids are being returned (as you requested)
    try:
        print(f"🔎 search_rows -> chunk_ids: {[r['chunk_id'] for r in out]}")
    except Exception:
        pass

    return out


def build_snippets_from_top_chunks(rows: List[Dict], max_chunks: int = 20, snip_len: int = 480):
    """
    Take already-scored rows, grab the global top-N chunks,
    trim to sane size, and collect distinct source filenames.
    """
    top = rows[:max_chunks]
    snippets: List[str] = []
    sources: List[str] = []

    for r in top:
        txt = (r.get("content") or "").strip()
        if not txt:
            continue
        if len(txt) > snip_len:
            txt = txt[: snip_len - 1].rstrip() + "…"
        snippets.append(txt)
        sources.append(r.get("file") or "document")

    # de-dup sources while preserving order
    uniq_sources: List[str] = []
    seen = set()
    for f in sources:
        if f not in seen:
            seen.add(f)
            uniq_sources.append(f)

    return {"snippets": snippets, "sources": uniq_sources}

def group_by_file(rows: List[Dict], max_snips_per_file: int = 1, snip_len: int = 400):
    """Used by /rank_only to get a per-file ranking quickly."""
    files: Dict[str, Dict] = {}
    for r in rows:
        f = r.get("file") or "document"
        files.setdefault(f, {"file": f, "snippets": [], "score": 0.0})
        files[f]["score"] += r["score"]

        txt = (r["content"] or "").strip()
        if not txt:
            continue
        snip = txt if len(txt) <= snip_len else (txt[: snip_len - 1].rstrip() + "…")
        files[f]["snippets"].append(snip)

    for f in files.values():
        f["snippets"] = f["snippets"][:max_snips_per_file]
    ranked = sorted(files.values(), key=lambda x: x["score"], reverse=True)
    return ranked

# -----------------------------
# Prompting / synthesis
# -----------------------------
def _build_prompt_multi(question: str, bundle: Dict) -> str:
    snips = "\n".join(f"- {s}" for s in bundle.get("snippets", []))
    srcs = ", ".join(bundle.get("sources", [])[:8])  # keep short in prompt
    prompt = f"""
You are a helpful analyst. Answer the user's question using ONLY the evidence from the snippets below.
If the snippets do not contain the answer, say you don't have enough info.

Question:
{question}

Evidence snippets (from multiple documents):
{snips}

Requirements:
- Be concise and cite specific numbers if present (e.g., PTO days/hours).
- If you infer, say it's a best-effort based on the snippets.
- NEVER fabricate numbers.
- You do not need an introduction like "Based on the document...". Just go straight to the answer!
- End with a short "Sources" line listing the filenames you used.

Sources: {srcs}
"""
    return prompt.strip()

def _build_prompt_single(question: str, fname: str, snippets: List[str]) -> str:
    snips = "\n".join(f"- {s}" for s in snippets)
    prompt = f"""
You are a helpful analyst. Answer the user's question using ONLY the evidence from the snippets below.
If the snippets do not contain the answer, say you don't have enough info.

Question:
{question}

Document: {fname}
Evidence snippets:
{snips}

Requirements:
- Be concise and cite specific numbers if present.
- If you infer, say it's a best-effort based on the snippets.
- NEVER fabricate numbers.
- You do not need an introduction like "Based on the document...". Just go straight to the answer!
- End with a short "Sources" line listing the filename.
"""
    return prompt.strip()

def _gemini_answer_multi(question: str, bundle: Dict) -> str:
    snippets = bundle.get("snippets", [])
    sources = bundle.get("sources", [])
    if not _gemini_client_ok:
        lead = snippets[0] if snippets else "No snippet."
        bullets = "\n".join(f"- {s}" for s in snippets[1:5])
        src = ", ".join(sources) if sources else "documents"
        return f"**Answer (extractive)**\n\n{lead}\n{bullets}\n\n_Sources: {src}_"

    model = genai.GenerativeModel(_GEMINI_MODEL)  # type: ignore
    resp = model.generate_content(_build_prompt_multi(question, bundle))
    text = (getattr(resp, "text", "") or "").strip()
    if not text:
        lead = snippets[0] if snippets else "No snippet."
        src = ", ".join(sources) if sources else "documents"
        text = f"{lead}\n\n_Sources: {src}_"
    if "Sources:" not in text:
        src = ", ".join(sources) if sources else "documents"
        text += f"\n\n_Sources: {src}_"
    return text

def _gemini_answer_single(question: str, filename: str, snippets: List[str]) -> str:
    if not _gemini_client_ok:
        lead = snippets[0] if snippets else "No snippet."
        bullets = "\n".join(f"- {s}" for s in snippets[1:5])
        return f"**Answer (extractive)**\n\n{lead}\n{bullets}\n\n_Sources: {filename}_"
    model = genai.GenerativeModel(_GEMINI_MODEL)  # type: ignore
    resp = model.generate_content(_build_prompt_single(question, filename, snippets))
    text = (getattr(resp, "text", "") or "").strip()
    if not text:
        lead = snippets[0] if snippets else "No snippet."
        text = f"{lead}\n\n_Sources: {filename}_"
    if "Sources:" not in text:
        text += f"\n\n_Sources: {filename}_"
    return text

# -----------------------------
# Optional chunk DB builder (admin)
# -----------------------------
def _create_chunk_db(output_path: str, records: List[Dict]) -> None:
    """
    Build a chunked DB at `output_path` with canonical schema:
      chunks(id INTEGER PK, file TEXT, page INTEGER NULL, wo INTEGER NULL, content TEXT NOT NULL)
      chunks_fts (FTS5 on content) contentless w/ external content=chunks
    `records`: [{file, content, page?, wo?}, ...]
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    if os.path.exists(output_path):
        os.remove(output_path)

    with sqlite3.connect(output_path) as conn:
        conn.execute("""
            CREATE TABLE chunks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              file TEXT NOT NULL,
              page INTEGER,
              wo INTEGER,
              content TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
              content,
              content='chunks',
              content_rowid='id',
              tokenize = "porter unicode61 remove_diacritics 2 tokenchars '-_./'"
            )
        """)
        for r in records:
            file = str(r.get("file") or "document")
            content = str(r.get("content") or "").strip()
            if not content:
                continue
            page = r.get("page")
            wo = r.get("wo")
            cur = conn.execute(
                "INSERT INTO chunks(file, page, wo, content) VALUES (?,?,?,?)",
                (file, page, wo, content),
            )
            rowid = cur.lastrowid
            conn.execute("INSERT INTO chunks_fts(rowid, content) VALUES (?,?)", (rowid, content))
        conn.commit()

# -----------------------------
# Routes
# -----------------------------
@askai_bp.get("/list-dbs")
def list_dbs():
    try:
        dbs = _list_user_dbs()
        return jsonify({"dbs": dbs})
    except Exception as e:
        print("❌ /api/list-dbs error:", e)
        return jsonify({"dbs": []}), 200

@askai_bp.post("/rank_only")
def rank_only():
    """Return ranked file list for the given query (no answer synthesis)."""
    try:
        data = request.get_json(force=True) or {}
        query = (data.get("query") or "").strip()
        user = data.get("user") or "guest"
        min_wo = int(data.get("min", 0))
        max_wo = int(data.get("max", 99999999))
        db_name = data.get("db")
        if not query or not db_name:
            return jsonify({"error": "Missing query or db"}), 400

        db_path = _safe_db_path(db_name)
        with _connect(db_path) as conn:
            rows = search_rows(conn, query, min_wo, max_wo, top_k=120)
            grouped = group_by_file(rows, max_snips_per_file=1)
        ranked = [{"file": f["file"], "score": round(f["score"], 2)} for f in grouped[:30]]

        # Cache lightweight trace
        with sqlite3.connect(CHAT_DB) as conn:
            conn.execute(
                """
                INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user, query, "[Ranking Only - No answer]", ",".join([r["file"] for r in ranked]), datetime.now().isoformat(), db_name),
            )
        return jsonify({"ranked_files": ranked})
    except Exception as e:
        print("❌ /api/rank_only error:", e)
        return jsonify({"error": "Failed to rank documents."}), 500

@askai_bp.post("/single_file_answer")
def single_file_answer():
    """Answer from a single file (quick snippets + Gemini)."""
    try:
        data = request.get_json(force=True) or {}
        query = (data.get("query") or "").strip()
        file = data.get("file")
        db_name = data.get("db")
        user = data.get("user") or "guest"

        if not query or not file or not db_name:
            return jsonify({"error": "Missing query/file/db"}), 400

        db_path = _safe_db_path(db_name)
        with _connect(db_path) as conn:
            table, content_col = _detect_content_table(conn)
            fcol = _file_column(conn, table) or "file"
            rows = conn.execute(
                f"SELECT {content_col} FROM {table} WHERE {fcol} = ?",
                (file,),
            ).fetchall()

        # Build top snippets within that file
        contents = " ".join((r[content_col] or "") for r in rows)
        pieces = re.split(r"(?<=[.!?])\s+|\n+", contents)
        ts = _expand_terms(_terms(query))
        scored: List[Tuple[str, int]] = []
        for s in pieces:
            s2 = (s or "").strip()
            if not s2:
                continue
            hits = _count_hits(s2, ts)
            if hits > 0:
                if len(s2) > 480:
                    s2 = s2[:477].rstrip() + "…"
                scored.append((s2, hits))
        scored.sort(key=lambda x: x[1], reverse=True)
        snippets = [s for s, _ in scored[:8]]

        answer = _gemini_answer_single(query, file, snippets)

        with sqlite3.connect(CHAT_DB) as conn:
            conn.execute(
                """
                INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user, query, answer, file, datetime.now().isoformat(), db_name),
            )
        return jsonify({"answer": answer})
    except Exception as e:
        print("❌ /api/single_file_answer error:", e)
        return jsonify({"error": f"Failed to answer from selected file. {str(e)}"}), 500

@askai_bp.post("/question")
def question():
    """
    Main chat endpoint (multi-source):
    - Searches (FTS/LIKE) with small domain boosts/synonyms
    - Takes the global top-N chunks (default 20)
    - Synthesizes an answer grounded in those snippets
    """
    try:
        data = request.get_json(force=True) or {}
        query = (data.get("query") or "").strip()
        db_name = (data.get("db") or "").strip()
        user = data.get("user") or "guest"
        use_cache = bool(data.get("use_cache", True))
        min_wo = int(data.get("min", 0))
        max_wo = int(data.get("max", 99999999))
        max_chunks = int(data.get("max_chunks", 20))  # client can override

        if not query or not db_name:
            return jsonify({"error": "Missing query or database name."}), 400
        if db_name in RESTRICTED_DBS:
            return jsonify({"error": "Restricted database."}), 403

        db_path = _safe_db_path(db_name)

        # Retrieve many rows, then take the global top-N chunks
        with _connect(db_path) as conn:
            rows = search_rows(conn, query, min_wo, max_wo, top_k=120)
            if not rows:
                return jsonify({"answer": "No relevant documents found."})

        bundle = build_snippets_from_top_chunks(rows, max_chunks=max_chunks, snip_len=99999)
        sources_str = ", ".join(bundle.get("sources", []))

        # Cache hit? (keyed by exact question + joined sources)
        if use_cache:
            with sqlite3.connect(CHAT_DB) as conn:
                cur = conn.execute(
                    """
                    SELECT answer FROM chat_history
                    WHERE user = ? AND db_name = ? AND sources = ? AND LOWER(question) = LOWER(?)
                    ORDER BY id DESC LIMIT 1
                    """,
                    (user, db_name, sources_str, query),
                )
                row = cur.fetchone()
                if row:
                    return jsonify({"answer": row[0]})

        answer = _gemini_answer_multi(query, bundle)

        with sqlite3.connect(CHAT_DB) as conn:
            conn.execute(
                """
                INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user, query, answer, sources_str, datetime.now().isoformat(), db_name),
            )

        return jsonify({"answer": answer})
    except Exception as e:
        print("❌ /api/question error:", e)
        return jsonify({"error": f"Failed to answer question: {str(e)}"}), 500

@askai_bp.get("/chat_history")
def chat_history():
    """Return recent Q/A pairs for a user + db (the UI expects {question, answer})."""
    user = request.args.get("user", "guest")
    db_name = request.args.get("db", "")
    try:
        with sqlite3.connect(CHAT_DB) as conn:
            rows = conn.execute(
                """
                SELECT question, answer
                FROM chat_history
                WHERE user = ? AND db_name = ?
                ORDER BY timestamp DESC
                LIMIT 30
                """,
                (user, db_name),
            ).fetchall()
        history = [{"question": r[0], "answer": r[1]} for r in rows]
        return jsonify(history)
    except Exception as e:
        print("❌ /api/chat_history error:", e)
        return jsonify([])

@askai_bp.delete("/delete-history")
def delete_history():
    """Delete one entry (by exact question) for a user/db."""
    try:
        data = request.get_json(force=True) or {}
        user = data.get("user")
        db_name = data.get("db")
        question = data.get("question")
        if not all([user, db_name, question]):
            return jsonify({"error": "Missing parameters"}), 400
        with sqlite3.connect(CHAT_DB) as conn:
            conn.execute(
                "DELETE FROM chat_history WHERE user=? AND db_name=? AND question=?",
                (user, db_name, question),
            )
            conn.commit()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        print("❌ /api/delete-history error:", e)
        return jsonify({"error": "Failed to delete history"}), 500

@askai_bp.post("/quick_view")
def quick_view():
    """Return quick snippet list for a file+query (used by 'quick view' UIs)."""
    try:
        data = request.get_json(force=True) or {}
        filename = data.get("filename")
        query = data.get("query", "")
        db_name = data.get("db") or ""
        if not filename or not db_name:
            return jsonify({"error": "Filename and db required."}), 400

        db_path = _safe_db_path(db_name)
        with _connect(db_path) as conn:
            table, content_col = _detect_content_table(conn)
            fcol = _file_column(conn, table) or "file"
            rows = conn.execute(
                f"SELECT {content_col} FROM {table} WHERE {fcol} = ?",
                (filename,),
            ).fetchall()
        text = " ".join((r[content_col] or "") for r in rows)
        ts = _expand_terms(_terms(query))
        pieces = re.split(r"(?<=[.!?])\s+|\n+", text)
        scored: List[Tuple[str, int]] = []
        for s in pieces:
            s2 = (s or "").strip()
            if not s2:
                continue
            hits = _count_hits(s2, ts)
            if hits > 0:
                snip = s2 if len(s2) <= 360 else (s2[:357].rstrip() + "…")
                scored.append((snip, hits))
        scored.sort(key=lambda x: x[1], reverse=True)
        snippets = [s for s, _ in scored[:8]]
        return jsonify({"snippets": snippets})
    except Exception as e:
        print("❌ /api/quick_view error:", e)
        return jsonify({"error": "Unable to generate quick view."}), 500

# Diagnostics (handy while wiring new DBs)
@askai_bp.get("/health")
def health():
    return jsonify({
        "uploads_dir": UPLOADS_DIR,
        "gemini_ok": _gemini_client_ok,
        "model": _GEMINI_MODEL,
        "admin_enabled": ENABLE_ADMIN,
    })

@askai_bp.get("/introspect")
def introspect():
    """GET /api/introspect?db=xxx.db — lists tables/columns to debug schema detection."""
    db_name = (request.args.get("db") or "").strip()
    if not db_name:
        return jsonify({"error": "db param required"}), 400
    try:
        db_path = _safe_db_path(db_name)
        with _connect(db_path) as conn:
            tables = _list_tables(conn)
            info = {}
            for t in tables:
                info[t] = _table_columns(conn, t)
        return jsonify({"tables": info})
    except Exception as e:
        print("❌ /api/introspect error:", e)
        return jsonify({"error": "introspect failed"}), 500

# Optional admin endpoint to build chunk DBs
if ENABLE_ADMIN:
    @askai_bp.post("/build-chunks")
    def build_chunks():
        """
        POST JSON:
        {
          "db": "my_new.db",
          "records": [ {"file":"docA.pdf","content":"...","page":1,"wo":123}, ... ]
        }
        """
        try:
            data = request.get_json(force=True) or {}
            name = (data.get("db") or "").strip()
            records = data.get("records") or []
            if not name or not name.lower().endswith(".db"):
                return jsonify({"error": "Provide a target db filename ending in .db"}), 400
            if not isinstance(records, list) or not records:
                return jsonify({"error": "Provide a non-empty 'records' array"}), 400
            out_path = os.path.join(UPLOADS_DIR, name)
            _create_chunk_db(out_path, records)
            return jsonify({"status": "ok", "db": name, "count": len(records)})
        except Exception as e:
            print("❌ /api/build-chunks error:", e)
            return jsonify({"error": "Failed to build chunk DB"}), 500
