# app.py
from __future__ import annotations

import os
import sqlite3
import time
import traceback

import boto3
from flask import Flask, jsonify, request
from flask_cors import CORS

# --- blueprints you already have ---
from reports import reports_bp
from reports_binder import reports_binder_bp
from core_box_inventory import corebox_bp
from askai import askai_bp
from s3 import s3_bp
from server_search import server_search_bp

# NEW: file audit blueprint (make sure the module path is correct)
from file_audit import bp_file_audit  # exposes bp_file_audit = Blueprint(..., url_prefix="/api/file-audit")


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
DB_FILE = os.path.join(UPLOADS_DIR, "chat_history.db")
USER_DB = os.path.join(UPLOADS_DIR, "users.db")
PR_DB = os.path.join(UPLOADS_DIR, "pr_data.db")
SERVER_SEARCH_DB = os.path.join(UPLOADS_DIR, "server_search.db")
TABLE_NAME = "pr_data"


# -----------------------------------------------------------------------------
# DB init helpers
# -----------------------------------------------------------------------------
def init_db():
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT,
                question TEXT,
                answer TEXT,
                sources TEXT,
                timestamp TEXT,
                db_name TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS upload_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT,
                file TEXT,
                db_name TEXT,
                timestamp TEXT
            )
            """
        )


def init_users_db():
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    with sqlite3.connect(USER_DB) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                role  TEXT
            )
            """
        )


