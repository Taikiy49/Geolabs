import os
import io
import re
import json
import time
import sqlite3
from datetime import datetime
from typing import List, Dict, Any
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image
from dotenv import load_dotenv
import google.generativeai as genai


# ===========================
# Configuration
# ===========================
BASE_DIR = Path(__file__).resolve().parent

# Process the ENTIRE folder of PDFs
PDF_INPUT_PATH = (BASE_DIR / "reports_binder_input_folder").resolve()

# Output DB
OUTPUT_DB_PATH = (BASE_DIR / "reports_binder.db").resolve()

# Gemini settings
GEMINI_MODEL_NAME = "gemini-2.5-pro"
TEMPERATURE = 0.1

# Retry settings
MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 10  # seconds between retries on a Gemini failure

# Render settings
RENDER_DPI = 220  # higher = better OCR, slower

# Live logging tail
TAIL_ROWS_TO_SHOW = 3

# Extract printed page label (bottom-right crop)
EXTRACT_PAGE_LABEL = True
PAGE_LABEL_CROP = (0.70, 0.88, 1.00, 1.00)  # (x1,y1,x2,y2) fraction of image


# ===========================
# Init Gemini
# ===========================
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY not set in .env")
genai.configure(api_key=api_key)
vision_model = genai.GenerativeModel(GEMINI_MODEL_NAME)


# ===========================
# Helpers
# ===========================
def log(msg: str):
    print(msg, flush=True)

def normalize_date(val: str) -> str:
    s = (val or "").strip()
    if not s:
        return ""
    fmts = [
        "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y",
        "%m-%d-%Y", "%m-%d-%y", "%d-%b-%Y", "%d %b %Y"
    ]
    for f in fmts:
        try:
            return datetime.strptime(s, f).date().isoformat()
        except Exception:
            pass
    s2 = s.replace(".", "/").replace(",", " ").replace("\\", "/")
    for f in fmts:
        try:
            return datetime.strptime(s2, f).date().isoformat()
        except Exception:
            pass
    return ""

def normalize_wo(wo: str) -> str:
    if not wo:
        return ""
    s = str(wo).strip().upper().replace("–", "-").replace("—", "-")
    return " ".join(s.split())

def normalize_initials(s: str) -> str:
    """
    Keep colon-separated initials like GS:AT:TT.
    - Uppercase only
    - Allowed chars: A-Z and ':'
    - Tokens must be 1–4 letters
    """
    if not s:
        return ""
    s = s.upper().strip()
    s = re.sub(r"[^A-Z:]", "", s)            # keep only letters and colons
    s = re.sub(r":{2,}", ":", s).strip(":")  # collapse multiple colons, strip edges
    parts = [p for p in s.split(":") if 1 <= len(p) <= 4 and p.isalpha()]
    return ":".join(parts)

def normalize_billing(s: str) -> str:
    """
    Billing MUST be a 5- or 6-digit number. Otherwise return "".
    """
    if not s:
        return ""
    m = re.search(r"\b(\d{5,6})\b", str(s))
    return m.group(1) if m else ""

def parse_json_safely(txt: str):
    if not txt:
        return None
    # direct
    try:
        return json.loads(txt)
    except Exception:
        pass
    # array block
    a, b = txt.find("["), txt.rfind("]")
    if a != -1 and b != -1 and b > a:
        block = txt[a:b+1]
        try:
            return json.loads(block)
        except Exception:
            pass
    # object block
    a, b = txt.find("{"), txt.rfind("}")
    if a != -1 and b != -1 and b > a:
        block = txt[a:b+1]
        try:
            return json.loads(block)
        except Exception:
            pass
    return None

def pdf_page_to_pil_images(pdf_path: str, dpi: int = RENDER_DPI):
    imgs = []
    doc = fitz.open(pdf_path)
    try:
        for page in doc:
            mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            imgs.append(img)
    finally:
        doc.close()
    return imgs


# ===========================
# Output DB
# ===========================
def init_output_db(path: Path):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()

    # WAL so you can view while writing; we'll checkpoint after each page
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA wal_autocheckpoint=0;")  # we'll do manual FULL checkpoints

    # reports (NO page column, per your request)
    cur.execute("""
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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")

    # progress (to resume on rerun)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS progress (
        pdf_file TEXT PRIMARY KEY,
        last_completed_page INTEGER
    );
    """)

    # failures (keep page index here for debugging)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_file TEXT,
        page INTEGER,
        error TEXT,
        ts TEXT
    );
    """)

    conn.commit()
    conn.close()

def checkpoint_wal(path: Path):
    with sqlite3.connect(str(path)) as conn:
        conn.execute("PRAGMA wal_checkpoint(FULL);")
        conn.commit()

def get_last_completed_page(path: Path, pdf_file: str) -> int:
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT last_completed_page FROM progress WHERE pdf_file = ?", (pdf_file,))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else 0

def set_last_completed_page(path: Path, pdf_file: str, page_num: int):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO progress(pdf_file, last_completed_page)
        VALUES(?, ?)
        ON CONFLICT(pdf_file) DO UPDATE SET last_completed_page = excluded.last_completed_page
    """, (pdf_file, page_num))
    conn.commit()
    conn.close()

