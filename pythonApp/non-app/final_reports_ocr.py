# final_reports_ocr.py
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

# Single input PDF with pages in correct order (1..N)
PDF_INPUT_PATH = (BASE_DIR / "../uploads/FINAL_REPORTS.PDF").resolve()

# Output DB (table has ONLY the requested columns)
OUTPUT_DB_PATH = (BASE_DIR / "../uploads/reports_binder.db").resolve()

# Gemini
GEMINI_MODEL_NAME = "gemini-2.5-pro"
TEMPERATURE = 0.1

# Retries
MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 10  # seconds between retries

# Render (higher DPI = better OCR but slower)
RENDER_DPI = 220

# Live logging tail
TAIL_ROWS_TO_SHOW = 3

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

def parse_json_safely(txt: str):
    if not txt:
        return None
    try:
        return json.loads(txt)
    except Exception:
        pass
    a, b = txt.find("["), txt.rfind("]")
    if a != -1 and b != -1 and b > a:
        block = txt[a:b+1]
        try:
            return json.loads(block)
        except Exception:
            pass
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
# Normalizers
# ===========================
CANON_WO = re.compile(r"^\d{4}-\d{2}(?:\([A-Z]+\))?$")  # NNNN-NN or NNNN-NN(LETTERS)

def _U(s: str) -> str:
    return (s or "").upper().strip()

def _clean_paren_text(txt: str) -> str:
    t = _U(txt)
    t = t.replace("ADDENDUM", "ADD").replace("ADD.", "ADD").replace("ADDL", "ADD")
    t = t.replace("AMEND", "AMD").replace("AMD.", "AMD")
    t = t.replace("REV.", "REV")
    t = re.sub(r"[^A-Z&/ ,]", "", t)
    first = re.split(r"[&/, ]+", t, maxsplit=1)[0]
    return re.sub(r"[^A-Z]", "", first)

def normalize_work_order_best_effort(wo_raw: str) -> str:
    """
    Try to normalize to NNNN-NN or NNNN-NN(LETTERS).
    If we can't confidently do that, return the original OCR string.
    """
    if not wo_raw:
        return ""
    t = _U(wo_raw).replace("—", "-").replace("–", "-").replace(".", "-")
    t = re.sub(r"\s+", " ", t).strip()
    if t.endswith(")") and "(" not in t:
        t = t[:-1].rstrip()

    # Split project vs rest on first sep
    m = re.match(r"^(\S+?)[- ]+(.*)$", t)
    if not m:
        return wo_raw  # keep raw if no split

    proj_raw, rest = m.group(1), m.group(2).strip()

    # Accept 4-digit project OR try to salvage 3 digits (+optional letter) or 2 digits + letter
    proj = None
    proj_letter = ""
    if re.fullmatch(r"\d{4}", proj_raw):
        proj = proj_raw
    else:
        m3 = re.fullmatch(r"(\d{3})([A-Z]?)", proj_raw)
        if m3:
            proj = "0" + m3.group(1)
            proj_letter = m3.group(2) or ""
        else:
            m2 = re.fullmatch(r"(\d{2})([A-Z])", proj_raw)
            if m2:
                proj = "00" + m2.group(1)
                proj_letter = m2.group(2)
            else:
                return wo_raw  # not confident

    # Pull first (...) as paren suffix
    par = ""
    pm = re.search(r"\(([^)]*)\)", rest)
    if pm:
        par = _clean_paren_text(pm.group(1))
        rest = (rest[:pm.start()] + rest[pm.end():]).strip()

    # Keep first section-like token; allow digits+letters or letters-only
    rest = rest.replace("&", " ")
    parts = [p for p in re.split(r"[- ]+", rest) if p]
    if not parts:
        return wo_raw

    numtok = None
    inline_letters = ""
    for p in parts:
        pu = _U(p)
        mm = re.fullmatch(r"(\d+)([A-Z]+)?", pu)
        if mm:
            numtok = mm.group(1)
            inline_letters = mm.group(2) or ""
            break
        if re.fullmatch(r"[A-Z]+", pu) and numtok is None:
            numtok = ""  # letters-only
            inline_letters = pu
            break

    if numtok is None:
        return wo_raw

    section = (numtok[-2:].zfill(2) if numtok else "00")

    suffix = "".join(x for x in [inline_letters, par, proj_letter] if x)
    if suffix:
        suffix = re.sub(r"[^A-Z]", "", suffix)

    candidate = f"{proj}-{section}" + (f"({suffix})" if suffix else "")
    # If candidate matches canonical, use it; else, keep raw
    return candidate if CANON_WO.match(candidate) else wo_raw

