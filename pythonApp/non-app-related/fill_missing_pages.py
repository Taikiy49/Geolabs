# fill_missing_pages.py
import os, io, re, json, time, sqlite3
from pathlib import Path
from datetime import datetime
from typing import List, Set, Tuple

import fitz  # PyMuPDF
from PIL import Image
from dotenv import load_dotenv
import google.generativeai as genai

# -------- Gemini / OCR config --------
PRIMARY_MODEL   = "gemini-2.5-pro"
FALLBACK_MODEL  = "gemini-1.5-flash"
TEMPERATURE     = 0.1
RENDER_DPI      = 220
MAX_RETRIES     = 4
BACKOFF_SECONDS = 2.0

# -------- Defaults (no CLI needed) --------
DEFAULT_PDF = Path("../uploads/missing_reports.pdf").resolve()
DEFAULT_DB = Path("../uploads/reports_binder.db").resolve()
DEFAULT_LABEL_RANGE = "1-119"   # universe to check (inclusive)

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

def log(msg: str):
    print(msg, flush=True)

# ---------- Safe Gemini helpers ----------
def _resp_has_text(resp) -> bool:
    try:
        return bool(getattr(resp, "candidates", None)
                    and resp.candidates
                    and getattr(resp.candidates[0], "content", None)
                    and getattr(resp.candidates[0].content, "parts", None)
                    and resp.candidates[0].content.parts)
    except Exception:
        return False

def _safe_text(resp) -> str:
    if hasattr(resp, "text"):
        try:
            return (resp.text or "").strip()
        except Exception:
            pass
    try:
        parts = resp.candidates[0].content.parts
        return "".join(getattr(p, "text", "") for p in parts).strip()
    except Exception:
        return ""

def _call_gemini_with_fallback(payload, *, temperature=TEMPERATURE):
    last_err = None
    for attempt in range(MAX_RETRIES):
        model_name = PRIMARY_MODEL if attempt == 0 else FALLBACK_MODEL
        try:
            model = genai.GenerativeModel(model_name)
            resp = model.generate_content(
                payload,
                generation_config={"temperature": temperature},
            )
            if _resp_has_text(resp):
                return _safe_text(resp)
        except Exception as e:
            last_err = e
            log(f"   ⚠️  {model_name} failed: {e}")
        time.sleep(BACKOFF_SECONDS * (2 ** attempt))
    raise RuntimeError(f"Gemini OCR failed after retries. Last error: {last_err}")

# ---------- Normalizers ----------
def normalize_date(val: str) -> str:
    s = (val or "").strip()
    if not s: return ""
    fmts = ["%Y-%m-%d","%m/%d/%Y","%m/%d/%y","%m-%d-%Y","%m-%d-%y","%d-%b-%Y","%d %b %Y"]
    for f in fmts:
        try: return datetime.strptime(s, f).date().isoformat()
        except Exception: pass
    s2 = s.replace(".", "/").replace(",", " ").replace("\\", "/")
    for f in fmts:
        try: return datetime.strptime(s2, f).date().isoformat()
        except Exception: pass
    return ""

def normalize_wo(wo: str) -> str:
    if not wo: return ""
    s = str(wo).strip().upper().replace("–","-").replace("—","-")
    return " ".join(s.split())

def normalize_initials(s: str) -> str:
    if not s: return ""
    s = s.upper().strip()
    s = re.sub(r"[^A-Z:]", "", s)
    s = re.sub(r":{2,}", ":", s).strip(":")
    parts = [p for p in s.split(":") if 1 <= len(p) <= 4 and p.isalpha()]
    return ":".join(parts)

def normalize_billing(s: str) -> str:
    if not s: return ""
    m = re.search(r"\b(\d{5,6})\b", str(s))
    return m.group(1) if m else ""

# ---------- JSON guard ----------
def parse_json_safely(txt: str):
    if not txt: return None
    try:
        return json.loads(txt)
    except Exception:
        pass
    a,b = txt.find("["), txt.rfind("]")
    if a!=-1 and b!=-1 and b>a:
        try: return json.loads(txt[a:b+1])
        except Exception: pass
    a,b = txt.find("{"), txt.rfind("}")
    if a!=-1 and b!=-1 and b>a:
        try: return json.loads(txt[a:b+1])
        except Exception: pass
    return None

