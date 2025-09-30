# server/blueprints/core_box_inventory.py
import os
import json
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app

corebox_bp = Blueprint("corebox", __name__)
# --- ensure schema once per process ----------------------------
_SCHEMA_READY = False

@corebox_bp.before_app_request
def _ensure_core_schema_once():
    """Create tables/indexes if missing (runs once per process)."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    try:
        with core_conn() as conn:
            ensure_core_tables(conn)  # <- creates core_boxes & core_boxes_changes if missing
        _SCHEMA_READY = True
        print("✅ core_box_inventory: schema ready")
    except Exception as e:
        print("❌ core_box_inventory: schema init failed:", e)

# --- PATH RESOLUTION ---------------------------------------------------------
def resolve_db_path():
    """
    Order of precedence:
    1) current_app.config['CORE_DB_PATH'] if present
    2) server/uploads/core_box_inventory.db
    3) <project_root>/uploads/core_box_inventory.db  (one level up from server/)
    """
    if current_app and current_app.config.get("CORE_DB_PATH"):
        return os.path.abspath(current_app.config["CORE_DB_PATH"])

    # server package root
    server_root = current_app.root_path if current_app else os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )

    candidates = [
        os.path.join(server_root, "uploads", "core_box_inventory.db"),
        os.path.abspath(os.path.join(server_root, "..", "uploads", "core_box_inventory.db")),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    # fall back to first candidate even if it doesn't exist (so debug shows it)
    return candidates[0]

def core_conn():
    db_path = resolve_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

# --- schema helpers -------------------------------------------------
def ensure_core_tables(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS core_boxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER,
        island TEXT,
        work_order TEXT,
        project TEXT,
        engineer TEXT,
        report_submission_date TEXT,
        storage_expiry_date TEXT,
        complete TEXT,
        keep_or_dump TEXT
    );

    CREATE TABLE IF NOT EXISTS core_boxes_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT,          -- 'create' | 'update' | 'delete' | 'restore'
        core_box_id INTEGER,  -- id at the time of action (may be NULL after delete)
        work_order TEXT,
        user TEXT,
        ts TEXT,              -- ISO timestamp
        old_snapshot TEXT,    -- JSON
        new_snapshot TEXT     -- JSON
    );

    CREATE INDEX IF NOT EXISTS idx_core_year   ON core_boxes(year);
    CREATE INDEX IF NOT EXISTS idx_core_island ON core_boxes(island);
    CREATE INDEX IF NOT EXISTS idx_core_wo     ON core_boxes(work_order);
    CREATE INDEX IF NOT EXISTS idx_core_sub    ON core_boxes(report_submission_date);
    CREATE INDEX IF NOT EXISTS idx_core_exp    ON core_boxes(storage_expiry_date);
    """)

