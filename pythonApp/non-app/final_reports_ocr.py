# final_reports_ocr.py
import os
import sqlite3
import fitz  # PyMuPDF
from PIL import Image
import io
import google.generativeai as genai
from datetime import datetime

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

PDF_PATH = os.path.join(UPLOADS_DIR, "FINAL_REPORTS.PDF")
DB_PATH = os.path.join(UPLOADS_DIR, "reports_binder.db")

# Gemini setup
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_NAME = "gemini-2.5-pro"

PROMPT = """
You are an expert at reading photographed tabular report logs.

From the given image of a table page, extract ONLY these columns for each row:
- work_order
- engineer_initials
- billing
- date_sent

If billing or date_sent are missing, leave blank. 
Return STRICT JSON: [{"work_order": "...", "engineer_initials": "...", "billing": "...", "date_sent": "..."}]
"""

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
    DROP TABLE IF EXISTS reports;
    CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_file TEXT,
        page INTEGER,
        work_order TEXT,
        engineer_initials TEXT,
        billing TEXT,
        date_sent TEXT
    );
    """)
    conn.commit()
    return conn

def ocr_page_with_gemini(page_img: Image.Image):
    buf = io.BytesIO()
    page_img.save(buf, format="PNG")
    buf.seek(0)

    result = genai.GenerativeModel(MODEL_NAME).generate_content(
        [PROMPT, {"mime_type": "image/png", "data": buf.read()}]
    )

    try:
        return eval(result.text)  # convert JSON string → list of dicts
    except Exception:
        return []

def main():
    doc = fitz.open(PDF_PATH)
    conn = init_db()
    cur = conn.cursor()

    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=220)
        img = Image.open(io.BytesIO(pix.tobytes("png")))

        rows = ocr_page_with_gemini(img)
        for row in rows:
            cur.execute("""
                INSERT INTO reports (pdf_file, page, work_order, engineer_initials, billing, date_sent)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                os.path.basename(PDF_PATH),
                i,
                row.get("work_order", "").strip(),
                row.get("engineer_initials", "").strip(),
                str(row.get("billing", "")).replace(".0", ""),
                row.get("date_sent", "").replace(" 00:00:00", ""),
            ))
        conn.commit()
        print(f"✅ Processed page {i}/{len(doc)}")

    conn.close()
    print(f"🎉 Finished: data saved into {DB_PATH}")

if __name__ == "__main__":
    main()
