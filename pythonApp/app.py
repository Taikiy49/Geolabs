# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import sqlite3
from ocr import extract_work_orders_from_image
import os
import traceback
from helpers import rank_documents, ask_gemini_single_file, get_quick_view_sentences
from admin import admin_bp
from core_box_inventory import corebox_bp
import boto3
from reports_binder import reports_binder_bp

app = Flask(__name__)
app.register_blueprint(reports_binder_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(corebox_bp)
CORS(app)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_FILE = os.path.join(BASE_DIR, "uploads", "chat_history.db")
GEO_DB = os.path.join(BASE_DIR, "uploads", "reports.db")

def init_db():
    if not os.path.exists(DB_FILE):
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





@app.route('/api/rank_only', methods=['POST'])
def rank_only():
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        min_wo = int(data.get('min', 0))
        max_wo = int(data.get('max', 99999))
        user = data.get('user', 'guest')

        if not query:
            return jsonify({"error": "Empty keyword."}), 400

        ranked = rank_documents(query, GEO_DB, min_wo, max_wo, top_k=30)

        # ✅ Check if an identical ranking query was already cached
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 1 FROM chat_history
                WHERE user = ? AND LOWER(question) = LOWER(?) AND answer = '[Ranking Only - No answer]'
                ORDER BY id DESC LIMIT 1
            """, (user, query))
            already_cached = cursor.fetchone()

            if not already_cached:
                conn.execute("""
                    INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    user,
                    query,
                    "[Ranking Only - No answer]",
                    ",".join(doc["file"] for doc in ranked),
                    datetime.now().isoformat(),
                    "reports.db"  # or pass the actual db name if variable
                ))

        return jsonify({
            "ranked_files": [
                {"file": doc["file"], "score": round(doc["score"], 1)}
                for doc in ranked
            ]
        })

    except Exception as e:
        print("❌ /api/rank_only error:", str(e))
        traceback.print_exc()
        return jsonify({"error": "Failed to rank documents."}), 500

@app.route('/api/single_file_answer', methods=['POST'])
def answer_from_single_file():
    try:
        data = request.get_json()
        print("🔍 Incoming /api/single_file_answer payload:", data)

        query = data.get("query")
        
        file = data.get("file")
        user = data.get("user", "guest")

        if not query or not file:
            print("❌ Missing query or file:", query, file)
            return jsonify({"error": "Missing query or file."}), 400

        snippets = get_quick_view_sentences(file, query, GEO_DB)
        answer = ask_gemini_single_file(query, file, snippets)

        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                INSERT INTO chat_history (user, question, answer, sources, timestamp)
                VALUES (?, ?, ?, ?, ?)
            """, (user, query, answer, file, datetime.now().isoformat()))


        return jsonify({"answer": answer})  # ✅ Make sure this return always happens

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to answer from selected file. {str(e)}"}), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to answer from selected file. {str(e)}"}), 500

@app.route('/api/db_chat_history', methods=['GET'])
def get_db_chat_history():
    user = request.args.get("user", "guest")

    try:
        with sqlite3.connect(DB_FILE) as conn:  # Always use global DB_FILE
            cursor = conn.cursor()
            cursor.execute("""
                SELECT question, answer, sources, timestamp
                FROM chat_history
                WHERE user = ?
                ORDER BY id DESC
            """, (user,))
            rows = cursor.fetchall()

        history = []
        for row in rows:
            history.append({"role": "user", "text": row[0]})
            history.append({"role": "assistant", "text": row[1]})

        return jsonify(history)
    except Exception as e:
        print("❌ Error reading chat history from global DB:", e)
        return jsonify([])

HANDBOOK_DB = "employee_handbook.db"

@app.route('/api/question', methods=['POST'])
def handle_question():
    try:
        data = request.get_json()  # ✅ Moved here first
        query = data.get('query', '').strip()
        db_name = data.get('db', '').strip()
        user = data.get('user', 'guest')
        use_cache = data.get('use_cache', True)
        use_web = data.get('use_web', False)  # ✅ Now safe to access
        min_wo = int(data.get('min', 0))
        max_wo = int(data.get('max', 99999))
        print(f"🌐 Web access: {use_web} | Cache: {use_cache} | DB: {db_name}")

        if not query or not db_name:
            return jsonify({"error": "Missing query or database name."}), 400

        if db_name in [DB_FILE, 'reports.db']:
            return jsonify({"error": "Restricted database."}), 403

        db_path = os.path.join("uploads", db_name)
        if not os.path.exists(db_path):
            return jsonify({"error": f"Database {db_name} not found."}), 404

        ranked_chunks = (
            rank_documents(query, db_path, top_k=30)
            if "handbook" in db_path else
            rank_documents(query, db_path, min_wo, max_wo, top_k=30)
        )

        if not ranked_chunks:
            return jsonify({'answer': 'No relevant documents found.'})

        file = ranked_chunks[0]['file']
        snippets = get_quick_view_sentences(file, query, db_path)

        if use_cache:
            with sqlite3.connect(DB_FILE) as conn:
                cursor = conn.cursor()
                cursor.execute("""SELECT answer FROM chat_history
                                  WHERE user = ? AND sources = ? AND LOWER(question) = LOWER(?)
                                  ORDER BY id DESC LIMIT 1""", (user, file, query))
                cached = cursor.fetchone()
                if cached:
                    print("⚡ Returning cached answer")
                    return jsonify({"answer": cached[0]})

        answer = ask_gemini_single_file(query, file, snippets, user=user, use_cache=False, use_web=use_web)

        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                INSERT INTO chat_history (user, question, answer, sources, timestamp, db_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user, query, answer, file, datetime.now().isoformat(), db_name))

        return jsonify({'answer': answer})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Failed to answer question: {str(e)}"}), 500

@app.route('/api/files', methods=['GET'])
def list_files():
    try:
        with sqlite3.connect(GEO_DB) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT file FROM chunks")
            files = sorted(set(row[0] for row in cursor.fetchall()))
        return jsonify(files)
    except Exception as e:
        print("\u274C Error in /api/files:", str(e))
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/chat_history', methods=['GET'])
def get_chat_history():
    user = request.args.get('user', 'guest')
    db = request.args.get('db', '')

    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT question, answer FROM chat_history
                WHERE user = ? AND db_name = ?
                ORDER BY timestamp DESC
                LIMIT 30
            """, (user, db))
            rows = cursor.fetchall()
            history = [{"question": row[0], "answer": row[1]} for row in rows]
            return jsonify(history)
    except Exception as e:
        print("Error loading chat history:", e)
        return jsonify([])

