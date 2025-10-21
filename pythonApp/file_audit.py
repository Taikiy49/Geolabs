# backend/blueprints/file_audit.py
from __future__ import annotations

import csv
import io
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Dict, Any

from flask import Blueprint, current_app, jsonify, request, send_file

bp_file_audit = Blueprint("file_audit", __name__, url_prefix="/api/file-audit")

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

def _project_root() -> str:
    """
    Resolve the project root by walking up from this file:
    .../backend/blueprints/file_audit.py -> .../backend -> (project root)
    """
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))

def get_db_path() -> str:
    """
    Priority:
      1) FILE_AUDIT_DB env var (absolute or relative)
      2) <project_root>/uploads/file_audit.db
      3) ./file_audit.db (fallback)
    Ensures uploads/ exists when using (2).
    """
    env_path = os.environ.get("FILE_AUDIT_DB")
    if env_path:
        return os.path.abspath(env_path)

    root = _project_root()
    uploads_dir = os.path.join(root, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    return os.path.join(uploads_dir, "file_audit.db")

def connect() -> sqlite3.Connection:
    # check_same_thread=False so threaded servers don't trip on sqlite
    con = sqlite3.connect(get_db_path(), check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def ensure_schema():
    """
    Ensure the physical table exists (with original column names),
    add API columns if missing, and (re)create the view `file_audit_api`.
    Safe to call many times.
    """
    con = connect()
    try:
        cur = con.cursor()
        # Base table (preserve original header casing for these three)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS file_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                "FILE FOLDER" TEXT,
                "LOCATION"    TEXT,
                "ENGR"        TEXT,
                status        TEXT DEFAULT 'NEW',
                last_updated  TEXT,
                notes         TEXT
            );
            """
        )

        # Add columns if an older DB is missing them
        existing = {r["name"] for r in cur.execute("PRAGMA table_info(file_audit)").fetchall()}
        if "status" not in existing:
            cur.execute('ALTER TABLE file_audit ADD COLUMN status TEXT DEFAULT "NEW"')
        if "last_updated" not in existing:
            cur.execute("ALTER TABLE file_audit ADD COLUMN last_updated TEXT")
        if "notes" not in existing:
            cur.execute("ALTER TABLE file_audit ADD COLUMN notes TEXT")

        # Normalize nulls/defaults
        cur.execute('UPDATE file_audit SET status = COALESCE(status, "NEW")')
        cur.execute("UPDATE file_audit SET last_updated = COALESCE(last_updated, ?)", (now_iso(),))

        # Create/refresh API view (normalized column names for API)
        cur.execute("DROP VIEW IF EXISTS file_audit_api")
        cur.execute(
            """
            CREATE VIEW file_audit_api AS
            SELECT
              id,
              "FILE FOLDER" AS file_folder,
              "LOCATION"    AS location,
              "ENGR"        AS engr,
              COALESCE(status, 'NEW') AS status,
              last_updated,
              notes
            FROM file_audit;
            """
        )

        con.commit()
    finally:
        con.close()

@bp_file_audit.before_app_request
def _ensure_once():
    # Initialize/upgrade once per process lifetime
    if not getattr(current_app, "_fa_schema_ready", False):
        ensure_schema()
        current_app._fa_schema_ready = True

# ------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------

@bp_file_audit.route("/", methods=["GET"], strict_slashes=False)
def list_items():
    """
    GET /api/file-audit?q=...&status=...&page=1&page_size=50
    """
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(500, max(1, int(request.args.get("page_size", 50))))
    offset = (page - 1) * page_size

    terms = []
    params: Dict[str, Any] = {}
    if q:
        terms.append(
            """(
                file_folder LIKE :q
                OR location LIKE :q
                OR engr LIKE :q
                OR notes LIKE :q
            )"""
        )
        params["q"] = f"%{q}%"
    if status:
        terms.append("status = :status")
        params["status"] = status

    where = ("WHERE " + " AND ".join(terms)) if terms else ""
    sql_items = f"""
        SELECT id, file_folder, location, engr, status, last_updated, notes
        FROM file_audit_api
        {where}
        ORDER BY COALESCE(last_updated,'') DESC, id DESC
        LIMIT :limit OFFSET :offset
    """
    sql_count = f"SELECT COUNT(*) AS n FROM file_audit_api {where}"

    con = connect()
    try:
        params_items = dict(params); params_items.update({"limit": page_size, "offset": offset})
        items = [dict(r) for r in con.execute(sql_items, params_items)]
        total = con.execute(sql_count, params).fetchone()["n"]
        return jsonify({"items": items, "total": total})
    finally:
        con.close()

@bp_file_audit.route("/", methods=["POST"], strict_slashes=False)
def create_item():
    data = request.get_json(force=True) or {}
    file_folder = (data.get("file_folder") or "").strip()
    if not file_folder:
        return jsonify({"error": "file_folder is required"}), 400
    location = (data.get("location") or "").strip()
    engr = (data.get("engr") or "").strip()
    status = (data.get("status") or "NEW").strip().upper()
    notes = (data.get("notes") or "").strip()
    ts = now_iso()

    con = connect()
    try:
        cur = con.cursor()
        cur.execute(
            """
            INSERT INTO file_audit ("FILE FOLDER","LOCATION","ENGR",status,last_updated,notes)
            VALUES (?,?,?,?,?,?)
            """,
            (file_folder, location, engr, status, ts, notes),
        )
        new_id = cur.lastrowid
        con.commit()
        row = con.execute("SELECT * FROM file_audit_api WHERE id = ?", (new_id,)).fetchone()
        return jsonify(dict(row)), 201
    finally:
        con.close()

@bp_file_audit.put("/<int:item_id>")
def update_item(item_id: int):
    data = request.get_json(force=True) or {}
    fields = {}
    for k in ("file_folder", "location", "engr", "status", "notes"):
        if k in data:
            fields[k] = (data[k] or "").strip()
    if not fields:
        return jsonify({"error": "No updatable fields provided"}), 400

    set_sql = []
    params: Dict[str, Any] = {"id": item_id}
    mapping = {
        "file_folder": '"FILE FOLDER"',
        "location": '"LOCATION"',
        "engr": '"ENGR"',
        "status": "status",
        "notes": "notes",
    }
    for k, v in fields.items():
        col = mapping[k]
        set_sql.append(f"{col} = :{k}")
        params[k] = v.upper() if k == "status" and v else v

    set_sql.append("last_updated = :last_updated")
    params["last_updated"] = now_iso()

    sql = f"UPDATE file_audit SET {', '.join(set_sql)} WHERE id = :id"
    con = connect()
    try:
        cur = con.cursor()
        cur.execute(sql, params)
        if cur.rowcount == 0:
            return jsonify({"error": "Not found"}), 404
        con.commit()
        row = con.execute("SELECT * FROM file_audit_api WHERE id = ?", (item_id,)).fetchone()
        return jsonify(dict(row))
    finally:
        con.close()

@bp_file_audit.delete("/<int:item_id>")
def delete_item(item_id: int):
    con = connect()
    try:
        cur = con.cursor()
        cur.execute("DELETE FROM file_audit WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            return jsonify({"error": "Not found"}), 404
        con.commit()
        return jsonify({"ok": True})
    finally:
        con.close()

@bp_file_audit.get("/export")
def export_csv():
    """CSV export of the current table (API projection)."""
    con = connect()
    try:
        rows = [
            dict(r)
            for r in con.execute(
                """
                SELECT id, file_folder, location, engr, status, last_updated, notes
                FROM file_audit_api
                ORDER BY id ASC
                """
            )
        ]
    finally:
        con.close()

    buf = io.StringIO()
    fieldnames = (
        list(rows[0].keys())
        if rows
        else ["id", "file_folder", "location", "engr", "status", "last_updated", "notes"]
    )
    w = csv.DictWriter(buf, fieldnames=fieldnames)
    w.writeheader()
    for r in rows:
        w.writerow(r)
    buf.seek(0)

    return send_file(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"file_audit_export_{int(time.time())}.csv",
    )

@bp_file_audit.post("/import")
def import_csv():
    """
    multipart/form-data with 'file' (CSV).
    Accepted columns (case-insensitive): file_folder, location, engr, status, notes
    last_updated is set to now; id is ignored.
    """
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "file is required"}), 400

    text = f.stream.read().decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    inserted = 0

    con = connect()
    try:
        cur = con.cursor()
        for row in reader:
            file_folder = (row.get("file_folder") or row.get("FILE FOLDER") or "").strip()
            if not file_folder:
                continue
            location = (row.get("location") or row.get("LOCATION") or "").strip()
            engr = (row.get("engr") or row.get("ENGR") or "").strip()
            status = (row.get("status") or "NEW").strip().upper()
            notes = (row.get("notes") or "").strip()
            cur.execute(
                """
                INSERT INTO file_audit ("FILE FOLDER","LOCATION","ENGR",status,last_updated,notes)
                VALUES (?,?,?,?,?,?)
                """,
                (file_folder, location, engr, status, now_iso(), notes),
            )
            inserted += 1
        con.commit()
        return jsonify({"inserted": inserted})
    finally:
        con.close()

# ------------------------------------------------------------------------------
# Optional: quick debug endpoint (remove in prod)
# ------------------------------------------------------------------------------

@bp_file_audit.get("/_debug")
def _debug():
    p = get_db_path()
    con = connect()
    try:
        cur = con.cursor()
        n_physical = cur.execute("SELECT COUNT(*) FROM file_audit").fetchone()[0]
        n_view = cur.execute("SELECT COUNT(*) FROM file_audit_api").fetchone()[0]
        return jsonify({"db_path": p, "file_audit_rows": n_physical, "view_rows": n_view})
    finally:
        con.close()
