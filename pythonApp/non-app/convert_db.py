#!/usr/bin/env python3
"""
convert_db.py
Reads 'file_audit.xlsx' and populates the SQLite DB used by the Flask API.

Changes vs your original:
- Writes to uploads/file_audit.db (same file the API reads) unless FILE_AUDIT_DB is set
- Creates the table with an 'id INTEGER PRIMARY KEY AUTOINCREMENT'
- Includes status/last_updated/notes columns expected by the API
"""

import os
import sys
import sqlite3
from pathlib import Path
from typing import List, Tuple

import numpy as np
import pandas as pd
from datetime import datetime, timezone

TARGET_SEQ = ["file folder", "location", "engr"]
XLSX_NAME = "file_audit.xlsx"
TABLE_NAME = "file_audit"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def norm_header(x) -> str:
    return str(x).strip().lower().replace("\n", " ").replace("\r", " ")

def find_blocks(columns: List[str]) -> List[Tuple[int, int]]:
    """Return list of (start_idx, end_idx) for each repeating FILE/LOCATION/ENGR block."""
    cols_norm = [norm_header(c).split(".")[0] for c in columns]  # 'Location.1' -> 'location'
    blocks = []
    i = 0
    while i <= len(cols_norm) - 3:
        trip = cols_norm[i:i+3]
        if trip == TARGET_SEQ:
            blocks.append((i, i+3))  # end is exclusive
            i += 3
        else:
            i += 1
    return blocks

def clean_frame(df: pd.DataFrame) -> pd.DataFrame:
    # Strip whitespace; turn empty strings into NaN
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].astype(str).str.strip()
            df[c] = df[c].replace({"": np.nan, "nan": np.nan})
    # Drop rows where all three are NaN
    df = df.dropna(how="all", subset=["FILE FOLDER", "LOCATION", "ENGR"])
    # Fill NaN with empty string for SQLite insert
    return df.fillna("")

def resolve_output_db() -> Path:
    """
    Priority:
      1) FILE_AUDIT_DB env var (absolute or relative)
      2) <project_root>/uploads/file_audit.db
    Project root is inferred as two levels up from this file if placed in project tree,
    else we fall back to cwd/uploads.
    """
    env_path = os.environ.get("FILE_AUDIT_DB")
    if env_path:
        return Path(env_path).expanduser().resolve()

    # Try to infer project root: script_dir/.. (if script is at project root) or script_dir/../..
    here = Path(__file__).resolve().parent
    candidates = [
        here / "uploads" / "file_audit.db",
        here.parent / "uploads" / "file_audit.db",
        here.parent.parent / "uploads" / "file_audit.db",
        Path.cwd() / "uploads" / "file_audit.db",
    ]
    for p in candidates:
        p.parent.mkdir(parents=True, exist_ok=True)
        return p.resolve()

def load_excel(xlsx_path: Path) -> pd.DataFrame:
    xl = pd.ExcelFile(xlsx_path)
    all_frames = []

    for sheet in xl.sheet_names:
        raw = xl.parse(sheet, dtype=object)
        cols = list(raw.columns)
        blocks = find_blocks(cols)
        if not blocks:
            cols_norm = [norm_header(c).split(".")[0] for c in cols]
            try_trip = []
            for need in TARGET_SEQ:
                try:
                    idx = cols_norm.index(need)
                    try_trip.append(idx)
                except ValueError:
                    try_trip.append(None)
            if any(i is not None for i in try_trip):
                sub = pd.DataFrame()
                sub["FILE FOLDER"] = raw.iloc[:, try_trip[0]] if try_trip[0] is not None else pd.Series([None]*len(raw))
                sub["LOCATION"]    = raw.iloc[:, try_trip[1]] if try_trip[1] is not None else pd.Series([None]*len(raw))
                sub["ENGR"]        = raw.iloc[:, try_trip[2]] if try_trip[2] is not None else pd.Series([None]*len(raw))
                sub = clean_frame(sub)
                if len(sub):
                    all_frames.append(sub)
            continue

        # slice each 3-col block
        for (s, e) in blocks:
            trip = raw.iloc[:, s:e].copy()
            trip.columns = ["FILE FOLDER", "LOCATION", "ENGR"]
            trip = clean_frame(trip)
            if len(trip):
                all_frames.append(trip)

    if not all_frames:
        print("ERROR: No matching columns/blocks in any sheet.")
        sys.exit(2)

    out = pd.concat(all_frames, ignore_index=True)
    return out[["FILE FOLDER", "LOCATION", "ENGR"]]

def write_sqlite(out_df: pd.DataFrame, db_path: Path):
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        # Create table with expected schema (id + extras)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS file_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                "FILE FOLDER" TEXT,
                "LOCATION"    TEXT,
                "ENGR"        TEXT,
                status        TEXT DEFAULT 'NEW',
                last_updated  TEXT,
                notes         TEXT
            );
        """)

        # Clear existing data (we’re replacing with the new import)
        cur.execute("DELETE FROM file_audit;")

        # Prepare rows to insert with defaults
        rows = []
        ts = now_iso()
        for _, r in out_df.iterrows():
            rows.append((
                str(r.get("FILE FOLDER", "") or "").strip(),
                str(r.get("LOCATION", "") or "").strip(),
                str(r.get("ENGR", "") or "").strip(),
                "NEW",          # status
                ts,             # last_updated
                ""              # notes
            ))

        cur.executemany("""
            INSERT INTO file_audit ("FILE FOLDER","LOCATION","ENGR",status,last_updated,notes)
            VALUES (?,?,?,?,?,?)
        """, rows)

        # Build/refresh the API view
        cur.execute("DROP VIEW IF EXISTS file_audit_api")
        cur.execute("""
            CREATE VIEW file_audit_api AS
            SELECT
              id,
              "FILE FOLDER" AS file_folder,
              "LOCATION"    AS location,
              "ENGR"        AS engr,
              COALESCE(status, 'NEW') AS status,
              last_updated,
              notes
            FROM file_audit;
        """)

        con.commit()
    finally:
        con.close()

def main():
    here = Path(__file__).resolve().parent
    xlsx_path = here / XLSX_NAME
    if not xlsx_path.exists():
        print(f"ERROR: '{xlsx_path.name}' not found next to this script at: {xlsx_path}")
        sys.exit(1)

    out_df = load_excel(xlsx_path)
    db_path = resolve_output_db()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    write_sqlite(out_df, db_path)

    print(f"OK: wrote {len(out_df)} rows to '{db_path}' (table: {TABLE_NAME})")
    print("Tip: Open /api/file-audit/_debug in your browser to confirm row counts.")

if __name__ == "__main__":
    main()
