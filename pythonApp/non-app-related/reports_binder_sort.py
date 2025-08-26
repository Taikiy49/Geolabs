# reports_binder_sort.py
import argparse
import csv
import re
import sqlite3
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Defaults
DEFAULT_DB = Path("../uploads/reports_binder.db").resolve()
DEFAULT_SORT = "page_label_num,date,work_order"  # numeric page_label first

DIGITS_RE = re.compile(r"(\d{1,9})")

def log(msg: str) -> None:
    print(msg, flush=True)

# ---------- Helpers ----------
def to_int_label(val: Any) -> Optional[int]:
    """Extract first number from page_label-like text; return int or None."""
    if val is None:
        return None
    s = str(val).strip()
    m = DIGITS_RE.search(s)
    return int(m.group(1)) if m else None

def parse_date(val: Any) -> Optional[datetime]:
    """Parse common date formats → datetime (00:00). None if not parseable/empty."""
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    fmts = [
        "%Y-%m-%d",
        "%m/%d/%Y", "%m/%d/%y",
        "%m-%d-%Y", "%m-%d-%y",
        "%d %b %Y", "%d-%b-%Y",
        "%Y.%m.%d", "%m.%d.%Y",
    ]
    for f in fmts:
        try:
            return datetime.strptime(s, f)
        except Exception:
            pass
    s2 = s.replace(".", "/").replace("\\", "/").replace(",", " ")
    for f in fmts:
        try:
            return datetime.strptime(s2, f)
        except Exception:
            pass
    return None

def sort_key_factory(order_fields: List[str]):
    """
    Build a tuple key function from order_fields.
    Supported keys:
      - page_label_num (numeric, None→+inf)
      - date (chronological, None→+inf)
      - date_sent (chronological, None→+inf)
      - work_order, billing, engineer_initials, pdf_file (casefold string)
      - id (numeric)
    """
    def key(row: Dict[str, Any]):
        parts: List[Any] = []
        for f in order_fields:
            f = f.strip().lower()
            if f == "page_label_num":
                n = to_int_label(row.get("page_label"))
                parts.append((1, float("inf")) if n is None else (0, n))
            elif f == "date":
                d = parse_date(row.get("date"))
                parts.append((1, datetime.max) if d is None else (0, d))
            elif f == "date_sent":
                d = parse_date(row.get("date_sent"))
                parts.append((1, datetime.max) if d is None else (0, d))
            elif f in ("work_order", "billing", "engineer_initials", "pdf_file"):
                s = row.get(f) or ""
                parts.append(s.casefold())
            elif f == "id":
                try:
                    parts.append(int(row.get("id")))
                except Exception:
                    parts.append(10**18)
            else:
                s = str(row.get(f, "") or "")
                parts.append(s.casefold())
        return tuple(parts)
    return key

def table_exists(con: sqlite3.Connection, name: str) -> bool:
    cur = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (name,))
    return cur.fetchone() is not None

def get_table_schema_sql(con: sqlite3.Connection, name: str) -> str:
    cur = con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;", (name,))
    row = cur.fetchone()
    if not row or not row[0]:
        raise RuntimeError(f"Could not fetch schema for table '{name}'.")
    return row[0]

def recreate_indexes(con: sqlite3.Connection) -> None:
    con.execute("CREATE INDEX IF NOT EXISTS idx_reports_wo ON reports(work_order);")
    con.execute("CREATE INDEX IF NOT EXISTS idx_reports_pdf_label ON reports(pdf_file, page_label);")

def fetch_all_reports(con: sqlite3.Connection) -> List[Dict[str, Any]]:
    cur = con.execute("PRAGMA table_info(reports);")
    cols = [r[1] for r in cur.fetchall()]
    cur = con.execute("SELECT * FROM reports;")
    rows = cur.fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({cols[i]: r[i] for i in range(len(cols))})
    return out

