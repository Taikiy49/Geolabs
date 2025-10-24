# server_search.py
from flask import Blueprint, jsonify, request, send_file, abort
import os, sqlite3, re, mimetypes
from pathlib import Path
from datetime import datetime

server_search_bp = Blueprint("server_search", __name__, url_prefix="/api/server-search")

# --- Environment keys ---
DB_ENV   = "SERVER_SEARCH_DB"           # set in app.py to uploads/server_search.db
ROOT_ENV = "SERVER_SEARCH_ROOT"         # optional; default below
ROOT_DEFAULT = r"\\geolabs.lan\fs"      # universal UNC for everyone

# ---------- SQLite helpers (read-only, no schema creation) ----------

def _db_path() -> Path:
    raw = (os.environ.get(DB_ENV) or "").strip()
    if not raw:
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
    r"""
    Security: ensure requested path is under the allowed UNC root.

    Accepts either UNC path (e.g.,  \\geolabs.lan\fs\... ) or a Windows path (e.g., C:\...\fs\...).
    Normalizes to an absolute Path and checks prefix.
    """
    if not path_str:
        abort(400, "Missing path")
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

def _area_of(path_str: str) -> str:
    r"""
    Returns the first folder right under the UNC root, e.g.
        \\geolabs.lan\fs\UserShare-Z\Tomas\... -> 'UserShare-Z'
    """
    root = _effective_root().rstrip("\\/")
    p = str(path_str or "").replace("/", "\\")
    if not p.lower().startswith(root.lower() + "\\"):
        return ""
    rest = p[len(root) + 1 :]
    return rest.split("\\", 1)[0] if rest else ""

def _basename(p: str) -> str:
    return Path(p).name if p else ""

def _has_dirs_table(cur: sqlite3.Cursor) -> bool:
    try:
        cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dirs'")
        return bool(cur.fetchone())
    except Exception:
        return False

def _dirs_has_name_column(cur: sqlite3.Cursor) -> bool:
    try:
        cur.execute("PRAGMA table_info('dirs')")
        cols = [r[1].lower() for r in cur.fetchall()]
        return "name" in cols
    except Exception:
        return False

def _name_matches(name: str, q: str, regex: bool, startswith: bool) -> bool:
    """Client-side name filter used when dirs.name is unavailable."""
    if name is None:
        return False
    if q == "*":
        return True
    if regex:
        try:
            return re.search(q, name, re.IGNORECASE) is not None
        except re.error:
            return False
    if startswith:
        return name.lower().startswith(q.lower())
    return q.lower() in name.lower()

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

@server_search_bp.route("/areas", methods=["GET"])
def areas():
    r"""
    Returns distinct top-level folders (areas) under the UNC root, ranked by count.
    Works even if there is no 'dirs' table or 'name' column.
    """
    try:
        root = _effective_root()
        out = {}
        with _conn_ro() as c:
            cur = c.cursor()
            for r in cur.execute("SELECT path FROM files"):
                a = _area_of(r["path"])
                if a: out[a] = out.get(a, 0) + 1
            if _has_dirs_table(cur):
                for r in cur.execute("SELECT path FROM dirs"):
                    a = _area_of(r["path"])
                    if a: out[a] = out.get(a, 0) + 1
        items = [{"area": k, "count": v} for k, v in out.items()]
        items.sort(key=lambda x: (-x["count"], x["area"].lower()))
        return jsonify({"ok": True, "root": root, "areas": items})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/search", methods=["GET", "POST"])