@app.route("/api/delete-user", methods=["POST"])
def delete_user():
    data = request.get_json()
    email = data.get("email")

    if not email:
        return jsonify({"error": "Missing email"}), 400

    # Protect super owner from deletion
    if email == "tyamashita@geolabs.net":
        return jsonify({"error": "Cannot delete the Super Owner"}), 403


    with sqlite3.connect(USER_DB) as conn:
        conn.execute("DELETE FROM users WHERE email = ?", (email,))
        conn.commit()

    return jsonify({"status": "deleted"})


@app.route('/api/delete-history', methods=['DELETE'])
def delete_history():
    data = request.get_json()
    user = data.get('user')
    db_name = data.get('db')
    question = data.get('question')

    if not all([user, db_name, question]):
        return jsonify({'error': 'Missing parameters'}), 400

    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM chat_history WHERE user=? AND db_name=? AND question=?", (user, db_name, question))
        conn.commit()

    return jsonify({'status': 'success'}), 200


@app.route('/api/quick_view', methods=['POST'])
def quick_view():
    data = request.get_json()
    filename = data.get('filename')
    query = data.get('query', '')
    if not filename:
        return jsonify({"error": "Filename required."}), 400
    try:
        snippets = get_quick_view_sentences(filename, query, GEO_DB)
        return jsonify({"snippets": snippets})
    except Exception as e:
        print("\u274C Quick view error:", str(e))
        return jsonify({"error": "Unable to generate quick view."}), 500
    
from ocr import extract_work_orders_from_image