def insert_rows(path: Path, rows: List[Dict[str, Any]]):
    if not rows:
        return
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.executemany("""
        INSERT INTO reports
        (pdf_file, date, work_order, engineer_initials, billing, date_sent, page_label)
        VALUES (:pdf_file, :date, :work_order, :engineer_initials, :billing, :date_sent, :page_label)
    """, rows)
    conn.commit()
    conn.close()

    # echo each row
    for r in rows:
        log(f"   ↳ SAVED: {r}")

    # totals & tail
    show_db_progress(path)

def show_db_progress(path: Path, tail: int = TAIL_ROWS_TO_SHOW):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM reports;")
    total = cur.fetchone()[0]
    log(f"      • TOTAL rows so far: {total}")
    if tail > 0 and total > 0:
        cur.execute("""
            SELECT pdf_file, page_label, date, work_order, engineer_initials, billing, date_sent
            FROM reports
            ORDER BY id DESC
            LIMIT ?;
        """, (tail,))
        rows = cur.fetchall()
        for row in rows[::-1]:
            log(f"      • LAST: {row}")
    conn.close()

def log_failure(path: Path, pdf_file: str, page: int, error: str):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO failures (pdf_file, page, error, ts)
        VALUES (?, ?, ?, ?)
    """, (pdf_file, page, error, datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()


# ===========================
# Gemini OCR
# ===========================
OCR_PROMPT = """
You are an expert at reading photographed tabular report logs.

From the given image of a table, extract ONLY the following columns for each row in order:
- date (leftmost column)
- work_order
- engineer_initials
- billing
- date_sent

DO NOT OCR or include the "Client / Report Title / Date of Report" column.

Output STRICT JSON as an array of objects like:
[
  {
    "date": "YYYY-MM-DD",
    "work_order": "8292-05B",
    "engineer_initials": "GS:AT:TT",
    "billing": "123456",
    "date_sent": "YYYY-MM-DD"
  }
]

