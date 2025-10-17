# server_search.py
from flask import Blueprint, jsonify, request, send_file, abort
import os, sqlite3, re, mimetypes
from pathlib import Path

server_search_bp = Blueprint("server_search", __name__, url_prefix="/api/server-search")

# --- Environment keys ---
DB_ENV   = "SERVER_SEARCH_DB"           # set in app.py to uploads/server_search.db
ROOT_ENV = "SERVER_SEARCH_ROOT"         # optional; default below
ROOT_DEFAULT = r"\\geolabs.lan\fs"      # universal UNC for everyone

# ---------- SQLite helpers (read-only, no schema creation) ----------

def _db_path() -> Path:
    raw = (os.environ.get(DB_ENV) or "").strip()
    if not raw:
        # fallback to local uploads/server_search.db next to this file
        p = Path(__file__).parent.joinpath("uploads/server_search.db").resolve()
    else:
        p = Path(raw).resolve()
    if not p.exists():
        raise FileNotFoundError(f"DB not found at {p}")
    return p

def _regexp(expr, item):
    if item is None:
        return 0
    try:
        return 1 if re.search(expr, item, re.IGNORECASE) else 0
    except re.error:
        return 0

def _conn_ro() -> sqlite3.Connection:
    p = _db_path()
    uri = f"file:{p.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.create_function("REGEXP", 2, _regexp)
    return conn

def _effective_root() -> str:
    return (os.environ.get(ROOT_ENV) or ROOT_DEFAULT).rstrip("\\/")

def _ensure_under_root(path_str: str) -> Path:
    """
    Security: ensure requested path is under the allowed UNC root.
    Accepts either UNC path (\\geolabs.lan\fs\...) or a Windows path (C:\...\fs\...).
    Normalizes to an absolute Path and checks prefix.
    """
    if not path_str:
        abort(400, "Missing path")
    # Normalize slashes and resolve
    p = Path(path_str)
    root = _effective_root()
    if str(p).startswith("\\\\"):  # UNC
        unc = str(p)
    else:
        # Strip drive (C:\ or Z:\) -> \rest\of\path, then join to UNC root
        rest = re.sub(r"^[A-Za-z]:", "", str(p))
        rest = rest.replace("/", "\\")
        if rest.startswith("\\"):
            unc = root + rest
        else:
            unc = root + "\\" + rest

    unc_norm = unc.replace("/", "\\")
    if not unc_norm.lower().startswith(root.lower() + "\\") and unc_norm.lower() != root.lower():
        abort(403, f"Path outside allowed root: {unc_norm}")
    return Path(unc_norm)

# ---------- Routes ----------

@server_search_bp.route("/health", methods=["GET"])
def health():
    try:
        p = _db_path()
        with _conn_ro() as c:
            c.execute("SELECT 1")
        return jsonify({"ok": True, "db": str(p), "root": _effective_root()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/stats", methods=["GET"])
def stats():
    try:
        with _conn_ro() as c:
            n  = c.execute("SELECT COUNT(1) FROM files").fetchone()[0]
            mn = c.execute("SELECT MIN(mtime) FROM files").fetchone()[0]
            mx = c.execute("SELECT MAX(mtime) FROM files").fetchone()[0]
        return jsonify({"ok": True, "files": n, "mtime": {"oldest": mn, "newest": mx}})
    except sqlite3.OperationalError as oe:
        return jsonify({"ok": False, "error": f"{oe}. Missing 'files' table."}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/exts", methods=["GET"])
def exts():
    try:
        with _conn_ro() as c:
            rows = c.execute("""
                SELECT LOWER(COALESCE(NULLIF(ext,''),'(none)')) AS ext, COUNT(*) AS n
                FROM files
                GROUP BY ext
                ORDER BY n DESC
                LIMIT 500
            """).fetchall()
        return jsonify({"ok": True, "exts": [{"ext": r["ext"], "count": r["n"]} for r in rows]})
    except sqlite3.OperationalError as oe:
        return jsonify({"ok": False, "error": f"{oe}. Missing 'files' table."}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/search", methods=["GET", "POST"])
def search():
    """
    GET:
      /api/server-search/search?q=foo&ext=pdf&regex=false&startswith=false&limit=200&offset=0
    POST JSON:
      { "query":"foo", "ext":"pdf", "regex":false, "startswith":false, "limit":200, "offset":0 }

    Returns: { ok, count, items:[{name, ext, path, size, modified, mtime}] }
    """
    try:
        if request.method == "POST":
            body = request.get_json(silent=True) or {}
            q = (body.get("query") or "").strip()
            ext = (body.get("ext") or "").strip().lower()
            regex = bool(body.get("regex", False))
            startswith = bool(body.get("startswith", False))
            limit = int(body.get("limit", 200))
            offset = int(body.get("offset", 0))
        else:
            q = (request.args.get("q") or "").strip()
            ext = (request.args.get("ext") or "").strip().lower()
            regex = (request.args.get("regex", "false").lower() == "true")
            startswith = (request.args.get("startswith", "false").lower() == "true")
            limit = int(request.args.get("limit", 200))
            offset = int(request.args.get("offset", 0))

        if not q:
            return jsonify({"ok": False, "error": "Missing query"}), 400
        limit = max(1, min(1000, limit))
        offset = max(0, offset)

        wheres, params = [], []

        if regex:
            wheres.append("name REGEXP ?")
            params.append(q)
        elif startswith:
            wheres.append("name LIKE ?")
            params.append(q + "%")
        else:
            wheres.append("name LIKE ?")
            params.append(f"%{q}%")

        if ext:
            wheres.append("LOWER(ext) = ?")
            params.append(ext)

        # Optional root constraint
        root = _effective_root()
        wheres.append("path LIKE ?")
        params.append(root.rstrip("\\/") + "%")

        sql = (
            "SELECT name, LOWER(ext) AS ext, path, size, mtime, "
            "       datetime(mtime, 'unixepoch') AS modified "
            "FROM files "
            "WHERE " + " AND ".join(wheres) + " "
            "ORDER BY mtime DESC "
            "LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])

        with _conn_ro() as c:
            rows = [dict(r) for r in c.execute(sql, params).fetchall()]

        return jsonify({"ok": True, "count": len(rows), "items": rows})

    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    except sqlite3.OperationalError as oe:
        return jsonify({"ok": False, "error": f"{oe}. Is the 'files' table present?"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/download", methods=["GET"])
def download():
    """
    Streams the file to the browser so users can open it even if their
    local drive mappings differ. We only allow files under SERVER_SEARCH_ROOT.
    Usage:
      GET /api/server-search/download?path=\\geolabs.lan\fs\...\file.pdf
    """
    raw = request.args.get("path", "")
    try:
        target = _ensure_under_root(raw)
        if not target.exists():
            return jsonify({"ok": False, "error": "File not found"}), 404
        mime, _ = mimetypes.guess_type(target.name)
        return send_file(
            target,
            mimetype=mime or "application/octet-stream",
            as_attachment=False,  # stays "view in browser" where possible
            download_name=target.name,
            conditional=True,
            max_age=0,
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
