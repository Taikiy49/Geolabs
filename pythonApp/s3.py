# s3.py
import os
import io
import re
import time
import json
import sqlite3
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from flask import Blueprint, jsonify, request

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
S3_BUCKET = os.getenv("S3_BUCKET", "geolabs-s3-bucket")
# Where OCR outputs live (txt + searchable pdf). Used by /api/s3/content-search
OCR_PREFIX = os.getenv("OCR_PREFIX", "OCRed_reports/")
# List presigned URL lifetime (seconds)
PRESIGN_TTL = int(os.getenv("PRESIGN_TTL", "3600"))
# Max keys to page from S3 per call (server-side); client still controls 'limit'
S3_PAGE_LIMIT = int(os.getenv("S3_PAGE_LIMIT", "1000"))

# SQLite file (same scheme as app.py)
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_FILE = os.path.join(BASE_DIR, "uploads", "chat_history.db")

# Blueprint
s3_bp = Blueprint("s3", __name__, url_prefix="/api")


# -----------------------------------------------------------------------------
# Helpers: AWS clients, region, presign
# -----------------------------------------------------------------------------
def _bucket_region(bucket: str) -> str:
    """Detect bucket's region (works for us-east-1 too)."""
    s3_global = boto3.client("s3")
    resp = s3_global.get_bucket_location(Bucket=bucket)
    loc = resp.get("LocationConstraint")
    return loc or "us-east-1"


def _make_s3(region: Optional[str] = None):
    cfg = Config(
        region_name=region or _bucket_region(S3_BUCKET),
        retries={"max_attempts": 10, "mode": "standard"},
        user_agent_extra="geolabs-s3-endpoints/1.0",
    )
    return boto3.client("s3", config=cfg)


def _presign(s3, key: str, ttl: int = PRESIGN_TTL) -> str:
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=ttl,
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ensure_uploads_dir():
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)


# -----------------------------------------------------------------------------
# Upload history (shared table created by app.init_db)
# -----------------------------------------------------------------------------
def record_upload(user: str, key: str, db_name: str = None):
    try:
        _ensure_uploads_dir()
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO upload_history (user, file, db_name, timestamp) VALUES (?, ?, ?, ?)",
                (user or "unknown", key, db_name or S3_BUCKET, _utc_now_iso()),
            )
            conn.commit()
    except Exception:
        # Non-fatal: do not break upload on history failure
        pass


@s3_bp.get("/upload-history")
def upload_history():
    try:
        _ensure_uploads_dir()
        with sqlite3.connect(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT user, file, db_name, timestamp FROM upload_history "
                "ORDER BY id DESC LIMIT 200"
            ).fetchall()
        data = [{"user": r[0], "file": r[1], "db": r[2], "time": r[3]} for r in rows]
        return jsonify(data)
    except Exception as e:
        return jsonify([]), 200


# -----------------------------------------------------------------------------
# /api/s3/files — list with client-side paging support
# -----------------------------------------------------------------------------
@s3_bp.get("/s3/files")
def list_files():
    """
    Query params:
      limit: int (<=1000 recommended)
      presign: 1|0
      token: continuation token from previous call
    Response:
      { files: [{Key, Size, LastModified, url?}], next_token?: str }
    """
    limit = int(request.args.get("limit", S3_PAGE_LIMIT))
    limit = max(1, min(limit, S3_PAGE_LIMIT))
    want_url = request.args.get("presign", "0") in ("1", "true", "yes")
    token = request.args.get("token") or None

    s3 = _make_s3()
    try:
        kwargs = {"Bucket": S3_BUCKET, "MaxKeys": limit}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)

        out = []
        for obj in (resp.get("Contents") or []):
            key = obj["Key"]
            if key.endswith("/"):
                continue  # skip folder placeholders
            item = {
                "Key": key,
                "Size": obj.get("Size"),
                "LastModified": obj.get("LastModified").isoformat() if obj.get("LastModified") else None,
            }
            if want_url:
                try:
                    item["url"] = _presign(s3, key)
                except Exception:
                    item["url"] = None
            out.append(item)

        next_token = resp.get("NextContinuationToken")
        return jsonify({"files": out, "next_token": next_token})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# /api/s3/upload — multipart upload (PDFs)
