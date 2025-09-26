# ask_ai.py
# Flask Blueprint for Ask AI endpoints used by your React front-end.
# No external LLM dependency; small helpers included to avoid import issues.

from __future__ import annotations
import os
import re
import sqlite3
from datetime import datetime
from typing import Iterable, List, Dict, Tuple

from flask import Blueprint, jsonify, request

# -----------------------------------------------------------------------------
# Paths & constants
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Blueprint
# -----------------------------------------------------------------------------
askai_bp = Blueprint("askai", __name__)

# -----------------------------------------------------------------------------
# One-time DB init
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Tiny search/rank helpers (self-contained, no relative imports)
# -----------------------------------------------------------------------------
_word_re = re.compile(r"[A-Za-z0-9_%-]{2,}")

def _terms(q: str) -> List[str]:
    return [t.lower() for t in _word_re.findall(q or "")]

def _connect(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def _count_hits(text: str, terms: Iterable[str]) -> int:
    if not text:
        return 0
    tl = text.lower()
    return sum(tl.count(t) for t in terms)

def _maybe_int_wo(val):
    if val is None:
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    s = str(val)
    m = re.search(r"(\d{4,})", s)
    return int(m.group(1)) if m else None

def _get_wo_from_row(row: sqlite3.Row) -> int | None:
    for key in ("wo", "WO", "work_order", "WorkOrder", "wo_num"):
        if key in row.keys():
            return _maybe_int_wo(row[key])
    if "file" in row.keys():
        return _maybe_int_wo(row["file"])
    return None

def _get_table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [r["name"] for r in rows]

def rank_documents(
    query: str,
    db_path: str,
    min_wo: int = 0,
    max_wo: int = 99999,
    top_k: int = 30,
) -> List[Dict[str, object]]:
    terms = [t for t in _terms(query) if t]
    if not terms:
        return []

    with _connect(db_path) as conn:
        cols = [c.lower() for c in _get_table_columns(conn, "chunks")]
        if "file" not in cols or "content" not in cols:
            return []

        like_clauses = " OR ".join(["content LIKE ?"] * len(terms))
        like_params = [f"%{t}%" for t in terms]

        rows = conn.execute(
            f"""
            SELECT file, content, COALESCE(wo, WO, work_order) AS wo
            FROM chunks
            WHERE {like_clauses}
            """,
            like_params,
        ).fetchall()

    scores: Dict[str, float] = {}
    file_lengths: Dict[str, int] = {}

    for row in rows:
        f = row["file"]
        content = row["content"] or ""
        hits = _count_hits(content, terms)
        if hits <= 0:
            continue

        wo_val = _get_wo_from_row(row)
        if wo_val is not None and (wo_val < min_wo or wo_val > max_wo):
            continue

        scores[f] = scores.get(f, 0.0) + float(hits)
        file_lengths[f] = file_lengths.get(f, 0) + len(content)

    if not scores:
        return []

    ranked: List[Tuple[str, float]] = []
    for f, sc in scores.items():
        length = max(file_lengths.get(f, 1), 1)
        norm = sc / (1.0 + (length / 20000.0))
        ranked.append((f, norm))

    ranked.sort(key=lambda x: x[1], reverse=True)
    return [{"file": f, "score": round(s, 2)} for f, s in ranked[: max(1, top_k)]]

def get_quick_view_sentences(
    file: str,
    query: str,
    db_path: str,
    limit: int = 8,
) -> List[str]:
    terms = [t for t in _terms(query) if t]
    if not terms:
        return []

    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT content FROM chunks WHERE file = ?",
            (file,),
        ).fetchall()

    text = " ".join((row["content"] or "") for row in rows)
    pieces = re.split(r"(?<=[.!?])\s+|\n+", text)
    scored = []
    for s in pieces:
        hits = _count_hits(s, terms)
        if hits > 0:
            snip = s.strip()
            if len(snip) > 240:
                snip = snip[:237].rstrip() + "…"
            scored.append((snip, hits))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [s for s, _ in scored[: max(1, limit)]]

def ask_gemini_single_file(
    query: str,
    file: str,
    snippets: Iterable[str],
    user: str | None = None,
    use_cache: bool = False,
    use_web: bool = False,
) -> str:
    snips = [s.strip() for s in (snippets or []) if s and s.strip()]
    if not snips:
        return "I couldn't find relevant text for your question in that file."

    lead = snips[0]
    if len(lead) > 220:
        lead = lead[:217].rstrip() + "…"

    bullets = "\n".join(f"- {s}" for s in snips[1:6])
    bullets = f"\n{bullets}" if bullets else ""
    return (
        f"**Answer based on _{os.path.basename(file)}_**\n\n"
        f"{lead}{bullets}\n\n"
        "_Source: selected file; best-matched excerpts shown._"
    )

