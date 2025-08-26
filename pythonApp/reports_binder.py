# reports_binder.py
import os
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

reports_binder_bp = Blueprint("reports_binder_bp", __name__, url_prefix="/api/reports-binder")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DB_PATH = os.path.join(UPLOADS_DIR, "reports_binder.db")

SORTABLE_COLS = {
    "id", "pdf_file", "date", "work_order",
    "engineer_initials", "billing", "date_sent", "page_label"
}

# ---------- DB helpers ----------
def get_conn():
    return sqlite3.connect(DB_PATH)

def init_reports_db():
    with get_conn() as conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdf_file TEXT,
            date TEXT,
            work_order TEXT,
            engineer_initials TEXT,
            billing TEXT,
            date_sent TEXT,
            page_label TEXT
        );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_billing ON reports(billing);")
        conn.commit()

def _bool_param(x):
    if isinstance(x, bool):
        return x
    if x is None:
        return False
    return str(x).strip().lower() in {"1", "true", "yes", "y"}

def _safe_sort(sort_by, sort_dir):
    col = (sort_by or "date").strip().lower()
    col = col if col in SORTABLE_COLS else "date"
    direction = "ASC" if str(sort_dir or "").upper() == "ASC" else "DESC"
    return col, direction

def _row_to_obj(row):
    return {
        "id": row[0],
        "pdf_file": row[1],
        "page_label": row[2],
        "date": row[3],
        "work_order": row[4],
        "engineer_initials": row[5],
        "billing": row[6],
        "date_sent": row[7],
    }

# ---------- Ensure DB once when blueprint is registered ----------
@reports_binder_bp.record_once
def _on_register(setup_state):
    # Runs exactly once when app.register_blueprint(...) is called
    init_reports_db()

# ---------- Routes ----------
@reports_binder_bp.route("", methods=["GET"])
def list_reports():
    q = (request.args.get("q") or "").strip()
    wo = (request.args.get("wo") or "").strip()
    eng = (request.args.get("eng") or "").strip()
    billing_only = _bool_param(request.args.get("billing_only"))
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()

    sort_by, sort_dir = _safe_sort(request.args.get("sort_by"), request.args.get("sort_dir"))
    try:
        page = max(1, int(request.args.get("page", 1)))
    except Exception:
        page = 1
    try:
        page_size = max(1, min(500, int(request.args.get("page_size", 25))))
    except Exception:
        page_size = 25

    where = []
    params = []

    if q:
        like = f"%{q}%"
        where.append("(pdf_file LIKE ? OR work_order LIKE ? OR engineer_initials LIKE ? OR billing LIKE ?)")
        params += [like, like, like, like]

    if wo:
        where.append("work_order LIKE ?")
        params.append(f"{wo}%")

    if eng:
        where.append("UPPER(engineer_initials) LIKE ?")
        params.append(f"{eng.upper()}%")

    if billing_only:
        where.append("(billing IS NOT NULL AND TRIM(billing) <> '')")

    if date_from:
        where.append("(date IS NOT NULL AND date >= ?)")
        params.append(date_from)

    if date_to:
        where.append("(date IS NOT NULL AND date <= ?)")
        params.append(date_to)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM reports {where_sql};", params)
        total = cur.fetchone()[0]

        offset = (page - 1) * page_size
        cur.execute(
            f"""
            SELECT id, pdf_file, page_label, date, work_order, engineer_initials, billing, date_sent
            FROM reports
            {where_sql}
            ORDER BY {sort_by} {sort_dir}, id DESC
            LIMIT ? OFFSET ?;
            """,
            params + [page_size, offset],
        )
        rows = [_row_to_obj(r) for r in cur.fetchall()]

    return jsonify({"rows": rows, "total": total})

@reports_binder_bp.route("", methods=["POST"])
def create_report():
    data = request.get_json(silent=True) or {}
    if not (data.get("work_order") or "").strip():
        return jsonify({"error": "work_order is required."}), 400

    pdf_file = (data.get("pdf_file") or "").strip()
    date = (data.get("date") or "").strip()
    work_order = (data.get("work_order") or "").strip().upper()
    engineer_initials = (data.get("engineer_initials") or "").strip().upper()
    billing = (data.get("billing") or "").strip()
    date_sent = (data.get("date_sent") or "").strip()
    page_label = (data.get("page_label") or "").strip()

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO reports (pdf_file, date, work_order, engineer_initials, billing, date_sent, page_label)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pdf_file, date, work_order, engineer_initials, billing, date_sent, page_label),
        )
        rid = cur.lastrowid
        conn.commit()

        cur.execute(
            """SELECT id, pdf_file, page_label, date, work_order, engineer_initials, billing, date_sent
               FROM reports WHERE id = ?""",
            (rid,),
        )
        row = cur.fetchone()

    return jsonify(_row_to_obj(row)), 201

@reports_binder_bp.route("/<int:rid>", methods=["PUT"])
def update_report(rid: int):
    data = request.get_json(silent=True) or {}

    fields, params = [], []

    def add(field, val, transform=lambda x: x):
        if val is not None:
            fields.append(f"{field} = ?")
            params.append(transform(val))

    add("pdf_file", data.get("pdf_file"), lambda v: (v or "").strip())
    add("date", data.get("date"), lambda v: (v or "").strip())
    add("work_order", data.get("work_order"), lambda v: (v or "").strip().upper())
    add("engineer_initials", data.get("engineer_initials"), lambda v: (v or "").strip().upper())
    add("billing", data.get("billing"), lambda v: (v or "").strip())
    add("date_sent", data.get("date_sent"), lambda v: (v or "").strip())
    add("page_label", data.get("page_label"), lambda v: (v or "").strip())

    if not fields:
        return jsonify({"error": "No fields to update."}), 400

    params.append(rid)

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE reports SET {', '.join(fields)} WHERE id = ?;", params)
        conn.commit()

        cur.execute(
            """SELECT id, pdf_file, page_label, date, work_order, engineer_initials, billing, date_sent
               FROM reports WHERE id = ?""",
            (rid,),
        )
        row = cur.fetchone()

    if not row:
        return jsonify({"error": "Record not found."}), 404
    return jsonify(_row_to_obj(row))

@reports_binder_bp.route("/<int:rid>", methods=["DELETE"])
def delete_report(rid: int):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM reports WHERE id = ?;", (rid,))
        deleted = cur.rowcount
        conn.commit()

    if deleted == 0:
        return jsonify({"error": "Record not found."}), 404
    return jsonify({"status": "deleted", "id": rid})

@reports_binder_bp.route("/bulk-delete", methods=["POST"])
def bulk_delete():
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "ids must be a non-empty array."}), 400
    try:
        ids = [int(x) for x in ids]
    except Exception:
        return jsonify({"error": "ids must be integers."}), 400

    qmarks = ",".join("?" for _ in ids)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM reports WHERE id IN ({qmarks});", ids)
        deleted = cur.rowcount
        conn.commit()

    return jsonify({"status": "deleted", "count": deleted, "ids": ids})

@reports_binder_bp.route("/_health", methods=["GET"])
def _health():
    return jsonify({"ok": True, "db_exists": os.path.exists(DB_PATH), "db_path": DB_PATH})