Rules:
- If a date is like "6/12/14" or "6-12-2014", normalize to YYYY-MM-DD. If unknown, use "".
- Keep the exact work order including dash and trailing letter/parenthetical if visible.
- engineer_initials: keep uppercase letters and colons only (e.g., "GS:AT" or "GS:AT:TT").
- billing: MUST be only the 5- or 6-digit invoice number (digits only). If none present, use "".
- For missing values use "".
- Return ONLY the JSON. No commentary.
""".strip()

def gemini_extract_rows(image: Image.Image):
    resp = vision_model.generate_content([OCR_PROMPT, image], generation_config={"temperature": TEMPERATURE})
    raw = (getattr(resp, "text", "") or "").strip()
    data = parse_json_safely(raw)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected OCR output. First 200 chars:\n{raw[:200]}")

    cleaned = []
    for row in data:
        cleaned.append({
            "date": normalize_date(row.get("date", "")),
            "work_order": normalize_wo(row.get("work_order", "")),
            "engineer_initials": normalize_initials(row.get("engineer_initials") or ""),
            "billing": normalize_billing(row.get("billing") or ""),
            "date_sent": normalize_date(row.get("date_sent", "")),
        })
    return cleaned

def extract_page_label(image: Image.Image) -> str:
    if not EXTRACT_PAGE_LABEL:
        return ""
    w, h = image.size
    x1, y1, x2, y2 = PAGE_LABEL_CROP
    crop = image.crop((int(w * x1), int(h * y1), int(w * x2), int(h * y2)))
    prompt = "Extract only the page number visible in this bottom-right crop. Output just the number (e.g., 93)."
    try:
        resp = vision_model.generate_content([prompt, crop], generation_config={"temperature": 0.0})
        txt = (getattr(resp, "text", "") or "").strip()
        m = re.search(r"\d{1,5}", txt)
        return m.group(0) if m else ""
    except Exception:
        return ""


# ===========================
# Processing
# ===========================
def process_pdf(pdf_path: Path):
    pdf_name = pdf_path.name
    log(f"📄 START PDF: {pdf_name}")

    try:
        images = pdf_page_to_pil_images(str(pdf_path), dpi=RENDER_DPI)
    except Exception as e:
        log(f"❌ Could not open/render {pdf_name}: {e}")
        return

    total_pages = len(images)
    last_done = get_last_completed_page(OUTPUT_DB_PATH, pdf_name)

    if last_done >= total_pages:
        log(f"ℹ️  Already completed {pdf_name} ({total_pages} pages). Skipping.")
        return

    # Resume from last completed + 1
    for page_idx in range(last_done + 1, total_pages + 1):
        img = images[page_idx - 1]
        log(f"➡️  Page {page_idx}/{total_pages} — processing…")

        rows_for_db = []
        attempt = 0
        while attempt < MAX_RETRIES:
            try:
                page_label = extract_page_label(img)
                rows = gemini_extract_rows(img)

                if not rows:
                    log("   ⚠️  No rows extracted on this page.")

                for r in rows:
                    rows_for_db.append({
                        "pdf_file": pdf_name,
                        "date": r["date"],
                        "work_order": r["work_order"],
                        "engineer_initials": r["engineer_initials"],
                        "billing": r["billing"],
                        "date_sent": r["date_sent"],
                        "page_label": page_label,
                    })

                if rows_for_db:
                    insert_rows(OUTPUT_DB_PATH, rows_for_db)
                else:
                    log("   ℹ️  Skipping insert (no rows).")

                # Mark progress (so resume starts after this page)
                set_last_completed_page(OUTPUT_DB_PATH, pdf_name, page_idx)

                # Make rows visible immediately in viewers
                checkpoint_wal(OUTPUT_DB_PATH)

                log(f"✅ Page {page_idx}/{total_pages} done — {len(rows_for_db)} rows saved. (page_label={page_label or '∅'})")
                break

            except Exception as e:
                attempt += 1
                err_msg = str(e)
                log(f"⚠️  Gemini error on page {page_idx} (attempt {attempt}/{MAX_RETRIES}): {err_msg}")
                if attempt >= MAX_RETRIES:
                    log_failure(OUTPUT_DB_PATH, pdf_name, page_idx, err_msg)
                    log(f"⛔ Giving up on page {page_idx}. Logged failure and moving on.")
                    # Still advance progress so next run resumes after this problematic page
                    set_last_completed_page(OUTPUT_DB_PATH, pdf_name, page_idx)
                    checkpoint_wal(OUTPUT_DB_PATH)
                    break
                log(f"⏳ Waiting {RETRY_DELAY_SECONDS}s then retrying…")
                time.sleep(RETRY_DELAY_SECONDS)

    log(f"🏁 DONE PDF: {pdf_name} — {total_pages} pages processed (resume-ready).")

def process_input(pdf_path_or_dir: Path):
    if pdf_path_or_dir.is_dir():
        pdfs = sorted([p for p in pdf_path_or_dir.glob("*.pdf")], key=lambda p: p.name.lower())
    elif pdf_path_or_dir.is_file() and pdf_path_or_dir.suffix.lower() == ".pdf":
        pdfs = [pdf_path_or_dir]
    else:
        raise FileNotFoundError(f"No PDF(s) found at: {pdf_path_or_dir}")

    if not pdfs:
        log("⚠️ No PDFs found to process.")
        return

    log(f"📚 Found {len(pdfs)} PDFs:")
    for p in pdfs:
        log(f"   • {p.name}")

    for p in pdfs:
        process_pdf(p)

def dump_summary(path: Path):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM reports;")
    total = cur.fetchone()[0]
    log(f"📊 FINAL TOTAL rows: {total}")
    cur.execute("""
        SELECT pdf_file, page_label, date, work_order, engineer_initials, billing, date_sent
        FROM reports
        ORDER BY id DESC
        LIMIT 10;
    """)
    rows = cur.fetchall()
    for r in rows[::-1]:
        log(f"   • {r}")
    conn.close()

def main():
    log(f"🔧 Running from: {Path.cwd()}")
    log(f"📥 Input folder: {PDF_INPUT_PATH}")
    log(f"🗄️  Output DB:   {OUTPUT_DB_PATH}")
    init_output_db(OUTPUT_DB_PATH)
    process_input(PDF_INPUT_PATH)
    dump_summary(OUTPUT_DB_PATH)
    # Final flush to main file
    checkpoint_wal(OUTPUT_DB_PATH)
    log("🎉 All done. DB is resume-ready. Check reports in the SQLite DB.")

if __name__ == "__main__":
    main()
