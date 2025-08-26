# reports.py
import os, io, re, hashlib, sqlite3, tempfile
from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_cors import CORS

import fitz  # PyMuPDF
from PIL import Image
import pytesseract

import nltk
from nltk.tokenize.punkt import PunktSentenceTokenizer, PunktParameters

import torch
from transformers import AutoTokenizer, AutoModel
import numpy as np

import boto3
from botocore.exceptions import ClientError

# ---------------------- CONFIG ----------------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

REPORTS_DB = os.path.join(UPLOAD_DIR, "reports.db")
S3_BUCKET = os.environ.get("S3_PDF_BUCKET", "geolabs-db-pdfs")
S3 = boto3.client("s3")

FIXED_PREFIX = "reports"  # 🔒 always use this

# pytesseract.pytesseract.tesseract_cmd = r"C:\Path\To\Tesseract-OCR\tesseract.exe"

MODEL_NAME = "BAAI/bge-base-en-v1.5"
_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
_model = AutoModel.from_pretrained(MODEL_NAME)
_model.eval()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
_model.to(DEVICE)

try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt")
_punkt = PunktSentenceTokenizer(PunktParameters())

reports_bp = Blueprint("reports", __name__)
CORS(reports_bp, resources={r"/api/*": {"origins": "*"}})

# ---------------------- SCHEMA ----------------------
def ensure_schema(db_path: str):
    with sqlite3.connect(db_path) as conn:
        c = conn.cursor()
        c.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            file_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name   TEXT,
            s3_key      TEXT UNIQUE,
            work_order  TEXT,
            project     TEXT,
            location    TEXT,
            report_date TEXT,
            pages       INTEGER,
            sha256      TEXT UNIQUE,
            created_at  TEXT,
            updated_at  TEXT
        );
        """)
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_s3key ON reports(s3_key);")
        c.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            file_id    INT,
            page       INT,
            chunk_id   INT,
            start_char INT,
            end_char   INT,
            text       TEXT,
            embedding  BLOB,
            PRIMARY KEY(file_id, page, chunk_id)
        );
        """)
        c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            text,
            file_id UNINDEXED,
            page UNINDEXED,
            chunk_id UNINDEXED,
            content=''
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_page ON chunks(file_id, page);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_reports_sha ON reports(sha256);")
        conn.commit()

# ---------------------- HELPERS ----------------------
def safe_sent_tokenize(text: str): return _punkt.tokenize(text)

def sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""): h.update(block)
    return h.hexdigest()

def s3_key_exists(key: str) -> bool:
    try:
        S3.head_object(Bucket=S3_BUCKET, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return False
        raise

def extract_pages_with_ocr(pdf_path: str, track=print):
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        txt = page.get_text().strip()
        if txt:
            track(f"✅ p.{i+1}: native text ({len(txt.split())} words)")
            pages.append(txt)
            continue
        try:
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("ppm")))
            ocr_text = pytesseract.image_to_string(img, config="--psm 6").strip()
            track(f"🔍 p.{i+1}: OCR extracted {len(ocr_text.split())} words")
            pages.append(ocr_text)
        except Exception as e:
            track(f"❌ p.{i+1}: OCR error: {e}")
            pages.append("")
    doc.close()
    return pages

def chunk_page_text(text: str, max_tokens=420, overlap=140):
    sents = safe_sent_tokenize(text)
    chunks, offsets = [], []
    cursor = 0
    sent_spans = []
    for s in sents:
        start = text.find(s, cursor)
        if start < 0: start = cursor
        end = start + len(s)
        sent_spans.append((s, start, end))
        cursor = end

    win, win_len, win_spans = [], 0, []
    for s, st, en in sent_spans:
        t = len(s.split())
        if win_len + t > max_tokens and win:
            chunk_text = " ".join([x[0] for x in win])
            chunks.append(chunk_text)
            offsets.append((win_spans[0][1], win_spans[-1][2]))
            # overlap
            ov, ov_len, ov_spans = [], 0, []
            for s2, st2, en2 in reversed(win):
                ov_len += len(s2.split())
                ov.insert(0, (s2, st2, en2))
                ov_spans.insert(0, (s2, st2, en2))
                if ov_len >= overlap: break
            win, win_len, win_spans = ov, ov_len, ov_spans

        win.append((s, st, en))
        win_spans.append((s, st, en))
        win_len += t

    if win:
        chunk_text = " ".join([x[0] for x in win])
        chunks.append(chunk_text)
        offsets.append((win_spans[0][1], win_spans[-1][2]))
    return chunks, offsets

def encode_passages_bge(texts, batch_size=32):
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = [f"passage: {t}" for t in texts[i:i+batch_size]]
            inputs = _tokenizer(batch, padding=True, truncation=True, max_length=512, return_tensors="pt").to(DEVICE)
            outputs = _model(**inputs)
            vecs = outputs.pooler_output if hasattr(outputs, "pooler_output") and outputs.pooler_output is not None else outputs.last_hidden_state[:, 0]
            vecs = torch.nn.functional.normalize(vecs, p=2, dim=1)
            out.append(vecs.cpu().numpy())
    return np.concatenate(out, axis=0)

