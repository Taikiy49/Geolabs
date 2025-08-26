# admin.py
from flask import Blueprint, request, jsonify
import os
import re
import io
import sqlite3
import tempfile
import traceback
from collections import defaultdict

import boto3
import fitz  # PyMuPDF
import nltk
from nltk.tokenize.punkt import PunktSentenceTokenizer, PunktParameters
from PIL import Image
import pytesseract

import torch
from transformers import AutoTokenizer, AutoModel

# ---------------------- CONFIG ----------------------
s3 = boto3.client("s3")
S3_BUCKET = os.environ.get("S3_PDF_BUCKET", "geolabs-db-pdfs")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DB_FILE = os.path.join(UPLOAD_FOLDER, "chat_history.db")

# Optional: set this only if you know the path. Otherwise comment it out.
# pytesseract.pytesseract.tesseract_cmd = r"C:\Users\tyamashita\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"

# Embedding model (same as your previous code)
MODEL_NAME = "BAAI/bge-base-en-v1.5"
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
embedding_model = AutoModel.from_pretrained(MODEL_NAME)

CHUNK_SIZE = 800
OVERLAP = 200

# NLTK punkt
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

punkt_param = PunktParameters()
punkt_tokenizer = PunktSentenceTokenizer(punkt_param)

def safe_sent_tokenize(text):
    return punkt_tokenizer.tokenize(text)

admin_bp = Blueprint('admin', __name__)

# ---------------------- DB bootstrap ----------------------
def ensure_upload_history_table():
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS upload_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user TEXT,
                    file TEXT,
                    db_name TEXT,
                    timestamp TEXT
                )
            """)
    except Exception as e:
        print("⚠️ Could not initialize upload_history table:", e)

ensure_upload_history_table()

# ---------------------- Helpers ----------------------
def upload_pdf_to_s3(local_path, db_name, file_name, prefix=""):
    """Uploads to s3 as {db_name}/{prefix}/{file_name} and returns a presigned URL"""
    key = "/".join(x for x in [db_name.strip("/"), prefix.strip("/"), file_name] if x).replace("//", "/")
    try:
        s3.upload_file(
            Filename=local_path,
            Bucket=S3_BUCKET,
            Key=key,
            ExtraArgs={"ContentType": "application/pdf"}
        )
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=3600,
        )
        print(f"✅ Uploaded to S3: {key}")
        return key, url
    except Exception as e:
        print(f"❌ S3 upload failed: {e}")
        return None, None

def log_upload_history(user, file, db_name):
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute("""
                INSERT INTO upload_history (user, file, db_name, timestamp)
                VALUES (?, ?, ?, datetime('now'))
            """, (user or "guest", file, db_name))
    except Exception as e:
        print("⚠️ Failed to log upload:", e)

# ---------------------- Embedding utilities ----------------------
def compute_embeddings(text_chunks):
    inputs = tokenizer(text_chunks, padding=True, truncation=True, return_tensors="pt")
    with torch.no_grad():
        outputs = embedding_model(**inputs)
    embeddings = outputs.last_hidden_state.mean(dim=1)
    return embeddings.numpy()

def extract_text_from_pdf_with_ocr_fallback(pdf_path, track=print):
    doc = fitz.open(pdf_path)
    full_text = []
    for i, page in enumerate(doc):
        txt = page.get_text().strip()
        if txt:
            track(f"✅ Page {i+1}: Found native text")
            full_text.append(txt)
        else:
            track(f"🔍 Page {i+1}: No text found, running OCR…")
            try:
                pix = page.get_pixmap(dpi=300)
                img_data = pix.tobytes("ppm")
                img = Image.open(io.BytesIO(img_data))
                ocr_text = pytesseract.image_to_string(img).strip()
                if ocr_text:
                    track(f"✅ Page {i+1}: OCR extracted {len(ocr_text.split())} words")
                else:
                    track(f"⚠️ Page {i+1}: OCR failed or empty")
                full_text.append(ocr_text)
            except Exception as e:
                track(f"❌ OCR error on page {i+1}: {e}")
    doc.close()
    return "\n\n".join([t for t in full_text if t and t.strip()])

def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP):
    sentences = safe_sent_tokenize(text)
    chunks = []
    current = []
    for sentence in sentences:
        current.append(sentence)
        total_words = sum(len(s.split()) for s in current)
        if total_words >= chunk_size:
            chunks.append(' '.join(current))
            # keep overlap
            new_chunk = []
            overlap_words = 0
            for s in reversed(current):
                overlap_words += len(s.split())
                new_chunk.insert(0, s)
                if overlap_words >= overlap:
                    break
            current = new_chunk
    if current:
        chunks.append(' '.join(current))
    return chunks

def create_chunks_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            file TEXT,
            chunk INTEGER,
            text TEXT,
            embedding BLOB
        )
    """)