def normalize_initials(s: str) -> str:
    """
    Keep colon-separated initials like GS:AT:TT (uppercased A-Z and ':', tokens 1–4 letters).
    """
    if not s:
        return ""
    s = s.upper().strip()
    s = re.sub(r"[^A-Z:]", "", s)
    s = re.sub(r":{2,}", ":", s).strip(":")
    parts = [p for p in s.split(":") if 1 <= len(p) <= 4 and p.isalpha()]
    return ":".join(parts)

def normalize_billing_strict(s: str) -> str:
    """
    Must be 5 digits.
    - If OCR yields a 6-digit number starting with 0, drop the leading 0.
    - Otherwise, take the first 5-digit sequence.
    - If none, return "".
    """
    if not s:
        return ""
    txt = "".join(ch for ch in str(s) if ch.isdigit())
    # Check explicit 6 digits starting with 0
    m6 = re.search(r"\b0(\d{5})\b", txt)
    if m6:
        return m6.group(1)
    # Else any 5-digit sequence
    m5 = re.search(r"\b(\d{5})\b", txt)
    if m5:
        return m5.group(1)
    return ""

# ===========================
# Output DB
# ===========================
def init_output_db(path: Path):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()

    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA wal_autocheckpoint=0;")

    # Minimal schema per your request (page, work_order, engineer_initials, billing, date_sent)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_file TEXT,
        page INTEGER,
        work_order TEXT,
        engineer_initials TEXT,
        billing TEXT,
        date_sent TEXT
    );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_pdf_page ON reports(pdf_file, page);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")

    # Resume progress
    cur.execute("""
    CREATE TABLE IF NOT EXISTS progress (
        pdf_file TEXT PRIMARY KEY,
        last_completed_page INTEGER
    );
    """)

    # Failures
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
        INSERT INTO reports (pdf_file, page, work_order, engineer_initials, billing, date_sent)
        VALUES (:pdf_file, :page, :work_order, :engineer_initials, :billing, :date_sent)
    """, rows)
    conn.commit()
    conn.close()

    for r in rows:
        log(f"   ↳ SAVED: {r}")

    show_db_progress(path)

def show_db_progress(path: Path, tail: int = TAIL_ROWS_TO_SHOW):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM reports;")
    total = cur.fetchone()[0]
    log(f"      • TOTAL rows so far: {total}")
    if tail > 0 and total > 0:
        cur.execute("""
            SELECT pdf_file, page, work_order, engineer_initials, billing, date_sent
            FROM reports
            ORDER BY id DESC
            LIMIT ?;
        """, (tail,))
        rows = cur.fetchall()
        for row in reversed(rows):
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

From the given image of a table, extract ONLY these columns for each row:
- work_order
- engineer_initials
- billing
- date_sent

IMPORTANT:
- Do NOT include any "Client / Report Title / Date of Report" text.
- The page number is NOT needed; it is handled externally.
- Output STRICT JSON: a list of objects in this exact shape:

[
  {
    "work_order": "8292-05B",
    "engineer_initials": "GS:AT:TT",
    "billing": "012345",
    "date_sent": "YYYY-MM-DD"
  }
]

Rules:
- work_order: keep what you see; include dash and any trailing letters/parenthetical if visible.
- engineer_initials: uppercase letters and colons only (e.g., "GS:AT" or "GS:AT:TT").
- billing: digits only; if blank, use "".
- date_sent: normalize to YYYY-MM-DD when possible; else use "".
- Return ONLY the JSON (no commentary).
""".strip()