@app.route('/api/ocr-upload', methods=['POST'])
def ocr_work_orders():
    try:
        if 'image' not in request.files:
            return jsonify({"error": "No image uploaded."}), 400

        image_file = request.files['image']
        extracted_text = extract_work_orders_from_image(image_file)
        return jsonify({
            "recognized_work_orders": extracted_text
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Gemini image processing failed: {str(e)}"}), 500


@app.route('/api/s3-files')
def list_s3_files():
    try:
        s3 = boto3.client('s3')
        BUCKET_NAME = 'geolabs-reports'
        response = s3.list_objects_v2(Bucket=BUCKET_NAME)

        files = []
        for obj in response.get('Contents', []):
            key = obj['Key']
            # ✅ generate temporary signed URL for downloading
            url = s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': BUCKET_NAME, 'Key': key},
                ExpiresIn=3600  # valid for 1 hour
            )
            files.append({
                'Key': key,
                'url': url
            })

        return jsonify({'files': files})
    except Exception as e:
        print('❌ S3 List Error:', e)
        return jsonify({'error': str(e)}), 500


PR_DB = os.path.join(BASE_DIR, "uploads", "pr_data.db")
TABLE_NAME = "pr_data"

@app.route("/api/lookup-work-orders", methods=["POST"])
def lookup_work_orders():
    data = request.get_json()
    work_orders = data.get("work_orders", [])

    try:
        conn = sqlite3.connect(PR_DB)
        cursor = conn.cursor()
        result = []

        for wo in work_orders:
            original_wo = wo.strip()
            formatted_wo = None
            base_wo = original_wo

            # Normalize like 8482-00A -> 8482-00(A)
            if len(original_wo) >= 3 and original_wo[-1].isalpha():
                base = original_wo[:-1]
                letter = original_wo[-1]
                formatted_wo = f"{base}({letter})"
            elif '-' not in original_wo and len(original_wo) == 4:
                # For 4-digit WOs like '8210', try to find the lowest matching '8210-XX'
                cursor.execute(f"""
                    SELECT WO, Client, Project, PR, Date
                    FROM {TABLE_NAME}
                    WHERE WO LIKE ? COLLATE NOCASE
                    ORDER BY WO ASC
                """, (f"{original_wo}-%",))
                row = cursor.fetchone()
                if row:
                    result.append({
                        "work_order": original_wo,
                        "project_wo": row[0],
                        "client": row[1],
                        "project": row[2],
                        "pr": row[3],
                        "date": row[4]
                    })
                    continue  # Skip remaining steps

            if formatted_wo:
                print(f"🔍 Trying formatted WO: '{formatted_wo}'")
                cursor.execute(f"""
                    SELECT WO, Client, Project, PR, Date
                    FROM {TABLE_NAME}
                    WHERE WO LIKE ? COLLATE NOCASE
                    LIMIT 1
                """, (f"{formatted_wo}%",))
                row = cursor.fetchone()
            else:
                print(f"🔍 Trying original WO: '{original_wo}'")
                cursor.execute(f"""
                    SELECT WO, Client, Project, PR, Date
                    FROM {TABLE_NAME}
                    WHERE WO LIKE ? COLLATE NOCASE
                    LIMIT 1
                """, (f"{original_wo}%",))
                row = cursor.fetchone()

            if row:
                result.append({
                    "work_order": original_wo,
                    "project_wo": row[0],
                    "client": row[1],
                    "project": row[2],
                    "pr": row[3],
                    "date": row[4]
                })
            else:
                result.append({
                    "work_order": original_wo,
                    "project_wo": "Not Found",
                    "client": "Not Found",
                    "project": "Not Found",
                    "pr": "Not Found",
                    "date": "Not Found"
                })




        conn.close()
        return jsonify({"matches": result})

    except Exception as e:
        print("❌ Error in lookup_work_orders:", str(e))
        return jsonify({"error": str(e)}), 500
    

@app.route('/api/s3-db-pdfs')
def list_s3_db_pdfs():
    try:
        s3 = boto3.client('s3')
        BUCKET_NAME = 'geolabs-db-pdfs'
        response = s3.list_objects_v2(Bucket=BUCKET_NAME)

        files = []
        for obj in response.get('Contents', []):
            key = obj['Key']
            url = s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': BUCKET_NAME, 'Key': key},
                ExpiresIn=3600  # 1 hour
            )
            files.append({
                'Key': key,
                'url': url
            })

        return jsonify({'files': files})
    except Exception as e:
        print('❌ S3 DB PDF List Error:', e)
        return jsonify({'error': str(e)}), 500

USER_DB = os.path.join(BASE_DIR, "uploads", "users.db")

def init_users_db():
    os.makedirs(os.path.dirname(USER_DB), exist_ok=True)
    with sqlite3.connect(USER_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                role TEXT
            )
        """)


@app.route("/api/register-user", methods=["POST"])
def register_user():
    data = request.get_json()
    email = data.get("email")

    if not email:
        return jsonify({"error": "Missing email"}), 400

    with sqlite3.connect(USER_DB) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        if cursor.fetchone() is None:
            cursor.execute("INSERT INTO users (email, role) VALUES (?, ?)", (email, "User"))
            conn.commit()

    return jsonify({"status": "ok"})


@app.route("/api/users", methods=["GET"])
def get_users():
    with sqlite3.connect(USER_DB) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT email, role FROM users")
        rows = cursor.fetchall()
    users = [{"email": email, "role": role} for email, role in rows]
    return jsonify(users)


@app.route("/api/update-role", methods=["POST"])
def update_role():
    data = request.get_json()
    email = data.get("email")
    role = data.get("role")

    if not email or not role:
        return jsonify({"error": "Missing email or role"}), 400

    with sqlite3.connect(USER_DB) as conn:
        conn.execute("UPDATE users SET role = ? WHERE email = ?", (role, email))
        conn.commit()

    return jsonify({"status": "updated"})




print("🔧 Starting app...")
init_db()
init_users_db()
print("✅ Ready to run Flask")
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

