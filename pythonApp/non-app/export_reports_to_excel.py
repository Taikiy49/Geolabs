# export_reports_to_excel.py
import os
import sqlite3
import argparse
from pathlib import Path
from typing import List, Tuple

import xlsxwriter

# Defaults (match your project layout)
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB = (BASE_DIR / "../uploads/reports_binder.db").resolve()
DEFAULT_XLSX = (BASE_DIR / "../uploads/reports_binder.xlsx").resolve()
SHEET_NAME = "Reports"

# Columns to export (and order)
COLUMNS: List[Tuple[str, str]] = [
    ("id", "INTEGER"),
    ("pdf_file", "TEXT"),
    ("page", "INTEGER"),
    ("work_order", "TEXT"),
    ("engineer_initials", "TEXT"),
    ("billing", "TEXT"),
    ("date_sent", "TEXT"),  # stored as ISO text YYYY-MM-DD in your pipeline
]


def fetch_rows(db_path: Path):
    """
    Pull rows from SQLite, sorted by:
      - date_sent DESC (NULLS LAST)
      - pdf_file ASC
      - page ASC
    """
    order_sql = """
      ORDER BY 
        (date_sent IS NULL) ASC,  -- FALSE (0) first => non-NULL first
        date_sent DESC,
        pdf_file ASC,
        page ASC
    """
    cols_csv = ", ".join([c for c, _ in COLUMNS])
    with sqlite3.connect(str(db_path)) as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {cols_csv} FROM reports {order_sql};")
        rows = cur.fetchall()
    return rows


def autosize_widths(rows, min_w=10, max_w=50, padding=2):
    """
    Compute column widths based on max text length in each column.
    """
    # Start from header lengths
    widths = [len(col) for col, _ in COLUMNS]
    for r in rows:
        for i, val in enumerate(r):
            s = "" if val is None else str(val)
            widths[i] = max(widths[i], len(s))
    # clamp + padding
    return [max(min_w, min(max_w, w + padding)) for w in widths]


def write_excel(xlsx_path: Path, rows):
    workbook = xlsxwriter.Workbook(str(xlsx_path))
    ws = workbook.add_worksheet(SHEET_NAME)

    # Formats
    header_fmt = workbook.add_format({
        "bold": True,
        "bg_color": "#EFEFEF",
        "border": 1,
        "bottom": 1,
        "align": "left",
        "valign": "vcenter",
    })
    text_fmt = workbook.add_format({"valign": "vcenter"})
    int_fmt = workbook.add_format({"valign": "vcenter"})
    date_fmt = workbook.add_format({"num_format": "yyyy-mm-dd", "valign": "vcenter"})
    zebra_fmt = workbook.add_format({"bg_color": "#FAFAFA"})
    zebra_date_fmt = workbook.add_format({"bg_color": "#FAFAFA", "num_format": "yyyy-mm-dd"})
    zebra_int_fmt = workbook.add_format({"bg_color": "#FAFAFA"})

    # Write header
    for col_idx, (name, _typ) in enumerate(COLUMNS):
        ws.write(0, col_idx, name, header_fmt)

    # Data rows
    for row_idx, row in enumerate(rows, start=1):
        is_zebra = (row_idx % 2 == 0)
        for col_idx, (col_name, col_type) in enumerate(COLUMNS):
            val = row[col_idx]
            # Choose a format per type + zebra
            if col_type == "INTEGER":
                fmt = zebra_int_fmt if is_zebra else int_fmt
                # Write as number when possible
                try:
                    if val is None or val == "":
                        ws.write_blank(row_idx, col_idx, None, fmt)
                    else:
                        ws.write_number(row_idx, col_idx, int(val), fmt)
                except Exception:
                    ws.write(row_idx, col_idx, str(val) if val is not None else "", fmt)
            elif col_name == "date_sent":
                fmt = zebra_date_fmt if is_zebra else date_fmt
                # xlsxwriter expects Excel serial dates for date cells; since we have ISO strings,
                # simplest is to write as text with date format for visual consistency.
                # If you want true Excel dates, parse to (y, m, d) and use write_datetime.
                if val and isinstance(val, str) and len(val) == 10 and val[4] == "-" and val[7] == "-":
                    # Attempt to split YYYY-MM-DD
                    y, m, d = val.split("-")
                    try:
                        import datetime as _dt
                        dt = _dt.datetime(int(y), int(m), int(d))
                        ws.write_datetime(row_idx, col_idx, dt, fmt)
                    except Exception:
                        ws.write(row_idx, col_idx, val, fmt)
                else:
                    ws.write(row_idx, col_idx, "" if val is None else str(val), fmt)
            else:
                fmt = zebra_fmt if is_zebra else text_fmt
                ws.write(row_idx, col_idx, "" if val is None else str(val), fmt)

    # Auto column widths
    widths = autosize_widths(rows)
    for i, w in enumerate(widths):
        ws.set_column(i, i, w)

    # Freeze header row
    ws.freeze_panes(1, 0)

    # Autofilter the header row
    ws.autofilter(0, 0, max(1, len(rows)), len(COLUMNS) - 1)

    # Add a top title row (optional)
    # If you want a separate title, uncomment below:
    # title_fmt = workbook.add_format({"bold": True, "font_size": 14})
    # ws.merge_range(0, 0, 0, len(COLUMNS)-1, "Reports Export", title_fmt)

    # Nice print settings
    ws.fit_to_pages(1, 0)  # fit to 1 page wide when printing
    ws.set_landscape()

    workbook.close()


def main():
    parser = argparse.ArgumentParser(description="Export reports_binder.db to a nicely formatted Excel file.")
    parser.add_argument("--db", type=str, default=str(DEFAULT_DB), help="Path to reports_binder.db")
    parser.add_argument("--out", type=str, default=str(DEFAULT_XLSX), help="Path for output .xlsx")
    args = parser.parse_args()

    db_path = Path(args.db)
    xlsx_path = Path(args.out)

    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    rows = fetch_rows(db_path)
    # Ensure output directory exists
    xlsx_path.parent.mkdir(parents=True, exist_ok=True)
    write_excel(xlsx_path, rows)

    print(f"✅ Exported {len(rows)} rows to {xlsx_path}")


if __name__ == "__main__":
    main()
