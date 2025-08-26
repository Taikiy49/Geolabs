# excel_to_db.py
import sys
import re
import sqlite3
from pathlib import Path
from datetime import datetime, date
from typing import List, Dict, Any

import pandas as pd

# Accept lots of header variants (case/space agnostic)
REQUIRED_COLS = {
    "page_label": [
        "page_label", "page label", "page", "page #", "page no", "pagelabel",
        "page_labe",  # tolerate common typo / truncation
    ],
    "date": ["date", "report date"],
    "date_sent": ["date_sent", "date sent", "datesent", "sent date"],
    "work_order": ["work_order", "work order", "work order #", "workorder", "wo"],
    "engineer_initials": [
        "engineer_initials", "engineer initials",
        "engineer's initials", "engineers initials", "engineer’s initials",
        "initials"
    ],
    "billing": ["billing", "billing #", "invoice", "invoice #", "invoice number", "inv #", "inv no"],
}
# Optional columns we’ll use if present
OPTIONAL_COLS = {
    "pdf_file": ["pdf_file", "pdffile", "pdf file", "source pdf"]
}
IGNORED_COLS = {"id"}  # we never insert 'id' from Excel; DB autoincrements

# --------- header matching helpers ----------
def _canon(s: str) -> str:
    # lower, trim, collapse internal spaces, strip punctuation like # . _
    s = (s or "").strip().lower()
    s = re.sub(r"[\u2013\u2014]", "-", s)              # en/em dash -> hyphen
    s = s.replace("#", "").replace(".", "").replace("_", " ")
    s = re.sub(r"\s+", " ", s)
    return s

def find_col(df: pd.DataFrame, candidates: List[str]) -> str:
    # Build a map from canonicalized header -> original header
    canon_map = {_canon(c): c for c in df.columns}
    for cand in candidates:
        cand_c = _canon(cand)
        if cand_c in canon_map:
            return canon_map[cand_c]
    raise KeyError(f"Missing expected column. Tried: {candidates}. Found columns: {list(df.columns)}")

# --------- normalizers ----------
def norm_date(v) -> str:
    """Handle strings, pandas Timestamps, date/datetime, and Excel serial numbers."""
    if v is None or (isinstance(v, float) and pd.isna(v)) or (isinstance(v, str) and v.strip() == ""):
        return ""
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()

    ts = pd.to_datetime(v, errors="coerce")
    if pd.notna(ts):
        return ts.date().isoformat()

    ts2 = pd.to_datetime(v, errors="coerce", unit="D", origin="1899-12-30")
    if pd.notna(ts2):
        return ts2.date().isoformat()

    s = str(v).strip()
    if s.upper() in {"N/A", "NA", "NONE"}:
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

def norm_wo(s: Any) -> str:
    if pd.isna(s): return ""
    t = str(s).strip().upper().replace("–","-").replace("—","-")
    return " ".join(t.split())

def norm_initials(s: Any) -> str:
    if pd.isna(s): return ""
    t = str(s).upper().strip()
    t = re.sub(r"[^A-Z:]", "", t)
    t = re.sub(r":{2,}", ":", t).strip(":")
    parts = [p for p in t.split(":") if 1 <= len(p) <= 4 and p.isalpha()]
    return ":".join(parts)

def norm_billing(s: Any) -> str:
    if pd.isna(s): return ""
    m = re.search(r"\b(\d{5,6})\b", str(s))
    return m.group(1) if m else ""

# --------- DB ----------
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
    );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reports_pdf_label ON reports(pdf_file, page_label);")
    conn.commit()

def main():
    # Defaults so you can just run: python3 excel_to_db.py
    default_xlsx = Path(__file__).resolve().parent / "../uploads/reports_binder.xlsx"
    default_db   = Path(__file__).resolve().parent / "../uploads/reports_binder.db"

    args = sys.argv[1:]
    if not args:
        xlsx_path = default_xlsx.resolve()
        db_path   = default_db.resolve()
        derived_pdf_name  = xlsx_path.stem  # fallback if no pdf_file column present
    else:
        xlsx_path = Path(args[0]).resolve() if len(args) >= 1 else default_xlsx.resolve()
        db_path   = Path(args[1]).resolve() if len(args) >= 2 else default_db.resolve()
        derived_pdf_name  = xlsx_path.stem

    if not xlsx_path.exists():
        print(f"ERROR: Excel not found: {xlsx_path}")
        sys.exit(2)

    # Read Excel
    df = pd.read_excel(xlsx_path)
    df.columns = [str(c).strip() for c in df.columns]

    # Map required columns
    colmap: Dict[str, str] = {}
    for key, cands in REQUIRED_COLS.items():
        colmap[key] = find_col(df, cands)

    # Optional pdf_file column (overrides derived name if present and non-empty)
    pdf_file_col = None
    for c in OPTIONAL_COLS["pdf_file"]:
        try:
            pdf_file_col = find_col(df, [c])
            break
        except KeyError:
            continue

    # Log mapping summary
    print("Column mapping:")
    for k,v in colmap.items():
        print(f"  {k:18s} <- '{v}'")
    if pdf_file_col:
        print(f"  {'pdf_file':18s} <- '{pdf_file_col}'  (optional)")
    else:
        print(f"  {'pdf_file':18s} <- (derived from Excel filename '{derived_pdf_name}')")
    print()

    # Build cleaned rows
    out = []
    for _, r in df.iterrows():
        # Optional pdf_file from sheet row, else derived
        pdf_name = str(r[pdf_file_col]).strip() if (pdf_file_col and pd.notna(r[pdf_file_col]) and str(r[pdf_file_col]).strip()) else derived_pdf_name
        page_label = "" if pd.isna(r[colmap["page_label"]]) else str(r[colmap["page_label"]]).strip()

        row = {
            "pdf_file": pdf_name,
            "date": norm_date(r[colmap["date"]]),
            "work_order": norm_wo(r[colmap["work_order"]]),
            "engineer_initials": norm_initials(r[colmap["engineer_initials"]]),
            "billing": norm_billing(r[colmap["billing"]]),
            "date_sent": norm_date(r[colmap["date_sent"]]),
            "page_label": page_label,
        }
        # Ignore totally empty logical rows (except pdf_file)
        if any(v for k, v in row.items() if k != "pdf_file"):
            out.append(row)

    with sqlite3.connect(str(db_path)) as conn:
        ensure_schema(conn)
        conn.executemany("""
            INSERT INTO reports (pdf_file,date,work_order,engineer_initials,billing,date_sent,page_label)
            VALUES (:pdf_file,:date,:work_order,:engineer_initials,:billing,:date_sent,:page_label)
        """, out)
        conn.commit()

    print(f"✅ Inserted {len(out)} rows from {xlsx_path.name} into {db_path.name}")
    print(f"   Excel:  {xlsx_path}")
    print(f"   SQLite: {db_path}")

if __name__ == "__main__":
    main()