def gemini_extract_rows(image: Image.Image):
    resp = vision_model.generate_content([OCR_PROMPT, image], generation_config={"temperature": TEMPERATURE})
    raw = (getattr(resp, "text", "") or "").strip()
    data = parse_json_safely(raw)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected OCR output. First 200 chars:\n{raw[:200]}")
    return data

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

    # Pages are in correct order; page index == true page number
    for page_num in range(last_done + 1, total_pages + 1):
        img = images[page_num - 1]
        log(f"➡️  Page {page_num}/{total_pages} — processing…")

        attempt = 0
        while attempt < MAX_RETRIES:
            try:
                rows = gemini_extract_rows(img)

                # Clean and insert
                cleaned_rows = []
                for r in rows:
                    wo_raw = (r.get("work_order") or "").strip()
                    initials_raw = r.get("engineer_initials") or ""
                    billing_raw = r.get("billing") or ""
                    date_sent_raw = r.get("date_sent") or ""

                    wo_norm = normalize_work_order_best_effort(wo_raw)
                    initials_norm = normalize_initials(initials_raw)
                    bill_norm = normalize_billing_strict(billing_raw)
                    # date_sent: allow raw; try to normalize to ISO if it's in common formats
                    date_sent_norm = r.get("date_sent") or ""
                    if date_sent_norm:
                        # very light normalization to ISO if possible
                        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%m-%d-%y", "%d-%b-%Y", "%d %b %Y"):
                            try:
                                date_sent_norm = datetime.strptime(date_sent_norm.strip(), fmt).date().isoformat()
                                break
                            except Exception:
                                pass
                        else:
                            # allow as-is if we can't parse confidently
                            date_sent_norm = date_sent_raw.strip()

                    cleaned_rows.append({
                        "pdf_file": pdf_name,
                        "page": page_num,
                        "work_order": wo_norm,
                        "engineer_initials": initials_norm,
                        "billing": bill_norm,
                        "date_sent": date_sent_norm,
                    })

                if cleaned_rows:
                    insert_rows(OUTPUT_DB_PATH, cleaned_rows)
                else:
                    log("   ℹ️  No rows extracted on this page.")

                # Progress + WAL checkpoint (resume-safe and immediately viewable)
                set_last_completed_page(OUTPUT_DB_PATH, pdf_name, page_num)
                checkpoint_wal(OUTPUT_DB_PATH)

                log(f"✅ Page {page_num}/{total_pages} done — {len(cleaned_rows)} rows saved.")
                break

            except Exception as e:
                attempt += 1
                err_msg = str(e)
                log(f"⚠️  Gemini error on page {page_num} (attempt {attempt}/{MAX_RETRIES}): {err_msg}")
                if attempt >= MAX_RETRIES:
                    log_failure(OUTPUT_DB_PATH, pdf_name, page_num, err_msg)
                    log(f"⛔ Giving up on page {page_num}. Logged failure and moving on.")
                    # Mark page as attempted so rerun starts at the next page
                    set_last_completed_page(OUTPUT_DB_PATH, pdf_name, page_num)
                    checkpoint_wal(OUTPUT_DB_PATH)
                    break
                log(f"⏳ Waiting {RETRY_DELAY_SECONDS}s then retrying…")
                time.sleep(RETRY_DELAY_SECONDS)

    log(f"🏁 DONE PDF: {pdf_name} — {total_pages} pages processed (resume-ready).")

def dump_summary(path: Path):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM reports;")
    total = cur.fetchone()[0]
    log(f"📊 FINAL TOTAL rows: {total}")
    cur.execute("""
        SELECT pdf_file, page, work_order, engineer_initials, billing, date_sent
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
    log(f"📥 Input PDF: {PDF_INPUT_PATH}")
    log(f"🗄️  Output DB: {OUTPUT_DB_PATH}")

    if not PDF_INPUT_PATH.exists():
        raise FileNotFoundError(f"Input PDF not found: {PDF_INPUT_PATH}")

    # Ensure DB exists and schema is ready
    init_output_db(OUTPUT_DB_PATH)

    # Process the single PDF (pages are already 1..N in order)
    process_pdf(PDF_INPUT_PATH)

    # Final summary + flush WAL
    dump_summary(OUTPUT_DB_PATH)
    checkpoint_wal(OUTPUT_DB_PATH)
    log("🎉 All done. Rows are stored with (page, work_order, engineer_initials, billing, date_sent).")

if __name__ == "__main__":
    main()
