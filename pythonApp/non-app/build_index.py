#!/usr/bin/env python3
"""
Incremental index builder for reports_fts.db from S3 OCRed_reports/*.txt.

- First run: builds DB from scratch.
- Subsequent runs: only processes new or changed .txt files.
- Prints live updates on each file processed.
"""

import os
import sqlite3
import boto3
from botocore.config import Config

# ------------------ Config ------------------
DB_PATH = os.path.join("uploads", "reports_fts.db")
BUCKET  = os.getenv("REPORTS_BUCKET", "geolabs-s3-bucket")
PREFIX  = os.getenv("OCR_PREFIX", "OCRed_reports/")
AWS_REGION = os.getenv("AWS_REGION") or "us-east-1"

BATCH_SIZE = 200  # commit every N files for performance

# ------------------ DB Setup ------------------
def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Metadata table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS docs_meta (
            key TEXT PRIMARY KEY,
            name TEXT,
            project TEXT,
            last_modified TEXT
        )
    """)

    # Full-text index
    cur.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
            key UNINDEXED,
            text,
            tokenize="porter"
        )
    """)

    conn.commit()
    return conn

def infer_project(key: str) -> str:
    # OCRed_reports/<project>/.../<file>.pdf
    parts = key.split("/")
    return parts[1] if len(parts) > 1 else ""

# ------------------ Main Builder ------------------
def build():
    s3 = boto3.client("s3", config=Config(region_name=AWS_REGION))
    paginator = s3.get_paginator("list_objects_v2")

    conn = init_db()
    cur = conn.cursor()

    processed = 0
    skipped = 0
    updated = 0

    print(f"🔍 Scanning bucket {BUCKET}/{PREFIX} ...")

    for page in paginator.paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.lower().endswith(".txt"):
                continue

            pdf_key = key[:-4] + ".pdf"
            name = os.path.basename(pdf_key)
            project = infer_project(key)
            last_modified = obj["LastModified"].isoformat()

            # check if already in DB
            existing = cur.execute(
                "SELECT last_modified FROM docs_meta WHERE key=?",
                (pdf_key,),
            ).fetchone()

            if existing and existing[0] == last_modified:
                skipped += 1
                processed += 1
                print(f"⏩ Skipped {pdf_key} (no changes)  | Total={processed}, Updated={updated}, Skipped={skipped}")
                continue

            # fetch text content
            try:
                body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
                text = body.decode("utf-8", errors="ignore")
            except Exception as e:
                print(f"⚠️ Skipping {key} (failed to download/parse): {e}")
                continue

            # upsert meta
            cur.execute(
                "INSERT OR REPLACE INTO docs_meta (key, name, project, last_modified) VALUES (?,?,?,?)",
                (pdf_key, name, project, last_modified),
            )
            # replace in FTS
            cur.execute("DELETE FROM docs_fts WHERE key=?", (pdf_key,))
            cur.execute("INSERT INTO docs_fts (key, text) VALUES (?, ?)", (pdf_key, text))

            updated += 1
            processed += 1
            print(f"✅ Indexed {pdf_key} (project={project})  | Total={processed}, Updated={updated}, Skipped={skipped}")

            if processed % BATCH_SIZE == 0:
                conn.commit()
                print(f"💾 Committed batch of {BATCH_SIZE} files (so far Updated={updated}, Skipped={skipped})")

    conn.commit()
    conn.close()
    print(f"🎉 Done. Updated={updated}, Skipped={skipped}, Total processed={processed}. DB at {DB_PATH}")

if __name__ == "__main__":
    build()