def search():
    r"""
    GET or POST JSON:
      {
        "query":"foo", "ext":"pdf", "regex":false, "startswith":false,
        "limit":200, "offset":0,
        "kind":"files|folders|both",
        "area":"UserShare",                # optional
        "path_prefix":"\\geolabs.lan\\fs\\UserShare\\7200 Series",  # optional
        "sort_by":"mtime|name|ext|area",
        "order":"asc|desc"
      }

    Returns: { ok, count, items:[{kind, name, ext, path, size, modified, mtime, area}] }
    """
    try:
        if request.method == "POST":
            body = (request.get_json(silent=True) or {})
            q = (body.get("query") or "").strip()
            ext = (body.get("ext") or "").strip().lower()
            regex = bool(body.get("regex", False))
            startswith = bool(body.get("startswith", False))
            limit = int(body.get("limit", 200))
            offset = int(body.get("offset", 0))
            kind = (body.get("kind") or "files").strip().lower()
            area = (body.get("area") or "").strip()
            path_prefix = (body.get("path_prefix") or "").strip()
            sort_by = (body.get("sort_by") or "mtime").strip().lower()
            order = (body.get("order") or "desc").strip().lower()
        else:
            args = request.args
            q = (args.get("q") or "").strip()
            ext = (args.get("ext") or "").strip().lower()
            regex = (args.get("regex", "false").lower() == "true")
            startswith = (args.get("startswith", "false").lower() == "true")
            limit = int(args.get("limit", 200))
            offset = int(args.get("offset", 0))
            kind = (args.get("kind") or "files").strip().lower()
            area = (args.get("area") or "").strip()
            path_prefix = (args.get("path_prefix") or "").strip()
            sort_by = (args.get("sort_by") or "mtime").strip().lower()
            order = (args.get("order") or "desc").strip().lower()

        if not q:
            return jsonify({"ok": False, "error": "Missing query"}), 400
        limit = max(1, min(1000, limit))
        offset = max(0, offset)
        if kind not in ("files", "folders", "both"):
            kind = "files"
        if sort_by not in ("mtime", "name", "ext", "area"):
            sort_by = "mtime"
        if order not in ("asc", "desc"):
            order = "desc"

        root = _effective_root().rstrip("\\/")
        # Build a LIKE filter for root always (safety)
        path_filters = ["path LIKE ?"]
        params_common = [root + "%"]

        # Area filter
        if area:
            area_prefix = f"{root}\\{area}\\%"
            path_filters.append("path LIKE ?")
            params_common.append(area_prefix)

        # Path prefix filter (normalize into UNC under root)
        if path_prefix:
            try:
                scoped = _ensure_under_root(path_prefix)
                path_filters.append("path LIKE ?")
                params_common.append(str(scoped).replace("/", "\\") + "%")
            except Exception:
                # ignore invalid prefixes
                pass

        # Name filter (for FILES only — for DIRS it's conditional)
        if regex:
            name_clause = "name REGEXP ?"
            name_param = q
        elif startswith:
            name_clause = "name LIKE ?"
            name_param = q + "%"
        else:
            # allow "*" to match anything
            name_clause = "name LIKE ?"
            name_param = "%" if q == "*" else f"%{q}%"

        items = []
        with _conn_ro() as c:
            cur = c.cursor()

            # ---------------- Files ----------------
            if kind in ("files", "both"):
                wheres = [name_clause] + path_filters
                params = [name_param] + params_common

                if ext:
                    wheres.append("LOWER(ext) = ?")
                    params.append(ext)

                sql_files = (
                    "SELECT name, LOWER(ext) AS ext, path, size, mtime, "
                    "       datetime(mtime, 'unixepoch') AS modified "
                    "FROM files "
                    "WHERE " + " AND ".join(wheres) + " "
                    f"ORDER BY { 'mtime' if sort_by=='mtime' else ('name' if sort_by in ('name','area','ext') else 'mtime') } {order.upper()} "
                    "LIMIT ? OFFSET ?"
                )
                params_files = params + [limit, offset]
                rows = cur.execute(sql_files, params_files).fetchall()
                for r in rows:
                    row = dict(r)
                    row["kind"] = "file"
                    row["area"] = _area_of(row.get("path"))
                    items.append(row)

            # ---------------- Folders ----------------
            if kind in ("folders", "both") and _has_dirs_table(cur):
                dirs_has_name = _dirs_has_name_column(cur)

                wheres = path_filters[:]  # always restrict by root/area/prefix
                params = params_common[:]

                if dirs_has_name:
                    # We can filter and sort by name in SQL directly
                    wheres_sql = [name_clause] + wheres
                    params_sql = [name_param] + params
                    sql_dirs = (
                        "SELECT name, path, mtime, "
                        "       datetime(mtime, 'unixepoch') AS modified "
                        "FROM dirs "
                        "WHERE " + " AND ".join(wheres_sql) + " "
                        f"ORDER BY { 'mtime' if sort_by=='mtime' else 'name' } {order.upper()} "
                        "LIMIT ? OFFSET ?"
                    )
                    params_dirs = params_sql + [limit, offset]
                    rows = cur.execute(sql_dirs, params_dirs).fetchall()
                    for r in rows:
                        row = dict(r)
                        row["kind"] = "folder"
                        row["ext"] = None
                        row["size"] = None
                        row["area"] = _area_of(row.get("path"))
                        items.append(row)
                else:
                    # No name column → fetch candidates and filter/sort in Python
                    sql_dirs = (
                        "SELECT path, mtime, "
                        "       datetime(mtime, 'unixepoch') AS modified "
                        "FROM dirs "
                        "WHERE " + " AND ".join(wheres) + " "
                        f"ORDER BY { 'mtime' if sort_by=='mtime' else 'mtime' } {order.upper()} "
                        "LIMIT ? OFFSET ?"
                    )
                    params_dirs = params + [limit, offset]
                    rows = cur.execute(sql_dirs, params_dirs).fetchall()
                    for r in rows:
                        rec = dict(r)
                        rec["name"] = _basename(rec["path"])
                        if not _name_matches(rec["name"], q, regex, startswith):
                            continue
                        rec["kind"] = "folder"
                        rec["ext"] = None
                        rec["size"] = None
                        rec["area"] = _area_of(rec.get("path"))
                        items.append(rec)

        # ---------------- Final sort/window (for area/ext/name Python sorts) ----------------
        if sort_by == "area":
            items.sort(key=lambda x: ((x.get("area") or "").lower(), (x.get("name") or "").lower()),
                       reverse=(order == "desc"))
        elif sort_by == "ext":
            items.sort(key=lambda x: ((x.get("ext") or "").lower(), (x.get("name") or "").lower()),
                       reverse=(order == "desc"))
        elif sort_by == "name":
            items.sort(key=lambda x: (x.get("name") or "").lower(), reverse=(order == "desc"))
        else:  # mtime
            items.sort(key=lambda x: (x.get("mtime") or 0), reverse=(order == "desc"))

        # Simple windowing after merge (keeps behavior consistent when kind == 'both')
        windowed = items[:limit]

        return jsonify({"ok": True, "count": len(windowed), "items": windowed})

    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    except sqlite3.OperationalError as oe:
        return jsonify({"ok": False, "error": f"{oe}. Is the required table present?"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@server_search_bp.route("/download", methods=["GET"])
def download():
    r"""
    Streams the file to the browser so users can open it even if their
    local drive mappings differ. We only allow files under SERVER_SEARCH_ROOT.

    Usage:
      GET /api/server-search/download?path=\\geolabs.lan\fs\...\file.pdf
    """
    raw = request.args.get("path", "")
    try:
        target = _ensure_under_root(raw)
        if not target.exists() or target.is_dir():
            return jsonify({"ok": False, "error": "File not found"}), 404
        mime, _ = mimetypes.guess_type(target.name)
        return send_file(
            target,
            mimetype=mime or "application/octet-stream",
            as_attachment=False,
            download_name=target.name,
            conditional=True,
            max_age=0,
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