def create_general_chunks_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS general_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk TEXT,
            embedding BLOB
        )
    """)

def insert_chunks_with_embeddings(conn, file_name, chunks, embeddings):
    cur = conn.cursor()
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        cur.execute(
            "INSERT INTO chunks (file, chunk, text, embedding) VALUES (?, ?, ?, ?)",
            (file_name, i, chunk, emb.tobytes())
        )

def insert_general_chunks(conn, chunks, embeddings):
    cur = conn.cursor()
    for chunk, emb in zip(chunks, embeddings):
        cur.execute(
            "INSERT INTO general_chunks (chunk, embedding) VALUES (?, ?)",
            (chunk, emb.tobytes())
        )

def embed_to_db(input_pdf_path, db_path, file_name, track=print):
    track(f"📄 Loading PDF: {file_name}")
    try:
        track("🔍 Extracting text…")
        text = extract_text_from_pdf_with_ocr_fallback(input_pdf_path, track)
        if not text.strip():
            track(f"⚠️ No extractable text in: {file_name}")
            return
    except Exception as e:
        track(f"❌ Error reading PDF: {e}")
        return

    track("✂️ Chunking text…")
    chunks = chunk_text(text)
    track(f"✅ Created {len(chunks)} chunks")
    if not chunks:
        track("⚠️ No chunks extracted.")
        return

    track("🧠 Embedding chunks…")
    try:
        embeddings = compute_embeddings(chunks)
    except Exception as e:
        track(f"❌ Embedding failed: {e}")
        return

    track("💾 Writing to database…")
    try:
        conn = sqlite3.connect(db_path)
        create_chunks_table(conn)
        insert_chunks_with_embeddings(conn, file_name, chunks, embeddings)
        conn.commit()
        conn.close()
    except Exception as e:
        track(f"❌ Database write failed: {e}")
        return

    track(f"🎉 Done! Indexed {len(chunks)} chunks into '{os.path.basename(db_path)}'")

def embed_to_general_db(input_pdf_path, db_path, track=print):
    file_name = os.path.basename(input_pdf_path)
    track(f"📄 Loading PDF (general): {file_name}")
    text = extract_text_from_pdf_with_ocr_fallback(input_pdf_path, track)
    if not text.strip():
        track("⚠️ Skipped empty or unreadable PDF.")
        return

    track("✂️ Chunking text…")
    chunks = chunk_text(text)
    track(f"✅ Created {len(chunks)} chunks")
    if not chunks:
        track("⚠️ No chunks extracted.")
        return

    track("🔢 Embedding…")
    try:
        embeddings = compute_embeddings(chunks)
    except Exception as e:
        track(f"❌ Embedding failed: {e}")
        return

    track("💾 Writing to general_chunks table…")
    try:
        conn = sqlite3.connect(db_path)
        create_general_chunks_table(conn)
        insert_general_chunks(conn, chunks, embeddings)
        conn.commit()
        conn.close()
    except Exception as e:
        track(f"❌ Database write failed: {e}")
        return

    track(f"🎉 Done! Indexed {len(chunks)} general chunks into '{os.path.basename(db_path)}'")

# ---------------------- ROUTES USED BY DBAdmin.jsx ----------------------
@admin_bp.route('/api/process-file', methods=['POST'])
def process_file():
    """
    Form fields:
      - file: PDF
      - db_name: target sqlite file name (e.g. my_docs.db)
      - mode: 'general' or anything else (default chunks)
      - user: optional
    Returns: { message, steps[] }
    """
    steps = []
    try:
      file = request.files.get('file')
      db_name = request.form.get('db_name')
      mode = (request.form.get('mode') or '').strip().lower()
      user = request.form.get("user", "guest")

      if not file or not db_name:
          return jsonify({'message': 'Missing file or database name'}), 400

      original_filename = file.filename
      tmp_path = os.path.join(UPLOAD_FOLDER, original_filename)
      file.save(tmp_path)

      # Upload to S3 under {db_name}/{filename}
      key, s3_url = upload_pdf_to_s3(tmp_path, db_name, original_filename)
      if s3_url:
          steps.append(f"☁️ Uploaded to S3: {s3_url}")
      else:
          steps.append("⚠️ Failed to upload to S3")

      # Ensure uploads dir
      os.makedirs(UPLOAD_FOLDER, exist_ok=True)
      db_path = os.path.join(UPLOAD_FOLDER, db_name)

      def track(msg):
          print(msg)
          steps.append(msg)

      # Index
      if mode == 'general':
          embed_to_general_db(tmp_path, db_path, track)
      else:
          embed_to_db(tmp_path, db_path, original_filename, track)

      # Log
      try:
          log_upload_history(user, original_filename, db_name)
      except Exception as e:
          print("⚠️ Failed to log upload:", e)

      os.remove(tmp_path)
      return jsonify({'message': f"✅ File indexed into {db_name}!", 'steps': steps})
    except Exception as e:
      traceback.print_exc()
      try:
          if os.path.exists(tmp_path):
              os.remove(tmp_path)
      except Exception:
          pass
      return jsonify({'message': '❌ Failed to process file.'}), 500

@admin_bp.route('/api/list-dbs', methods=['GET'])
def list_dbs():
    try:
        dbs = [f for f in os.listdir(UPLOAD_FOLDER) if f.endswith('.db')]
        return jsonify({'dbs': dbs})
    except Exception as e:
        return jsonify({'dbs': [], 'error': str(e)}), 500

@admin_bp.route('/api/inspect-db', methods=['POST'])
def inspect_db():
    try:
        data = request.get_json()
        db_name = data.get('db_name')
        db_path = os.path.join(UPLOAD_FOLDER, db_name)

        if not os.path.exists(db_path):
            return jsonify({'error': 'Database not found'}), 404

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]

        structure = {}
        for table in tables:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = [row[1] for row in cursor.fetchall()]

            cursor.execute(f"SELECT * FROM {table} LIMIT 3")
            sample_rows = cursor.fetchall()

            safe_rows = []
            for row in sample_rows:
                safe_row = []
                for val in row:
                    if isinstance(val, (bytes, bytearray)):
                        safe_row.append(f"<{len(val)} bytes>")
                    else:
                        safe_row.append(val)
                safe_rows.append(safe_row)

            structure[table] = {
                "columns": columns,
                "sample_rows": safe_rows
            }

        conn.close()
        return jsonify(structure)

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/api/delete-db', methods=['POST'])
def delete_db():
    try:
        data = request.get_json()
        db_name = data.get('db_name')
        confirmation_text = data.get('confirmation_text', '')
        expected_confirmation = f"DELETE {db_name}"

        if confirmation_text.strip() != expected_confirmation:
            return jsonify({'error': 'Confirmation text does not match. Deletion aborted.'}), 400

        db_path = os.path.join(UPLOAD_FOLDER, db_name)
        if not os.path.exists(db_path):
            return jsonify({'error': 'Database not found'}), 404

        os.remove(db_path)
        try:
            log_upload_history("admin", "[DELETED_DB]", db_name)
        except Exception as e:
            print("⚠️ Failed to log deletion:", e)

        return jsonify({'message': f"✅ {db_name} successfully deleted."})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/api/list-files', methods=['POST'])
def list_files_in_db():
    """
    Returns distinct 'file' names from chunks for a given DB.
    Your DBAdmin uses this to map to S3 keys as {db}/{file}.
    """
    try:
        data = request.get_json()
        db_name = data.get("db_name")
        db_path = os.path.join(UPLOAD_FOLDER, db_name)

        if not db_name or not os.path.exists(db_path):
            return jsonify({"error": "Database not found"}), 404

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT file FROM chunks")
        files = [row[0] for row in cursor.fetchall()]
        conn.close()

        return jsonify({"files": files})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Failed to list files: {str(e)}"}), 500

@admin_bp.route('/api/upload-history', methods=['GET'])
def get_upload_history():
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT user, file, db_name, timestamp
            FROM upload_history
            ORDER BY timestamp DESC
            LIMIT 100
        """)
        rows = cursor.fetchall()
        conn.close()

        history = [
            {
                "user": row[0],
                "file": row[1],
                "db": row[2],
                "time": row[3]
            }
            for row in rows
        ]

        return jsonify(history)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Failed to retrieve upload history: {str(e)}"}), 500