# -----------------------------------------------------------------------------
@s3_bp.post("/s3/upload")
def upload_pdf():
    """
    Form fields:
      file: (binary) a .pdf
      prefix: optional subfolder (e.g., "reports/2024")
      user: uploader email (also echoed in X-User)
    Returns:
      { key: "<final S3 key>" }
    """
    f = request.files.get("file")
    prefix = (request.form.get("prefix") or "").strip().strip("/")
    user = request.form.get("user") or request.headers.get("X-User") or "guest"

    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    fname = f.filename or "upload.pdf"
    if not fname.lower().endswith(".pdf"):
        return jsonify({"error": "Only .pdf files are allowed"}), 400

    # Normalize target key
    key = f"{prefix}/{fname}".strip("/") if prefix else fname

    s3 = _make_s3()
    try:
        bio = io.BytesIO(f.read())
        bio.seek(0)
        s3.upload_fileobj(
            bio, S3_BUCKET, key,
            ExtraArgs={"ContentType": "application/pdf"}
        )
        record_upload(user, key, S3_BUCKET)
        return jsonify({"key": key})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# /api/s3/delete — delete object
# -----------------------------------------------------------------------------
@s3_bp.post("/s3/delete")
def delete_key():
    data = request.get_json(silent=True) or {}
    key = data.get("key")
    if not key:
        return jsonify({"error": "Missing key"}), 400
    s3 = _make_s3()
    try:
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        return jsonify({"ok": True})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# /api/s3/move — move/rename (copy + delete)
# -----------------------------------------------------------------------------
@s3_bp.post("/s3/move")
def move_key():
    data = request.get_json(silent=True) or {}
    src = data.get("src_key")
    dst = data.get("dst_key")
    if not src or not dst:
        return jsonify({"error": "Missing src_key or dst_key"}), 400
    if src == dst:
        return jsonify({"ok": True, "note": "No-op"}), 200

    s3 = _make_s3()
    try:
        s3.copy_object(
            Bucket=S3_BUCKET,
            CopySource={"Bucket": S3_BUCKET, "Key": src},
            Key=dst,
            MetadataDirective="COPY",
        )
        s3.delete_object(Bucket=S3_BUCKET, Key=src)
        return jsonify({"ok": True})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# /api/s3/search — filename/key contains search
# -----------------------------------------------------------------------------
@s3_bp.get("/s3/search")
def key_search():
    """
    Query params: q, limit (default 50), presign (0|1)
    Returns: { files: [{Key, url?}], next_token?: str }
    NOTE: 'contains' search done on the server by scanning pages (best-effort).
    """
    q = (request.args.get("q") or "").strip()
    limit = int(request.args.get("limit", "50"))
    want_url = request.args.get("presign", "0") in ("1", "true", "yes")

    if not q:
        return jsonify({"files": []})

    s3 = _make_s3()
    qlow = q.lower()
    found: List[Dict[str, Any]] = []

    try:
        token = None
        while True:
            kwargs = {"Bucket": S3_BUCKET, "MaxKeys": S3_PAGE_LIMIT}
            if token:
                kwargs["ContinuationToken"] = token
            page = s3.list_objects_v2(**kwargs)
            for obj in (page.get("Contents") or []):
                key = obj["Key"]
                if key.endswith("/"):
                    continue
                # contains match over key and basename
                if qlow in key.lower():
                    item = {"Key": key}
                    if want_url:
                        try:
                            item["url"] = _presign(s3, key)
                        except Exception:
                            item["url"] = None
                    found.append(item)
                    if len(found) >= limit:
                        return jsonify({"files": found})
            token = page.get("NextContinuationToken")
            if not token:
                break
        return jsonify({"files": found})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# /api/s3/content-search — searches OCRed text sidecars