# -----------------------------------------------------------------------------
# Flask app factory
# -----------------------------------------------------------------------------
def create_app() -> Flask:
    app = Flask(__name__)
    # If you later want to control CORS origins, replace "*" with your frontend origin.
    CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": "*"}})

    # Health check
    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "t": time.time()})

    # -------------------------------------------------------------------------
    # Register blueprints
    # -------------------------------------------------------------------------
    # NOTE: Blueprints that define their own url_prefix don’t need one here.
    app.register_blueprint(s3_bp)                       # prefix defined in s3.py (if any)
    app.register_blueprint(reports_bp)                  # prefix defined in reports.py
    app.register_blueprint(reports_binder_bp)           # prefix defined in reports_binder.py
    app.register_blueprint(corebox_bp)                  # prefix defined in core_box_inventory.py
    app.register_blueprint(askai_bp, url_prefix="/api") # mount AskAI under /api
    app.register_blueprint(server_search_bp)            # prefix defined in server_search.py

    # IMPORTANT: Register File Audit blueprint (it already has url_prefix="/api/file-audit")
    app.register_blueprint(bp_file_audit)

    # -------------------------------------------------------------------------
    # Env for server search (as you had)
    # -------------------------------------------------------------------------
    os.environ["SERVER_SEARCH_DB"] = SERVER_SEARCH_DB
    os.environ.setdefault("SERVER_SEARCH_ROOT", r"\\geolabs.lan\fs")
    os.environ["FILE_AUDIT_DB"] = os.path.join(UPLOADS_DIR, "file_audit.db")


    # -------------------------------------------------------------------------
    # Inline routes you had in app.py
    # -------------------------------------------------------------------------
    @app.post("/api/ocr-upload")
    def ocr_work_orders():
        try:
            from ocr import extract_work_orders_from_image
            if "image" not in request.files:
                return jsonify({"error": "No image uploaded."}), 400
            image_file = request.files["image"]
            extracted_text = extract_work_orders_from_image(image_file)
            return jsonify({"recognized_work_orders": extracted_text})
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": f"OCR failed: {str(e)}"}), 500

    @app.get("/api/s3-files")
    def list_s3_files():
        try:
            s3 = boto3.client("s3")
            BUCKET_NAME = "geolabs-reports"
            response = s3.list_objects_v2(Bucket=BUCKET_NAME)
            files = []
            for obj in response.get("Contents", []):
                key = obj["Key"]
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": BUCKET_NAME, "Key": key},
                    ExpiresIn=3600,
                )
                files.append({"Key": key, "url": url})
            return jsonify({"files": files})
        except Exception as e:
            print("❌ S3 List Error:", e)
            return jsonify({"error": str(e)}), 500

    @app.post("/api/lookup-work-orders")
    def lookup_work_orders():
        try:
            data = request.get_json() or {}
            work_orders = data.get("work_orders", [])
            conn = sqlite3.connect(PR_DB)
            cursor = conn.cursor()
            result = []

            def fetch(prefix):
                cursor.execute(
                    f"""
                    SELECT WO, Client, Project, PR, Date
                    FROM {TABLE_NAME}
                    WHERE WO LIKE ? COLLATE NOCASE
                    ORDER BY WO ASC
                    LIMIT 1
                    """,
                    (f"{prefix}%",),
                )
                return cursor.fetchone()

            for wo in work_orders:
                original_wo = (wo or "").strip()
                formatted_wo = None
                if len(original_wo) >= 3 and original_wo[-1].isalpha():
                    base, letter = original_wo[:-1], original_wo[-1]
                    formatted_wo = f"{base}({letter})"

                row = fetch(formatted_wo) if formatted_wo else None
                if not row:
                    if "-" not in original_wo and len(original_wo) == 4:
                        row = fetch(original_wo)
                    if not row:
                        row = fetch(original_wo)

                if row:
                    result.append(
                        {
                            "work_order": original_wo,
                            "project_wo": row[0],
                            "client": row[1],
                            "project": row[2],
                            "pr": row[3],
                            "date": row[4],
                        }
                    )
                else:
                    result.append(
                        {
                            "work_order": original_wo,
                            "project_wo": "Not Found",
                            "client": "Not Found",
                            "project": "Not Found",
                            "pr": "Not Found",
                            "date": "Not Found",
                        }
                    )
            conn.close()
            return jsonify({"matches": result})
        except Exception as e:
            print("❌ Error in lookup_work_orders:", str(e))
            return jsonify({"error": str(e)}), 500

    @app.post("/api/register-user")
    def register_user():
        data = request.get_json() or {}
        email = data.get("email")
        if not email:
            return jsonify({"error": "Missing email"}), 400
        with sqlite3.connect(USER_DB) as conn:
            c = conn.cursor()
            c.execute("SELECT 1 FROM users WHERE email = ?", (email,))
            if c.fetchone() is None:
                c.execute(
                    "INSERT INTO users (email, role) VALUES (?, ?)", (email, "User")
                )
                conn.commit()
        return jsonify({"status": "ok"})

    @app.get("/api/users")
    def get_users():
        with sqlite3.connect(USER_DB) as conn:
            rows = conn.execute("SELECT email, role FROM users").fetchall()
        return jsonify([{"email": r[0], "role": r[1]} for r in rows])

    @app.post("/api/update-role")
    def update_role():
        data = request.get_json() or {}
        email, role = data.get("email"), data.get("role")
        if not email or not role:
            return jsonify({"error": "Missing email or role"}), 400
        with sqlite3.connect(USER_DB) as conn:
            conn.execute("UPDATE users SET role = ? WHERE email = ?", (role, email))
            conn.commit()
        return jsonify({"status": "updated"})

    @app.post("/api/delete-user")
    def delete_user():
        data = request.get_json() or {}
        email = data.get("email")
        if not email:
            return jsonify({"error": "Missing email"}), 400
        if email == "tyamashita@geolabs.net":
            return jsonify({"error": "Cannot delete the Super Owner"}), 403
        with sqlite3.connect(USER_DB) as conn:
            conn.execute("DELETE FROM users WHERE email = ?", (email,))
            conn.commit()
        return jsonify({"status": "deleted"})

    # Print URL map at startup to confirm routes
    print("=== URL MAP ===")
    with app.app_context():
        for r in app.url_map.iter_rules():
            print(f"{r.rule}  {sorted(list(r.methods))}")

    return app


# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
print("🔧 Starting app...")
init_db()
init_users_db()
app = create_app()
print("✅ Ready to run Flask")

if __name__ == "__main__":
    # Ensure the server listens on all interfaces in prod-like envs
    app.run(host="0.0.0.0", port=5000, debug=True)