# ---------------------- EXTRA: S3 list for DBAdmin.jsx ----------------------
@admin_bp.route('/api/s3-db-pdfs', methods=['GET'])
def s3_db_pdfs():
    """
    Returns a flat list of PDFs in the S3 bucket with presigned URLs:
      { files: [ { Key, url } ] }
    DBAdmin.jsx maps these to `${db}/${file}` to preview PDFs from the DB list.
    """
    try:
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=S3_BUCKET)
        out = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key.endswith("/") or not key.lower().endswith(".pdf"):
                    continue
                url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": S3_BUCKET, "Key": key},
                    ExpiresIn=3600,
                )
                out.append({"Key": key, "url": url})
        return jsonify({"files": out})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"files": [], "error": str(e)}), 500
    
@admin_bp.route('/api/upload-to-s3', methods=['POST'])
def upload_to_s3():
    file = request.files.get('file')
    prefix = request.form.get('prefix') or request.form.get('db_name', '')
    if not file:
        return jsonify({'error': 'Missing file'}), 400

    tmp_path = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(tmp_path)
    try:
        key, url = upload_pdf_to_s3(tmp_path, prefix, file.filename)
        if not key:
            return jsonify({'error': 'S3 upload failed'}), 500
        # optional: log this as an “upload” without DB indexing
        log_upload_history(request.form.get('user', 'guest'), file.filename, prefix or '(s3-only)')
        return jsonify({'message': '✅ Uploaded', 'key': key, 'url': url})
    finally:
        try: os.remove(tmp_path)
        except: pass

