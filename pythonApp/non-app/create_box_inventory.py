# create_box_inventory.py
import os
import sqlite3
import pandas as pd
import numpy as np

# ============== CONFIG ==============
XLSX_FILE = "Maui Core Box Inventory.xlsx"     # your workbook
ISLAND     = "Maui"                             # constant tag for this file
DB_DIR     = "uploads"
DB_PATH    = os.path.join(DB_DIR, "core_box_inventory.db")
TABLE      = "core_boxes"

# Rebuild table every run (recommended to avoid build-up)
WRITE_MODE = "replace"   # 'replace' or 'append'
# ====================================

# Tokens we treat as “bad/missing dates” (case-insensitive)
BAD_DATE_STRINGS = {
    "", "?", "??", "n/a", "na", "nan", "-", "—",
    "#ref", "#ref!", "#name?", "#value!", "#null!"
}

# Column name normalization
LOWER_MAP = {
    "w.o. number": "work_order",
    "wo number": "work_order",
    "w.o number": "work_order",
    "w.o.": "work_order",
    "w o number": "work_order",
    "w.o": "work_order",

    "project": "project",
    "engineer": "engineer",

    "report submission date": "report_submission_date",
    "report submitted": "report_submission_date",

    "2 month storage date": "two_month_storage_date",
    "two month storage date": "two_month_storage_date",
    "storage expiry date": "storage_expiry_date",

    "construction complete?": "complete",
    "complete?": "complete",
    "complete": "complete",

    "keep or dump": "keep_or_dump",
    "disposition": "keep_or_dump",
}

FINAL_COLS = [
    "year",
    "island",
    "work_order",
    "project",
    "engineer",
    "report_submission_date",
    "storage_expiry_date",
    "complete",
    "keep_or_dump",
]