# ---------- PDF rendering ----------
def pdf_page_to_image_list(pdf_path: str, dpi: int = RENDER_DPI):
    imgs = []
    doc = fitz.open(pdf_path)
    try:
        for page in doc:
            mat = fitz.Matrix(dpi/72.0, dpi/72.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            imgs.append(Image.open(io.BytesIO(pix.tobytes("png"))))
    finally:
        doc.close()
    return imgs

# ---------- Page label detection ----------
def _extract_label_from_text(txt: str) -> str:
    patterns = [
        r"\b(\d{1,4})\b",
        r"Page\s+(\d{1,4})",
        r"\b(\d{1,4})\s+of\s+\d{1,4}\b",
    ]
    for p in patterns:
        m = re.search(p, txt, re.IGNORECASE)
        if m:
            return str(int(m.group(1)))
    return ""

def _gemini_extract_single_number(image: Image.Image, prompt: str) -> str:
    txt = _call_gemini_with_fallback([prompt, image], temperature=0.0)
    return _extract_label_from_text(txt)

def extract_page_label(image: Image.Image) -> str:
    w,h = image.size
    crops = [
        image.crop((int(w*0.70), int(h*0.88), int(w*1.00), int(h*1.00))),
        image.crop((int(w*0.30), int(h*0.88), int(w*0.70), int(h*1.00))),
        image.crop((0, int(h*0.86), w, h)),
    ]
    prompts = [
        "Extract only the page number visible (digits). Output just the number (e.g., 93).",
        "Find the page number on this crop. Return ONLY the digits.",
    ]
    for cr in crops:
        for p in prompts:
            got = _gemini_extract_single_number(cr, p)
            if got:
                return got
    return _gemini_extract_single_number(image, "Return ONLY the page number printed on this page (digits only).")

def guess_label_from_allowed(image: Image.Image, allowed: List[str]) -> str:
    if not allowed: return ""
    allowed_str = ", ".join(allowed)
    prompt = (
        "The page label is one of the following numbers:\n"
        f"{allowed_str}\n\n"
        "Look at the image and return ONLY the correct number from that list."
    )
    txt = _call_gemini_with_fallback([prompt, image], temperature=0.0)
    cand = _extract_label_from_text(txt)
    return cand if cand in set(allowed) else ""

# ---------- DB ----------
def ensure_schema(conn: sqlite3.Connection):
    cur = conn.cursor()
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
    );""")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_pdf_label ON reports(pdf_file, page_label);")
    conn.commit()

def existing_row_keys(conn: sqlite3.Connection, pdf_file: str, page_label: str) -> Set[Tuple[str,str,str,str]]:
    """Return keys of rows that already exist for this *pdf_file* (case-insensitive) + page_label."""
    cur = conn.cursor()
    cur.execute("""
        SELECT date, work_order, billing, date_sent
        FROM reports
        WHERE lower(pdf_file)=lower(?) AND page_label=?
    """, (pdf_file, page_label))
    return set(cur.fetchall())

def get_existing_labels_global(conn: sqlite3.Connection) -> Set[str]:
    """All distinct non-empty page labels anywhere in the DB (ignores pdf_file)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT page_label
        FROM reports
        WHERE page_label IS NOT NULL AND trim(page_label) <> ''
    """)
    out = set()
    for (val,) in cur.fetchall():
        s = str(val).strip()
        if s.isdigit():
            out.add(str(int(s)))
    return out

# ---------- Ranges ----------
def parse_label_ranges(s: str) -> List[str]:
    out: List[int] = []
    seen = set()
    parts = [p.strip() for p in s.split(",") if p.strip()]
    for p in parts:
        if "-" in p:
            a,b = p.split("-",1)
            try:
                a,b = int(a), int(b)
                for x in range(min(a,b), max(a,b)+1):
                    if x not in seen:
                        out.append(x); seen.add(x)
            except ValueError:
                pass
        else:
            try:
                x = int(p)
                if x not in seen:
                    out.append(x); seen.add(x)
            except ValueError:
                pass
    return [str(x) for x in out]

def label_universe_from_str(s: str) -> List[str]:
    return parse_label_ranges(s)

# ---------- OCR ----------
def gemini_extract_rows(image: Image.Image):
    raw = _call_gemini_with_fallback([OCR_PROMPT, image], temperature=TEMPERATURE)
    data = parse_json_safely(raw)
    if not isinstance(data, list):
        raise RuntimeError(f"Unexpected OCR output. First 200 chars:\n{raw[:200]}")
    cleaned = []
    for row in data:
        cleaned.append({
            "date": normalize_date(row.get("date","")),
            "work_order": normalize_wo(row.get("work_order","")),
            "engineer_initials": normalize_initials(row.get("engineer_initials") or ""),
            "billing": normalize_billing(row.get("billing") or ""),
            "date_sent": normalize_date(row.get("date_sent","")),
        })
    return cleaned

# ---------- Main ----------
def main():
    pdf_path = DEFAULT_PDF
    db_path = DEFAULT_DB
    universe = label_universe_from_str(DEFAULT_LABEL_RANGE)

    # Preflight
    if not pdf_path.exists():
        log(f"ERROR: PDF not found: {pdf_path}")
        return
    if not db_path.exists():
        log(f"ERROR: DB not found: {db_path}")
        return

    # Gemini init
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set in .env")
    genai.configure(api_key=api_key)

    # Find missing labels *globally* in DB
    with sqlite3.connect(str(db_path)) as conn:
        ensure_schema(conn)
        have = get_existing_labels_global(conn)          # <<— global
        missing = [lab for lab in universe if lab not in have]

    log(f"📄 PDF: {pdf_path.name}")
    log(f"🗄️  DB:  {db_path.name}")
    if missing:
        log(f"🔎 Missing labels (from 1–119): {', '.join(missing)}")
    else:
        log("✅ Nothing to do. All labels present in DB already.")
        return

    # Render pages once
    images = pdf_page_to_image_list(str(pdf_path))
    target_set = set(missing)

    rows_added = 0
    with sqlite3.connect(str(db_path)) as conn:
        ensure_schema(conn)
        cur = conn.cursor()

        for i, img in enumerate(images, start=1):
            # 1) Try to read printed page label
            label = extract_page_label(img)

            # 2) If unreadable / not a missing target, try classifying among the missing targets
            if not label or label not in target_set:
                guess = guess_label_from_allowed(img, missing)
                if guess:
                    label = guess

            if not label or label not in target_set:
                log(f"• PDF page {i}: page_label='{label or '∅'}' → skip (not missing)")
                continue

            log(f"➡️  PDF page {i} is missing (label {label}); OCR…")
            try:
                # de-dup per *this* PDF (case-insensitive) + page_label
                existing = existing_row_keys(conn, pdf_path.name, label or "")
                rows = gemini_extract_rows(img)

                to_insert = []
                for r in rows:
                    key = (r["date"], r["work_order"], r["billing"], r["date_sent"])
                    if key in existing:
                        continue
                    to_insert.append({
                        "pdf_file": pdf_path.name,  # will match existing rows even if DB has .PDF (case-insensitive)
                        "date": r["date"],
                        "work_order": r["work_order"],
                        "engineer_initials": r["engineer_initials"],
                        "billing": r["billing"],
                        "date_sent": r["date_sent"],
                        "page_label": label or "",
                    })
                    existing.add(key)

                if to_insert:
                    cur.executemany("""
                        INSERT INTO reports (pdf_file,date,work_order,engineer_initials,billing,date_sent,page_label)
                        VALUES (:pdf_file,:date,:work_order,:engineer_initials,:billing,:date_sent,:page_label)
                    """, to_insert)
                    conn.commit()
                    rows_added += len(to_insert)
                    target_set.discard(label)  # we filled this label at least once
                    log(f"   ↳ saved {len(to_insert)} rows for page_label {label}")
                else:
                    log("   (no new rows; all duplicates)")
            except Exception as e:
                log(f"   ⚠️ OCR error: {e}")

    if rows_added == 0:
        log("⚠️ Completed with no new rows (possibly all duplicates or OCR returned empty).")
    else:
        log(f"✅ Done. Inserted {rows_added} rows from {pdf_path.name}.")

if __name__ == "__main__":
    main()