# -----------------------------------------------------------------------------
def _highlight_windows(text: str, query: str, window: int = 160, max_windows: int = 3) -> Tuple[List[str], int, int, Optional[int]]:
    """
    Very small, self-contained highlighter.
    - Case-insensitive
    - Splits query terms on whitespace and 'AND'
    - Returns up to max_windows windows with <mark>…</mark>
    """
    if not text:
        return [], 0, 0, None

    # Parse terms (support "foo AND bar" or "foo bar")
    raw = query.strip()
    terms = [t for t in re.split(r"\s+|(?i)\s+AND\s+", raw) if t]
    if not terms:
        return [], 0, 0, None

    lower = text.lower()
    matches = []
    for t in terms:
        tlo = t.lower()
        start = 0
        while True:
            i = lower.find(tlo, start)
            if i < 0:
                break
            matches.append((i, i + len(t)))
            start = i + len(t)
    if not matches:
        return [], 0, 0, None

    # Merge overlaps
    matches.sort()
    merged = []
    cur_s, cur_e = matches[0]
    for s, e in matches[1:]:
        if s <= cur_e:
            cur_e = max(cur_e, e)
        else:
            merged.append((cur_s, cur_e))
            cur_s, cur_e = s, e
    merged.append((cur_s, cur_e))

    # Build windows around merged spans
    windows_html: List[str] = []
    for s, e in merged[:max_windows]:
        a = max(0, s - window // 2)
        b = min(len(text), e + window // 2)
        chunk = text[a:b]
        # highlight all terms in chunk (HTML-escape lite)
        esc = (
            chunk.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        for t in sorted(terms, key=len, reverse=True):
            esc = re.sub(
                re.escape(t), lambda m: f"<mark>{m.group(0)}</mark>", esc, flags=re.IGNORECASE
            )
        # add a subtle delimiter if truncated
        prefix = "… " if a > 0 else ""
        suffix = " …" if b < len(text) else ""
        windows_html.append(prefix + esc + suffix)

    total_hits = len(matches)
    total_windows = len(merged)
    next_offset = max_windows if total_windows > max_windows else None
    return windows_html, total_hits, total_windows, next_offset


@s3_bp.get("/s3/content-search")
def content_search():
    """
    Query params:
      q: str (required)
      limit: int (max results)
      presign: 0|1
      ext: 'pdf' (ignored; here for parity)
    Behavior:
      Looks for *.txt under OCR_PREFIX, searches contents for q (best-effort),
      returns the corresponding OCRed PDF (same base path .pdf) with a preview.
    Response:
      { files: [{ Key, url?, preview }]}
    """
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"files": []})
    limit = int(request.args.get("limit", "50"))
    want_url = request.args.get("presign", "0") in ("1", "true", "yes")

    s3 = _make_s3()
    results: List[Dict[str, Any]] = []
    scanned = 0

    try:
        token = None
        while True:
            kwargs = {"Bucket": S3_BUCKET, "Prefix": OCR_PREFIX, "MaxKeys": S3_PAGE_LIMIT}
            if token:
                kwargs["ContinuationToken"] = token
            page = s3.list_objects_v2(**kwargs)

            for obj in (page.get("Contents") or []):
                k = obj["Key"]
                if not k.lower().endswith(".txt"):
                    continue
                # Stream smallish text bodies
                body = s3.get_object(Bucket=S3_BUCKET, Key=k)["Body"].read()
                try:
                    text = body.decode("utf-8", errors="replace")
                except Exception:
                    text = body.decode("latin-1", errors="replace")

                windows, total_hits, total_windows, next_offset = _highlight_windows(text, q, window=200, max_windows=3)
                if not windows:
                    continue

                # map .txt -> .pdf in same folder
                pdf_key = re.sub(r"\.txt$", ".pdf", k, flags=re.IGNORECASE)
                item = {
                    "Key": pdf_key,
                    "preview": "<span class='sep'></span>".join(windows),
                    "total_hits": total_hits,
                    "total_windows": total_windows,
                    "next_offset": next_offset,
                }
                if want_url:
                    try:
                        item["url"] = _presign(s3, pdf_key)
                    except Exception:
                        item["url"] = None

                results.append(item)
                if len(results) >= limit:
                    return jsonify({"files": results})

                scanned += 1

            token = page.get("NextContinuationToken")
            if not token:
                break

        return jsonify({"files": results})
    except ClientError as e:
        return jsonify({"error": str(e)}), 500


# -----------------------------------------------------------------------------
# Tiny sanity endpoint (optional)
# -----------------------------------------------------------------------------
@s3_bp.get("/s3/ping")
def s3_ping():
    return jsonify({"ok": True, "bucket": S3_BUCKET})