def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename messy column headers to our standard ones."""
    ren = {}
    for c in df.columns:
        key = str(c).strip().lower()
        if key in LOWER_MAP:
            ren[c] = LOWER_MAP[key]
    return df.rename(columns=ren)

def is_na_like(v) -> bool:
    """Generic NA check for weird inputs."""
    if v is None:
        return True
    try:
        if pd.isna(v):
            return True
    except Exception:
        pass
    s = str(v).strip().lower()
    return s in BAD_DATE_STRINGS

def to_date(v):
    """
    Robust date parsing:
    - treat Excel error strings (e.g., '#REF!') & placeholders as missing
    - coerce to datetime
    - drop sentinel/placeholder dates (<= 1950-01-01, e.g., 1900-03-31)
    """
    if is_na_like(v):
        return pd.NaT
    s = str(v).strip()
    d = pd.to_datetime(s, errors="coerce")
    if pd.isna(d):
        return pd.NaT
    if d.year <= 1950:
        return pd.NaT
    return d

def clean_text(v):
    if is_na_like(v):
        return None
    s = str(v).strip()
    return s if s else None

def has_work_order(v) -> bool:
    return not is_na_like(v) and str(v).strip() != ""

# ------------- Load & union all sheets -------------
print(f"📥 Reading workbook: {XLSX_FILE}")
xls = pd.ExcelFile(XLSX_FILE)
frames = []

for sheet in xls.sheet_names:
    df = xls.parse(sheet)
    if df.empty or len(df.columns) == 0:
        continue
    df = normalize_columns(df)

    # Ensure columns exist
    for c in [
        "work_order", "project", "engineer",
        "report_submission_date", "two_month_storage_date",
        "storage_expiry_date", "complete", "keep_or_dump"
    ]:
        if c not in df.columns:
            df[c] = np.nan

    # Parse submission / expiry
    sub = df["report_submission_date"].apply(to_date)

    # Provided expiry: prefer explicit "storage_expiry_date" if present, else "two_month_storage_date"
    exp_from_sheet = df["storage_expiry_date"].apply(to_date) if "storage_expiry_date" in df.columns else pd.Series([pd.NaT]*len(df))
    exp_2mo        = df["two_month_storage_date"].apply(to_date)
    expiry = exp_from_sheet.copy()
    expiry = expiry.fillna(exp_2mo)

    # If still missing, compute from submission (+3 months)
    compute_mask = expiry.isna() & sub.notna()
    expiry.loc[compute_mask] = sub.loc[compute_mask] + pd.DateOffset(months=3)

    out = pd.DataFrame({
        "year": sub.dt.year.where(sub.notna(), expiry.dt.year),  # use submission year, else expiry year
        "island": ISLAND,
        "work_order": df["work_order"].apply(clean_text),
        "project": df["project"].apply(clean_text),
        "engineer": df["engineer"].apply(clean_text),
        "report_submission_date": sub,
        "storage_expiry_date": expiry,
        "complete": df["complete"].apply(clean_text),
        "keep_or_dump": df["keep_or_dump"].apply(clean_text),
    })

    # Keep ONLY rows that actually have a Work Order
    out = out[out["work_order"].apply(has_work_order)]

    # Drop rows that are totally empty otherwise (rare)
    out = out[~(out["project"].isna() & out["engineer"].isna() & out["report_submission_date"].isna() & out["storage_expiry_date"].isna())]

    frames.append(out)

if not frames:
    raise SystemExit("❌ No usable sheets found.")

df_all = pd.concat(frames, ignore_index=True)

# ------------- Pick one row per Work Order (most recent) -------------
# "Row date" = most recent of submission/expiry; rows with any date beat rows with no dates
row_date = pd.concat(
    [df_all["report_submission_date"], df_all["storage_expiry_date"]],
    axis=1
).max(axis=1)  # max handles NaT: returns the valid one if any; NaT if both NaT

df_all["__row_date"] = row_date
df_all["__has_date"] = df_all["__row_date"].notna()

# Optional tie-breaker: prefer Dump over Keep over Save when dates tie
keep_rank_map = {"dump": 3, "keep": 2, "save": 1}
df_all["__keep_rank"] = df_all["keep_or_dump"].str.strip().str.lower().map(keep_rank_map).fillna(0)

# Sort: has_date(desc), row_date(desc), keep_rank(desc) then drop duplicates by work_order
df_all_sorted = df_all.sort_values(
    by=["__has_date", "__row_date", "__keep_rank"],
    ascending=[False, False, False],
    kind="mergesort"  # stable
)

best_per_wo = df_all_sorted.drop_duplicates(subset=["work_order"], keep="first").copy()

# Recompute year deterministically: prefer submission year else expiry year
best_per_wo["year"] = np.where(
    best_per_wo["report_submission_date"].notna(),
    best_per_wo["report_submission_date"].dt.year,
    best_per_wo["storage_expiry_date"].dt.year
)

# ------------- Final formatting -------------
for dc in ["report_submission_date", "storage_expiry_date"]:
    best_per_wo[dc] = best_per_wo[dc].dt.strftime("%Y-%m-%d")

final_df = best_per_wo[FINAL_COLS].copy()

# ------------- Write to SQLite -------------
os.makedirs(DB_DIR, exist_ok=True)
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute(f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER,
    island TEXT CHECK(island IN ('Hawaii', 'Maui')),
    work_order TEXT,
    project TEXT,
    engineer TEXT,
    report_submission_date TEXT,
    storage_expiry_date TEXT,
    complete TEXT,
    keep_or_dump TEXT
)
""")

# Rebuild table by default
if WRITE_MODE == "replace":
    cur.execute(f"DELETE FROM {TABLE}")

final_df.to_sql(TABLE, conn, if_exists="append", index=False)

# Helpful indexes (and uniqueness on work_order for safety)
cur.executescript(f"""
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_work_order ON {TABLE}(work_order);
CREATE INDEX IF NOT EXISTS idx_core_year      ON {TABLE}(year);
CREATE INDEX IF NOT EXISTS idx_core_island    ON {TABLE}(island);
CREATE INDEX IF NOT EXISTS idx_core_submitted ON {TABLE}(report_submission_date);
CREATE INDEX IF NOT EXISTS idx_core_expiry    ON {TABLE}(storage_expiry_date);
""")

conn.commit()
conn.close()

print(f"✅ Sheets loaded: {xls.sheet_names}")
print(f"✅ Final rows (unique by work_order): {len(final_df)}")
print(f"✅ Wrote to {DB_PATH}:{TABLE}")