@admin_bp.route('/api/delete-s3-file', methods=['POST'])
def delete_s3_file():
    data = request.get_json() or {}
    key = data.get('key')
    if not key:
        return jsonify({'error': 'Missing key'}), 400
    s3.delete_object(Bucket=S3_BUCKET, Key=key)
    return jsonify({'message': f'✅ Deleted {key}'})

# --- add near your imports ---
from flask_cors import CORS

# If you init CORS at app level in app.py, do:
# CORS(app, resources={r"/api/*": {"origins": "*"}})

# If you only want it on this blueprint:
CORS(admin_bp, resources={r"/api/*": {"origins": "*"}})

# --- add this route (alias + preflight-safe) ---
@admin_bp.route('/api/s3-db-pdfs', methods=['GET', 'OPTIONS'])
@admin_bp.route('/api/s3/files', methods=['GET', 'OPTIONS'])   # <— alias your frontend is calling
def list_s3_pdfs():
    if request.method == 'OPTIONS':
        # CORS preflight handled here if not using flask-cors globally
        return ('', 204)

    try:
        # list all objects (paginate if you have >1k keys)
        resp = s3.list_objects_v2(Bucket=S3_BUCKET)
        contents = resp.get('Contents', []) or []

        files = []
        for obj in contents:
            key = obj['Key']
            if key.lower().endswith('.pdf'):
                url = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': S3_BUCKET, 'Key': key},
                    ExpiresIn=3600
                )
                lm = obj.get('LastModified')
                files.append({
                    'Key': key,
                    'url': url,
                    'Size': obj.get('Size', 0),
                    'LastModified': getattr(lm, 'isoformat', lambda: str(lm))()
                })

        return jsonify({'files': files})
    except Exception as e:
        print('❌ list_s3_pdfs error:', e)
        return jsonify({'files': [], 'error': str(e)}), 500
