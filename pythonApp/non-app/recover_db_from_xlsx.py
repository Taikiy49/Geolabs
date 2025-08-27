# rebuild_reports_binder.py
import pandas as pd
import sqlite3
import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "../uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

DB_PATH = os.path.join(UPLOADS_DIR, "reports_binder.db")
XLSX_PATH = os.path.join(UPLOADS_DIR, "reports_binder.xlsx")

# Load Excel
df = pd.read_excel(XLSX_PATH)

# Ensure correct columns
df = df.rename(columns={
    "id": "id",
    "pdf_file": "pdf_file",
    "page": "page",
    "work_order": "work_order",
    "engineer_initials": "engineer_initials",
    "billing": "billing",
    "date_sent": "date_sent"
})

# Clean billing → remove decimals, force string or int
df["billing"] = df["billing"].apply(
    lambda x: str(int(x)) if pd.notna(x) and str(x).strip() != "" else ""
)

# Clean date_sent → keep only YYYY-MM-DD
df["date_sent"] = pd.to_datetime(df["date_sent"], errors="coerce").dt.strftime("%Y-%m-%d")

# Create DB + schema
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
CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);
CREATE INDEX IF NOT EXISTS idx_reports_page ON reports(page);
CREATE INDEX IF NOT EXISTS idx_reports_billing ON reports(billing);
CREATE INDEX IF NOT EXISTS idx_reports_date_sent ON reports(date_sent);
""")

# Insert cleaned data
df.to_sql("reports", conn, if_exists="append", index=False)

conn.commit()
conn.close()
print(f"✅ Rebuilt {DB_PATH} from {XLSX_PATH}")