# --- SCHEMA/INDICES ----------------------------------------------------------
def init_corebox_schema_and_indices():
    with core_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS core_boxes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            year INTEGER,
            island TEXT,
            work_order TEXT,
            project TEXT,
            engineer TEXT,
            report_submission_date TEXT,
            storage_expiry_date TEXT,
            complete TEXT,
            keep_or_dump TEXT
        );
                           

        CREATE TABLE IF NOT EXISTS core_boxes_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT,
            core_box_id INTEGER,
            work_order TEXT,
            user TEXT,
            ts TEXT,
            old_snapshot TEXT,
            new_snapshot TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_core_year   ON core_boxes(year);
        CREATE INDEX IF NOT EXISTS idx_core_island ON core_boxes(island);
        CREATE INDEX IF NOT EXISTS idx_core_wo     ON core_boxes(work_order);
        CREATE INDEX IF NOT EXISTS idx_core_sub    ON core_boxes(report_submission_date);
        CREATE INDEX IF NOT EXISTS idx_core_exp    ON core_boxes(storage_expiry_date);
        """)
# call once at import (safe if table exists)
# (You can also call this from app factory after you set config path.)
# init_corebox_schema_and_indices()

# --- UTIL --------------------------------------------------------------------
def safe_dt(s):
    if not s: return ""
    try:
        return datetime.fromisoformat(str(s)[:10]).date().isoformat()
    except Exception:
        try:
            from dateutil.parser import parse
            return parse(str(s)).date().isoformat()
        except Exception:
            return ""

def compute_year(report_iso, expiry_iso):
    if report_iso: return int(report_iso[:4])
    if expiry_iso: return int(expiry_iso[:4])
    return None

# --- DEBUG -------------------------------------------------------------------
@corebox_bp.get("/api/core-boxes/_debug")
def core_debug():
    path = resolve_db_path()
    exists = os.path.exists(path)
    cnt = 0
    try:
        with core_conn() as conn:
            r = conn.execute("SELECT COUNT(*) AS n FROM core_boxes").fetchone()
            cnt = r["n"]
    except Exception as e:
        return {"db_path": path, "exists": exists, "error": str(e)}, 500
    return {"db_path": path, "exists": exists, "row_count": cnt}

# --- QUERY LIST --------------------------------------------------------------
@corebox_bp.get("/api/core-boxes")
def api_core_boxes():
    q          = request.args.get("q", "").strip()
    island     = request.args.get("island", "").strip()
    year       = request.args.get("year", "").strip()
    complete   = request.args.get("complete", "").strip()
    keep_or_dump = request.args.get("keep_or_dump", "").strip()
    expired    = request.args.get("expired", "") == "1"

    sort_by = request.args.get("sort_by", "report_submission_date")
    sort_dir = request.args.get("sort_dir", "DESC").upper()
    page = max(1, int(request.args.get("page", 1)))
    page_size = max(1, min(200, int(request.args.get("page_size", 25))))
    offset = (page - 1) * page_size

    SORTABLE = {
        "year","island","work_order","project","engineer",
        "report_submission_date","storage_expiry_date"
    }
    if sort_by not in SORTABLE: sort_by = "report_submission_date"
    if sort_dir not in ("ASC","DESC"): sort_dir = "DESC"

    where, params = [], []
    if q:
        where.append("(work_order LIKE ? OR project LIKE ? OR engineer LIKE ?)")
        like = f"%{q}%"; params += [like, like, like]
    if island:
        where.append("island = ?"); params.append(island)
    if year:
        where.append("year = ?"); params.append(int(year))
    if complete:
        where.append("complete = ?"); params.append(complete)
    if keep_or_dump:
        where.append("keep_or_dump = ?"); params.append(keep_or_dump)
    if expired:
        where.append("date(storage_expiry_date) < date('now')")

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    sql_data = f"""
      SELECT id, year, island, work_order, project, engineer,
             report_submission_date, storage_expiry_date, complete, keep_or_dump
      FROM core_boxes
      {where_sql}
      ORDER BY {sort_by} {sort_dir}
      LIMIT ? OFFSET ?
    """
    sql_count = f"SELECT COUNT(*) AS n FROM core_boxes {where_sql}"

    with core_conn() as conn:
        total = conn.execute(sql_count, params).fetchone()["n"]
        rows = conn.execute(sql_data, params + [page_size, offset]).fetchall()
        out = [dict(r) for r in rows]
    return {"rows": out, "total": total}

@corebox_bp.get("/api/core-boxes/years")
def api_core_years():
    with core_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT year FROM core_boxes WHERE year IS NOT NULL ORDER BY year DESC"
        ).fetchall()
    return {"years": [r["year"] for r in rows]}

@corebox_bp.get("/api/core-boxes/islands")
def api_core_islands():
    with core_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT island FROM core_boxes WHERE island IS NOT NULL ORDER BY island"
        ).fetchall()
    return {"islands": [r["island"] for r in rows]}

# --- MUTATIONS (same as your last version, untouched logic) ------------------
@corebox_bp.post("/api/core-boxes")
def create_core_box():
    data = request.get_json() or {}
    user = (request.headers.get("X-User") or data.get("user") or "web").strip()

    wo = (data.get("work_order") or "").strip()
    if not wo:
        return {"error": "work_order is required"}, 400

    report = safe_dt(data.get("report_submission_date"))
    expiry = safe_dt(data.get("storage_expiry_date"))
    if not expiry and report:
        from dateutil.relativedelta import relativedelta
        expiry = (datetime.fromisoformat(report) + relativedelta(months=3)).date().isoformat()

    island = (data.get("island") or "").strip()
    year = data.get("year")
    try:
        year = int(year) if year not in ("", None) else compute_year(report, expiry)
    except Exception:
        year = compute_year(report, expiry)

    row = {
        "year": year,
        "island": island or None,
        "work_order": wo,
        "project": (data.get("project") or "").strip() or None,
        "engineer": (data.get("engineer") or "").strip() or None,
        "report_submission_date": report or None,
        "storage_expiry_date": expiry or None,
        "complete": (data.get("complete") or "").strip() or None,
        "keep_or_dump": (data.get("keep_or_dump") or "").strip() or None
    }

    with core_conn() as conn:
        exists = conn.execute("SELECT id FROM core_boxes WHERE work_order = ?", (wo,)).fetchone()
        if exists:
            return {"error": f"Work Order '{wo}' already exists (id {exists['id']})."}, 409

        cur = conn.execute("""
            INSERT INTO core_boxes
            (year,island,work_order,project,engineer,report_submission_date,storage_expiry_date,complete,keep_or_dump)
            VALUES (:year,:island,:work_order,:project,:engineer,:report_submission_date,:storage_expiry_date,:complete,:keep_or_dump)
        """, row)
        new_id = cur.lastrowid
        conn.execute("""
            INSERT INTO core_boxes_changes (action, core_box_id, work_order, user, ts, old_snapshot, new_snapshot)
            VALUES ('create', ?, ?, ?, ?, NULL, ?)
        """, (new_id, wo, user, datetime.utcnow().isoformat(), json.dumps(row)))
    return {"id": new_id}

@corebox_bp.put("/api/core-boxes/<int:row_id>")
def update_core_box(row_id):
    data = request.get_json() or {}
    user = (request.headers.get("X-User") or data.get("user") or "web").strip()
    with core_conn() as conn:
        old = conn.execute("SELECT * FROM core_boxes WHERE id = ?", (row_id,)).fetchone()
        if not old: return {"error": "Not found"}, 404

        def pick(k): return data.get(k, old[k])

        wo = (pick("work_order") or "").strip()
        if not wo: return {"error": "work_order cannot be empty"}, 400

        report = safe_dt(pick("report_submission_date"))
        expiry = safe_dt(pick("storage_expiry_date"))
        if not expiry and report:
            from dateutil.relativedelta import relativedelta
            expiry = (datetime.fromisoformat(report) + relativedelta(months=3)).date().isoformat()

        island = (pick("island") or "").strip()
        year_val = pick("year")
        try:
            year_val = int(year_val) if year_val not in ("", None) else compute_year(report, expiry)
        except Exception:
            year_val = compute_year(report, expiry)

        new_row = {
            "year": year_val,
            "island": island or None,
            "work_order": wo,
            "project": (pick("project") or "").strip() or None,
            "engineer": (pick("engineer") or "").strip() or None,
            "report_submission_date": report or None,
            "storage_expiry_date": expiry or None,
            "complete": (pick("complete") or "").strip() or None,
            "keep_or_dump": (pick("keep_or_dump") or "").strip() or None
        }

        dup = conn.execute("SELECT id FROM core_boxes WHERE work_order = ? AND id != ?", (wo, row_id)).fetchone()
        if dup:
            return {"error": f"Another record with WO '{wo}' exists (id {dup['id']})."}, 409

        conn.execute("""
            UPDATE core_boxes SET
              year=:year, island=:island, work_order=:work_order, project=:project, engineer=:engineer,
              report_submission_date=:report_submission_date, storage_expiry_date=:storage_expiry_date,
              complete=:complete, keep_or_dump=:keep_or_dump
            WHERE id=:id
        """, {**new_row, "id": row_id})

        conn.execute("""
            INSERT INTO core_boxes_changes (action, core_box_id, work_order, user, ts, old_snapshot, new_snapshot)
            VALUES ('update', ?, ?, ?, ?, ?, ?)
        """, (row_id, wo, user, datetime.utcnow().isoformat(), json.dumps(dict(old)), json.dumps(new_row)))
    return {"status": "ok"}

@corebox_bp.delete("/api/core-boxes/<int:row_id>")
def delete_core_box(row_id):
    user = (request.headers.get("X-User") or request.args.get("user") or "web").strip()
    with core_conn() as conn:
        row = conn.execute("SELECT * FROM core_boxes WHERE id = ?", (row_id,)).fetchone()
        if not row: return {"error": "Not found"}, 404
        if (row["keep_or_dump"] or "").lower() != "dump":
            return {"error": "Only items with disposition 'Dump' can be removed."}, 400

        conn.execute("""
            INSERT INTO core_boxes_changes (action, core_box_id, work_order, user, ts, old_snapshot, new_snapshot)
            VALUES ('delete', ?, ?, ?, ?, ?, NULL)
        """, (row_id, row["work_order"], user, datetime.utcnow().isoformat(), json.dumps(dict(row))))
        change_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.execute("DELETE FROM core_boxes WHERE id = ?", (row_id,))
    return {"status": "deleted", "change_id": change_id}

@corebox_bp.post("/api/core-boxes/restore")
def restore_core_box():
    data = request.get_json() or {}
    change_id = data.get("change_id")
    if not change_id: return {"error": "change_id required"}, 400

    with core_conn() as conn:
        ch = conn.execute("SELECT * FROM core_boxes_changes WHERE id = ?", (change_id,)).fetchone()
        if not ch: return {"error": "Change not found"}, 404
        if ch["action"] != "delete": return {"error": "Only delete changes can be restored."}, 400

        snap = json.loads(ch["old_snapshot"] or "{}")
        if not snap.get("work_order"): return {"error": "Snapshot missing work_order"}, 400

        exists = conn.execute("SELECT id FROM core_boxes WHERE work_order = ?", (snap["work_order"],)).fetchone()
        if exists:
            return {"error": f"Cannot restore; WO '{snap['work_order']}' already exists (id {exists['id']})."}, 409

        ins = {k: snap.get(k) for k in [
            "year","island","work_order","project","engineer",
            "report_submission_date","storage_expiry_date","complete","keep_or_dump"
        ]}
        cur = conn.execute("""
            INSERT INTO core_boxes
            (year,island,work_order,project,engineer,report_submission_date,storage_expiry_date,complete,keep_or_dump)
            VALUES (:year,:island,:work_order,:project,:engineer,:report_submission_date,:storage_expiry_date,:complete,:keep_or_dump)
        """, ins)
        new_id = cur.lastrowid

        conn.execute("""
            INSERT INTO core_boxes_changes (action, core_box_id, work_order, user, ts, old_snapshot, new_snapshot)
            VALUES ('restore', ?, ?, ?, ?, NULL, ?)
        """, (new_id, snap["work_order"], "web", datetime.utcnow().isoformat(), json.dumps(ins)))
    return {"status": "restored", "id": new_id}

@corebox_bp.get("/api/core-boxes/changes")
def get_core_changes():
    limit = max(1, min(500, int(request.args.get("limit", 100))))
    with core_conn() as conn:
        rows = conn.execute("""
            SELECT id, action, core_box_id, work_order, user, ts
            FROM core_boxes_changes
            ORDER BY id DESC
            LIMIT ?
        """, (limit,)).fetchall()
    return {"changes": [dict(r) for r in rows]}