def s3_upload_if_missing(local_path: str, file_name: str, track=print):
    key = "/".join(x for x in [FIXED_PREFIX, file_name] if x).replace("//", "/")
    if s3_key_exists(key):
        track(f"ℹ️ S3 already has {key} — skipping upload")
        url = S3.generate_presigned_url("get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=3600)
        return key, url, False
    try:
        S3.upload_file(Filename=local_path, Bucket=S3_BUCKET, Key=key, ExtraArgs={"ContentType": "application/pdf"})
        url = S3.generate_presigned_url("get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=3600)
        return key, url, True
    except Exception as e:
        track(f"❌ S3 upload failed: {e}")
        return None, None, False

def db_has_sha_or_key(sha: str, key: str | None) -> bool:
    with sqlite3.connect(REPORTS_DB) as conn:
        cur = conn.cursor()
        if key:
            cur.execute("SELECT 1 FROM reports WHERE sha256 = ? OR s3_key = ? LIMIT 1", (sha, key))
        else:
            cur.execute("SELECT 1 FROM reports WHERE sha256 = ? LIMIT 1", (sha,))
        return cur.fetchone() is not None

# ---------------------- INDEX CORE ----------------------
def index_pdf_at_path(local_pdf_path: str, file_name: str, *, work_order="", project="", location="", report_date="", s3_key: str | None, replace_if_exists=False, track=print):
    ensure_schema(REPORTS_DB)

    digest = sha256_of_file(local_pdf_path)
    track(f"🔏 SHA256: {digest}")

    if not replace_if_exists and db_has_sha_or_key(digest, s3_key):
        track("⛔ Already indexed (sha256 or s3_key). Skipping.")
        return {"skipped": True, "reason": "already-indexed"}

    track("🔍 Extracting text by page…")
    pages = extract_pages_with_ocr(local_pdf_path, track)
    nonempty = sum(1 for p in pages if (p or "").strip())
    track(f"📑 Pages: {len(pages)} (non-empty: {nonempty})")

    flat_chunks, page_map, offset_map = [], [], []
    for page_idx, ptext in enumerate(pages, start=1):
        if not (ptext or "").strip():
            continue
        chunks, offsets = chunk_page_text(ptext, max_tokens=420, overlap=140)
        for j, ch in enumerate(chunks):
            flat_chunks.append(ch)
            page_map.append((page_idx, j))
            start_char, end_char = offsets[j]
            offset_map.append((page_idx, start_char, end_char))

    track(f"✂️ Chunked → {len(flat_chunks)} chunks")
    if not flat_chunks:
        track("⚠️ No text extracted; nothing to index.")
        return {"skipped": True, "reason": "no-text"}

    track("🧠 Embedding chunks…")
    embs = encode_passages_bge(flat_chunks, batch_size=32)

    with sqlite3.connect(REPORTS_DB) as conn:
        cur = conn.cursor()

        if replace_if_exists:
            if s3_key:
                cur.execute("SELECT file_id FROM reports WHERE s3_key = ?", (s3_key,))
            else:
                cur.execute("SELECT file_id FROM reports WHERE sha256 = ?", (digest,))
            row = cur.fetchone()
            if row:
                old_id = row[0]
                cur.execute("DELETE FROM chunks WHERE file_id = ?", (old_id,))
                cur.execute("DELETE FROM chunks_fts WHERE file_id = ?", (old_id,))
                cur.execute("DELETE FROM reports WHERE file_id = ?", (old_id,))

        cur.execute("""
            INSERT INTO reports (file_name, s3_key, work_order, project, location, report_date, pages, sha256, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (file_name, s3_key, work_order, project, location, report_date or None, len(pages), digest, datetime.now().isoformat(), datetime.now().isoformat()))
        file_id = cur.lastrowid

        for row_idx, (vec, (page, local_idx), (page2, start_char, end_char)) in enumerate(zip(embs, page_map, offset_map)):
            assert page == page2
            text = flat_chunks[row_idx]
            cur.execute("""INSERT INTO chunks (file_id, page, chunk_id, start_char, end_char, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (file_id, page, local_idx, start_char, end_char, text, vec.tobytes()))
            cur.execute("""INSERT INTO chunks_fts (text, file_id, page, chunk_id) VALUES (?, ?, ?, ?)""",
                        (text, file_id, page, local_idx))

        conn.commit()

    track(f"🎉 Indexed: {file_name} ({len(flat_chunks)} chunks)")
    return {"skipped": False, "file_id": file_id, "sha256": sha256_of_file(local_pdf_path)}

# ---------------------- ROUTES ----------------------
@reports_bp.route("/api/reports/index", methods=["POST", "OPTIONS"])
def index_report_upload():
    steps = []; track = lambda m: (steps.append(m), print(m))
    try:
        ensure_schema(REPORTS_DB)

        f = request.files.get("file")
        if not f:
            return jsonify({"error": "Missing file"}), 400

        location = ""
        report_date = ""
        file_name = f.filename
        # derive from filename: "XXXX-XX(.suffix).ProjectName.pdf"
        work_order, project = parse_filename(file_name)
        upload_to_s3 = (request.form.get("upload_to_s3") or "true").lower() == "true"
        replace_if_exists = (request.form.get("replace_if_exists") or "false").lower() == "true"

        file_name = f.filename
        tmp_path = os.path.join(UPLOAD_DIR, file_name)
        f.save(tmp_path)
        track(f"📄 Saved upload → {tmp_path}")

        s3_key = None
        if upload_to_s3:
          key, url, uploaded = s3_upload_if_missing(tmp_path, file_name, track)
          s3_key = key
          if uploaded:
              track(f"☁️ Uploaded to s3://{S3_BUCKET}/{key}")
        else:
          track("ℹ️ Skipping S3 upload by request.")

        res = index_pdf_at_path(
            tmp_path, file_name,
            work_order=work_order, project=project, location=location,
            report_date=report_date, s3_key=s3_key, replace_if_exists=replace_if_exists, track=track
        )

        try: os.remove(tmp_path)
        except: pass

        if res.get("skipped"):
            return jsonify({"message": f"Skipped: {res['reason']}", "steps": steps})
        return jsonify({"message": "Indexed", "file_id": res.get("file_id"), "steps": steps})

    except Exception as e:
        steps.append(f"❌ Error: {e}")
        return jsonify({"error": str(e), "steps": steps}), 500

@reports_bp.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

@reports_bp.route("/api/reports/bulk-index", methods=["POST", "OPTIONS"])
def bulk_index_reports():
    """
    Accept multiple PDFs in one request.
    FormData:
      - files: (repeated) PDFs
      - work_order, project, location, report_date
      - upload_to_s3 (true/false)
      - replace_if_exists (true/false)
    """
    steps = []; track = lambda m: (steps.append(m), print(m))
    try:
        ensure_schema(REPORTS_DB)

        upload_to_s3 = (request.form.get("upload_to_s3") or "true").lower() == "true"
        replace_if_exists = (request.form.get("replace_if_exists") or "false").lower() == "true"

        files = request.files.getlist("files")
        if not files:
            return jsonify({"error": "No files provided"}), 400

        track(f"📦 Bulk indexing {len(files)} file(s)")

        for f in files:
            file_name = f.filename
            tmp_path = os.path.join(UPLOAD_DIR, file_name)
            f.save(tmp_path)
            track(f"— ▶ {file_name}")

            # derive from filename per your rule
            work_order, project = parse_filename(file_name)
            location, report_date = "", ""

            s3_key = None
            if upload_to_s3:
                key, url, uploaded = s3_upload_if_missing(tmp_path, file_name, track)
                s3_key = key
                if uploaded:
                    track(f"   ☁️ Uploaded to s3://{S3_BUCKET}/{key}")
            else:
                track("   ℹ️ Skipping S3 upload by request.")

            res = index_pdf_at_path(
                tmp_path, file_name,
                work_order=work_order, project=project, location=location,
                report_date=report_date, s3_key=s3_key, replace_if_exists=replace_if_exists, track=track
            )



            try: os.remove(tmp_path)
            except: pass

            if res.get("skipped"):
                track(f"   ⏭️ Skipped: {res['reason']}")
            else:
                track(f"   ✅ Indexed (file_id={res.get('file_id')})")

        return jsonify({"message": "Bulk done", "steps": steps})

    except Exception as e:
        steps.append(f"❌ Error: {e}")
        return jsonify({"error": str(e), "steps": steps}), 500

# Minimal stats/files for UI
@reports_bp.route("/api/reports/stats", methods=["GET"])
def reports_stats():
    ensure_schema(REPORTS_DB)
    with sqlite3.connect(REPORTS_DB) as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*), IFNULL(SUM(pages),0) FROM reports")
        files, pages = cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM chunks")
        chunks = cur.fetchone()[0]
    return jsonify({"files": files or 0, "pages": pages or 0, "chunks": chunks or 0})

@reports_bp.route("/api/reports/files", methods=["GET"])
def reports_files():
    ensure_schema(REPORTS_DB)
    with sqlite3.connect(REPORTS_DB) as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT r.file_id, r.file_name, r.work_order, r.pages,
               (SELECT COUNT(*) FROM chunks c WHERE c.file_id = r.file_id) AS chunks_cnt
        FROM reports r
        ORDER BY r.file_id DESC
        LIMIT 300
        """)
        rows = cur.fetchall()
    files = [
        {
            "file_id": row[0],
            "file_name": row[1],
            "work_order": row[2],
            "pages": row[3],
            "chunks": row[4],
        } for row in rows
    ]
    return jsonify({"files": files})


def parse_filename(file_name: str):
    """
    Example: '8482-00A.ProjectName.pdf'
    → work_order = '8482-00A'
    → project = 'ProjectName'
    """
    base = os.path.basename(file_name)
    if base.lower().endswith(".pdf"):
        base = base[:-4]  # strip .pdf

    parts = base.split(".", 1)
    if len(parts) == 2:
        work_order, project = parts
    else:
        work_order, project = parts[0], ""
    return work_order.strip(), project.strip()