# -----------------------------------------------------------------------------
# Helpers for this blueprint
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@askai_bp.get("/list-dbs")
def list_dbs():
    try:
        print(f"[list-dbs] UPLOADS_DIR = {UPLOADS_DIR}")
        if os.path.exists(UPLOADS_DIR):
            print(f"[list-dbs] raw dir = {os.listdir(UPLOADS_DIR)}")
        else:
            print("[list-dbs] uploads dir does NOT exist")

        dbs = _list_user_dbs()
        print(f"[list-dbs] returned (filtered) = {dbs}")
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
        max_wo = int(data.get("max", 99999))
        db_name = data.get("db") or "reports.db"  # optional param

        if not query:
            return jsonify({"error": "Empty keyword."}), 400

        db_path = _safe_db_path(db_name)
        ranked = rank_documents(query, db_path, min_wo, max_wo, top_k=30)

        # Cache a lightweight line in chat_history for UX continuity
        with sqlite3.connect(CHAT_DB) as conn:
            # avoid duplicates
            cur = conn.execute(
                """
                SELECT 1 FROM chat_history
                WHERE user = ? AND LOWER(question) = LOWER(?) AND answer = '[Ranking Only - No answer]'
                ORDER BY id DESC LIMIT 1
                """,
                (user, query),
            )
            if cur.fetchone() is None:
                conn.execute(
                    """
                    INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user,
                        query,
                        "[Ranking Only - No answer]",
                        ",".join(doc["file"] for doc in ranked),
                        datetime.now().isoformat(),
                        db_name,
                    ),
                )

        return jsonify({"ranked_files": [{"file": d["file"], "score": d["score"]} for d in ranked]})
    except Exception as e:
        print("❌ /api/rank_only error:", e)
        return jsonify({"error": "Failed to rank documents."}), 500


@askai_bp.post("/single_file_answer")
def single_file_answer():
    """Build an answer from a single file using quick snippets."""
    try:
        data = request.get_json(force=True) or {}
        query = (data.get("query") or "").strip()
        file = data.get("file")
        db_name = data.get("db") or "reports.db"
        user = data.get("user") or "guest"

        if not query or not file:
            return jsonify({"error": "Missing query or file."}), 400

        db_path = _safe_db_path(db_name)
        snippets = get_quick_view_sentences(file, query, db_path)
        answer = ask_gemini_single_file(query, file, snippets, user=user)

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
    The main chat endpoint used by your UI.
    Picks top file via ranker, extracts snippets, synthesizes a compact answer,
    caches in chat_history, and returns {"answer": "..."}.
    """
    try:
        data = request.get_json(force=True) or {}
        query = (data.get("query") or "").strip()
        db_name = (data.get("db") or "").strip()
        user = data.get("user") or "guest"
        use_cache = bool(data.get("use_cache", True))
        use_web = bool(data.get("use_web", False))
        min_wo = int(data.get("min", 0))
        max_wo = int(data.get("max", 99999))

        if not query or not db_name:
            return jsonify({"error": "Missing query or database name."}), 400

        if db_name in RESTRICTED_DBS:
            return jsonify({"error": "Restricted database."}), 403

        db_path = _safe_db_path(db_name)

        ranked = rank_documents(
            query,
            db_path,
            min_wo=min_wo if "handbook" not in db_path else 0,
            max_wo=max_wo if "handbook" not in db_path else 99999,
            top_k=30,
        )
        if not ranked:
            return jsonify({"answer": "No relevant documents found."})

        top_file = ranked[0]["file"]

        if use_cache:
            with sqlite3.connect(CHAT_DB) as conn:
                cur = conn.execute(
                    """
                    SELECT answer FROM chat_history
                    WHERE user = ? AND db_name = ? AND sources = ? AND LOWER(question) = LOWER(?)
                    ORDER BY id DESC LIMIT 1
                    """,
                    (user, db_name, top_file, query),
                )
                row = cur.fetchone()
                if row:
                    return jsonify({"answer": row[0]})

        snippets = get_quick_view_sentences(top_file, query, db_path)
        answer = ask_gemini_single_file(query, top_file, snippets, user=user, use_cache=False, use_web=use_web)

        with sqlite3.connect(CHAT_DB) as conn:
            conn.execute(
                """
                INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user, query, answer, top_file, datetime.now().isoformat(), db_name),
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
        snippets = get_quick_view_sentences(filename, query, db_path)
        return jsonify({"snippets": snippets})
    except Exception as e:
        print("❌ /api/quick_view error:", e)
        return jsonify({"error": "Unable to generate quick view."}), 500
