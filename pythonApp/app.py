# app.py
from flask import Flask, jsonify
from flask_cors import CORS
import os, sqlite3
import boto3

# --- blueprints ---
from reports import reports_bp               # has its own url_prefix="/api/reports"
from reports_binder import reports_binder_bp # keep if you need it
from core_box_inventory import corebox_bp
from askai import askai_bp                  # <-- file is ask_ai.py, import askai_bp

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_FILE  = os.path.join(BASE_DIR, "uploads", "chat_history.db")
USER_DB  = os.path.join(BASE_DIR, "uploads", "users.db")
PR_DB    = os.path.join(BASE_DIR, "uploads", "pr_data.db")
TABLE_NAME = "pr_data"

def init_db():
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT,
                question TEXT,
                answer TEXT,
                sources TEXT,
                timestamp TEXT,
                db_name TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS upload_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT,
                file TEXT,
                db_name TEXT,
                timestamp TEXT
            )
        """)

def init_users_db():
    os.makedirs(os.path.dirname(USER_DB), exist_ok=True)
    with sqlite3.connect(USER_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                role  TEXT
            )
        """)

def create_app():
    app = Flask(__name__)
    CORS(app, supports_credentials=True)

    @app.route("/api/health")
    def health():
        return jsonify({"ok": True})

    # ---------- register blueprints ----------
    app.register_blueprint(reports_bp)                 # url_prefix comes from reports.py
    app.register_blueprint(reports_binder_bp)          # if it defines its own prefix, fine
    app.register_blueprint(corebox_bp)                 # if it defines its own prefix, fine
    app.register_blueprint(askai_bp, url_prefix="/api")# <-- important: mount under /api

    # ---------- keep your non-AskAI routes here ----------
    # Example: OCR, S3, PR lookup, users endpoints
    import traceback
    from flask import request

    @app.route('/api/ocr-upload', methods=['POST'])
    def ocr_work_orders():
        try:
            from ocr import extract_work_orders_from_image
            if 'image' not in request.files:
                return jsonify({"error": "No image uploaded."}), 400
            image_file = request.files['image']
            extracted_text = extract_work_orders_from_image(image_file)
            return jsonify({"recognized_work_orders": extracted_text})
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": f"OCR failed: {str(e)}"}), 500

    @app.route('/api/s3-files')
    def list_s3_files():
        try:
            s3 = boto3.client('s3')
            BUCKET_NAME = 'geolabs-reports'
            response = s3.list_objects_v2(Bucket=BUCKET_NAME)
            files = []
            for obj in response.get('Contents', []):
                key = obj['Key']
                url = s3.generate_presigned_url(
                    'get_object', Params={'Bucket': BUCKET_NAME, 'Key': key}, ExpiresIn=3600
                )
                files.append({'Key': key, 'url': url})
            return jsonify({'files': files})
        except Exception as e:
            print('❌ S3 List Error:', e)
            return jsonify({'error': str(e)}), 500

    @app.route("/api/lookup-work-orders", methods=["POST"])
    def lookup_work_orders():
        try:
            data = request.get_json() or {}
            work_orders = data.get("work_orders", [])
            conn = sqlite3.connect(PR_DB); cursor = conn.cursor()
            result = []
            for wo in work_orders:
                original_wo = (wo or "").strip()
                formatted_wo = None
                if len(original_wo) >= 3 and original_wo[-1].isalpha():
                    base, letter = original_wo[:-1], original_wo[-1]
                    formatted_wo = f"{base}({letter})"

                def fetch(prefix):
                    cursor.execute(f"""
                        SELECT WO, Client, Project, PR, Date
                        FROM {TABLE_NAME}
                        WHERE WO LIKE ? COLLATE NOCASE
                        ORDER BY WO ASC
                        LIMIT 1
                    """, (f"{prefix}%",))
                    return cursor.fetchone()

                row = None
                if formatted_wo:
                    row = fetch(formatted_wo)
                if not row:
                    if '-' not in original_wo and len(original_wo) == 4:
                        row = fetch(original_wo)
                    if not row:
                        row = fetch(original_wo)

                if row:
                    result.append({
                        "work_order": original_wo,
                        "project_wo": row[0], "client": row[1], "project": row[2],
                        "pr": row[3], "date": row[4]
                    })
                else:
                    result.append({
                        "work_order": original_wo,
                        "project_wo": "Not Found", "client": "Not Found",
                        "project": "Not Found", "pr": "Not Found", "date": "Not Found"
                    })
            conn.close()
            return jsonify({"matches": result})
        except Exception as e:
            print("❌ Error in lookup_work_orders:", str(e))
            return jsonify({"error": str(e)}), 500

    @app.route("/api/register-user", methods=["POST"])
    def register_user():
        data = request.get_json() or {}
        email = data.get("email")
        if not email:
            return jsonify({"error": "Missing email"}), 400
        with sqlite3.connect(USER_DB) as conn:
            c = conn.cursor()
            c.execute("SELECT 1 FROM users WHERE email = ?", (email,))
            if c.fetchone() is None:
                c.execute("INSERT INTO users (email, role) VALUES (?, ?)", (email, "User"))
                conn.commit()
        return jsonify({"status": "ok"})

    @app.route("/api/users", methods=["GET"])
    def get_users():
        with sqlite3.connect(USER_DB) as conn:
            rows = conn.execute("SELECT email, role FROM users").fetchall()
        return jsonify([{"email": r[0], "role": r[1]} for r in rows])

    @app.route("/api/update-role", methods=["POST"])
    def update_role():
        data = request.get_json() or {}
        email, role = data.get("email"), data.get("role")
        if not email or not role:
            return jsonify({"error": "Missing email or role"}), 400
        with sqlite3.connect(USER_DB) as conn:
            conn.execute("UPDATE users SET role = ? WHERE email = ?", (role, email))
            conn.commit()
        return jsonify({"status": "updated"})

    @app.route("/api/delete-user", methods=["POST"])
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

    return app


print("🔧 Starting app...")
init_db()
init_users_db()
app = create_app()
print("✅ Ready to run Flask")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