def write_sorted_table(con: sqlite3.Connection, rows: List[Dict[str, Any]], preserve_ids: bool = True) -> str:
    """
    Create backup of 'reports', rebuild 'reports' sorted, insert rows, recreate indexes.
    Returns backup table name.
    """
    if not table_exists(con, "reports"):
        raise RuntimeError("Table 'reports' not found.")

    backup_name = f"reports_backup_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    con.execute(f"ALTER TABLE reports RENAME TO {backup_name};")

    create_sql = get_table_schema_sql(con, backup_name).replace(backup_name, "reports")
    con.execute(create_sql)

    cur = con.execute("PRAGMA table_info(reports);")
    columns = [r[1] for r in cur.fetchall()]

    insert_cols = deepcopy(columns)
    if not preserve_ids and "id" in insert_cols:
        insert_cols.remove("id")

    placeholders = ",".join([f":{c}" for c in insert_cols])
    insert_sql = f"INSERT INTO reports ({','.join(insert_cols)}) VALUES ({placeholders})"

    def prep_row(r: Dict[str, Any]) -> Dict[str, Any]:
        return {k: r.get(k) for k in insert_cols}

    con.executemany(insert_sql, [prep_row(r) for r in rows])
    recreate_indexes(con)
    return backup_name

def export_csv(rows: List[Dict[str, Any]], path: Path) -> None:
    if not rows:
        path.write_text("")
        return
    cols = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser(description="Sort the 'reports' table in reports_binder.db with a safe backup.")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="Path to SQLite DB (default: ../uploads/reports_binder.db)")
    ap.add_argument("--sort", default=DEFAULT_SORT,
                    help="Comma-separated sort keys (default: page_label_num,date,work_order). "
                         "Supported: page_label_num,date,date_sent,work_order,billing,engineer_initials,pdf_file,id")
    ap.add_argument("--dry-run", action="store_true",
                    help="Do not write anything. Just print summary and first/last 10 page labels.")
    ap.add_argument("--csv", default="", help="Optional path to export sorted results as CSV (no DB changes).")
    ap.add_argument("--no-backup", dest="no_backup", action="store_true",
                    help="(Unsafe) Replace table without keeping a backup. Not recommended.")
    ap.add_argument("--no-preserve-ids", dest="no_preserve_ids", action="store_true",
                    help="Rebuild 'reports' with new autoincrement IDs instead of preserving existing IDs.")
    args = ap.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise SystemExit(f"ERROR: DB not found: {db_path}")

    order_fields = [s.strip() for s in args.sort.split(",") if s.strip()]
    key_fn = sort_key_factory(order_fields)

    with sqlite3.connect(str(db_path)) as con:
        con.isolation_level = None
        con.execute("PRAGMA foreign_keys=OFF;")
        con.execute("BEGIN;")
        try:
            if not table_exists(con, "reports"):
                raise RuntimeError("Table 'reports' not found.")

            rows = fetch_all_reports(con)
            if not rows:
                log("No rows found in 'reports'. Nothing to sort.")
                con.execute("COMMIT;")
                return

            rows_sorted = sorted(rows, key=key_fn)

            def label_of(r):
                n = to_int_label(r.get("page_label"))
                return n if n is not None else "∅"
            labels = [label_of(r) for r in rows_sorted]
            log(f"Total rows: {len(rows_sorted)}")
            log(f"Sorted by: {', '.join(order_fields)}")
            log(f"Preview (first 10): {labels[:10]}")
            log(f"Preview (last 10):  {labels[-10:]}")

            if args.csv:
                export_csv(rows_sorted, Path(args.csv).resolve())
                log(f"CSV exported to {Path(args.csv).resolve()}")
                if args.dry_run:
                    con.execute("ROLLBACK;")
                    return

            if args.dry_run:
                log("Dry-run complete; no DB changes made.")
                con.execute("ROLLBACK;")
                return

            if args.no_backup:
                # Unsafe: drop & recreate in place
                schema_sql = get_table_schema_sql(con, "reports")
                con.execute("DROP TABLE reports;")
                con.execute(schema_sql)
                cur = con.execute("PRAGMA table_info(reports);")
                cols = [r[1] for r in cur.fetchall()]
                insert_cols = cols if not args.no_preserve_ids else [c for c in cols if c != "id"]
                placeholders = ",".join([f":{c}" for c in insert_cols])
                insert_sql = f"INSERT INTO reports ({','.join(insert_cols)}) VALUES ({placeholders})"
                def prep_row(r): return {k: r.get(k) for k in insert_cols}
                con.executemany(insert_sql, [prep_row(r) for r in rows_sorted])
                recreate_indexes(con)
                log("Rebuilt 'reports' without backup (unsafe).")
            else:
                backup_name = write_sorted_table(con, rows_sorted, preserve_ids=not args.no_preserve_ids)
                log(f"Backup created: {backup_name}")
                log("Rebuilt 'reports' table in sorted order.")

            con.execute("COMMIT;")
            log("✅ Done.")
        except Exception:
            con.execute("ROLLBACK;")
            raise

if __name__ == "__main__":
    main()
