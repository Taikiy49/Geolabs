# reports.py
import os
import re
import html
import sqlite3
import boto3
from flask import Blueprint, jsonify, request, Response, stream_with_context
from flask_cors import CORS
from botocore.config import Config

# ---------------- Config ----------------
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
REPORTS_BUCKET = os.getenv("REPORTS_BUCKET", "geolabs-s3-bucket")
OCR_PREFIX = os.getenv("OCR_PREFIX", "OCRed_reports/")
AWS_REGION = os.getenv("AWS_REGION") or "us-east-1"
PRESIGN_TTL = int(os.getenv("REPORTS_PRESIGN_TTL", "3600"))
FTS_DB_PATH = os.path.join(BASE_DIR, "uploads", "reports_fts.db")

reports_bp = Blueprint("reports", __name__, url_prefix="/api/reports")

# Apply CORS to ALL routes in this blueprint
CORS(
    reports_bp,
    resources={r"/*": {"origins": "*"}},
    supports_credentials=False,
    expose_headers=[
        "Content-Type",
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "ETag",
        "Last-Modified",
    ],
)

@reports_bp.after_request
def _add_cors(resp):
    resp.headers.setdefault("Access-Control-Allow-Origin", "*")
    resp.headers.setdefault(
        "Access-Control-Expose-Headers",
        "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
    )
    return resp

# ---------------- Utils ----------------
def _s3():
    cfg = Config(region_name=AWS_REGION, retries={"max_attempts": 5, "mode": "standard"})
    return boto3.client("s3", config=cfg)

def _presign_pdf(key: str) -> str:
    s3 = _s3()
    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": REPORTS_BUCKET,
            "Key": key,
            "ResponseContentDisposition": f'inline; filename="{os.path.basename(key)}"',
            "ResponseContentType": "application/pdf",
        },
        ExpiresIn=PRESIGN_TTL,
    )

def _conn():
    if not os.path.exists(FTS_DB_PATH):
        raise FileNotFoundError(f"DB not found at {FTS_DB_PATH}")
    conn = sqlite3.connect(FTS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _table_exists(conn, name: str) -> bool:
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (name,),
        ).fetchone()
        return bool(row)
    except Exception:
        return False

def _as_txt_key(pdf_key: str) -> str:
    """Map a PDF S3 key to its TXT sidecar key under OCR_PREFIX."""
    key = (pdf_key or "").lstrip("/")
    if key.startswith(OCR_PREFIX):
        return os.path.splitext(key)[0] + ".txt"
    # Preserve nested subpath: foo/bar.pdf -> OCRed_reports/foo/bar.txt
    base_no_ext = os.path.splitext(key)[0]
    return f"{OCR_PREFIX}{base_no_ext}.txt"

def _read_s3_text(key: str, max_bytes: int = 5_000_000) -> str:
    s3 = _s3()
    obj = s3.get_object(Bucket=REPORTS_BUCKET, Key=key)
    body = obj["Body"].read(max_bytes)
    return body.decode("utf-8", errors="replace")

def _compile_query_pattern(q: str):
    """Build case-insensitive regex from a user query (supports quoted phrases)."""
    if not q:
        return None
    phrases = re.findall(r'"([^"]+)"', q)
    remaining = re.sub(r'"[^"]+"', " ", q)
    words = [w for w in re.split(r"[^\w%]+", remaining) if w]
    words = [w for w in words if len(w) > 1 and w.lower() not in {"and","or","not"}]
    terms = [re.escape(p.strip()) for p in phrases if p.strip()] + [re.escape(w) for w in words]
    if not terms:
        return None
    try:
        return re.compile("(" + "|".join(terms) + ")", re.IGNORECASE)
    except re.error:
        return None

def _build_windows(text: str, pattern: re.Pattern, window: int = 360, merge_gap: int = 40):
    """
    Return (windows_html:list[str], total_hits:int)
    - windows constructed around matches, merging heavily-overlapping regions
    - each window is HTML-escaped with <mark> applied to hits
    """
    if not pattern:
        # No pattern: just one window from head
        head = html.escape(text[: window * 2].strip())
        return [head], 0

    matches = list(pattern.finditer(text))
    total_hits = len(matches)
    if not matches:
        head = html.escape(text[: window * 2].strip())
        return [head], 0

    windows = []
    current_start = None
    current_end = None

    # First pass: compute non-overlapping window spans
    for m in matches:
        s = max(0, m.start() - window)
        e = min(len(text), m.end() + window)
        if current_start is None:
            current_start, current_end = s, e
        else:
            # merge if close/overlap
            if s <= (current_end + merge_gap):
                current_end = max(current_end, e)
            else:
                windows.append((current_start, current_end))
                current_start, current_end = s, e
    if current_start is not None:
        windows.append((current_start, current_end))

    # Second pass: render each window as HTML with <mark>
    html_windows = []
    for (s, e) in windows:
        segment = text[s:e]
        # rebuild escaped with highlights
        rebuilt = []
        pos = 0
        for mm in pattern.finditer(segment):
            if mm.start() < pos:
                continue
            before = segment[pos:mm.start()]
            hit = segment[mm.start():mm.end()]
            rebuilt.append(html.escape(before))
            rebuilt.append(f"<mark>{html.escape(hit)}</mark>")
            pos = mm.end()
        rebuilt.append(html.escape(segment[pos:]))
        prefix = "… " if s > 0 else ""
        suffix = " …" if e < len(text) else ""
        html_windows.append(prefix + "".join(rebuilt) + suffix)

    return html_windows, total_hits

# ---------------- Routes ----------------
@reports_bp.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": os.path.exists(FTS_DB_PATH),
        "db": FTS_DB_PATH,
        "bucket": REPORTS_BUCKET,
        "prefix": OCR_PREFIX,
    })

@reports_bp.route("/projects", methods=["GET"])
def projects():
    try:
        conn = _conn()
    except FileNotFoundError:
        return jsonify({"projects": [], "error": "DB missing"}), 200

    if not _table_exists(conn, "docs_meta"):
        conn.close()
        return jsonify({"projects": [], "error": "docs_meta table missing"}), 200

    rows = conn.execute("""
        SELECT COALESCE(project,'') as project, COUNT(*) as c
        FROM docs_meta
        GROUP BY COALESCE(project,'')
        ORDER BY c DESC
    """).fetchall()
    conn.close()
    return jsonify({"projects": [{"project": r["project"], "count": r["c"]} for r in rows]})

@reports_bp.route("/search", methods=["GET"])
def search():
    q = (request.args.get("q") or "").strip()
    project = (request.args.get("project") or "").strip()
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, int(request.args.get("page_size", 20)))

    if not q:
        return jsonify({"results": [], "total": 0, "page": 1, "pages": 1})

    try:
        conn = _conn()
    except FileNotFoundError:
        return jsonify({"results": [], "error": "DB missing"}), 200

    if not _table_exists(conn, "docs_meta") or not _table_exists(conn, "docs_fts"):
        conn.close()
        return jsonify({"results": [], "error": "Required tables missing"}), 200

    where = ["docs_fts MATCH ?"]
    params = [q]
    if project:
        where.append("m.project = ?")
        params.append(project)
    where_sql = " AND ".join(where)

    off = (page - 1) * page_size

    total = conn.execute(f"""
        SELECT COUNT(*) AS c
        FROM docs_fts
        JOIN docs_meta m ON m.key = docs_fts.key
        WHERE {where_sql}
    """, params).fetchone()["c"]

    rows = conn.execute(f"""
        SELECT m.key, m.name, m.project, m.last_modified,
               snippet(docs_fts, 0, '<mark>', '</mark>', ' … ', 24) AS snippet
        FROM docs_fts
        JOIN docs_meta m ON m.key = docs_fts.key
        WHERE {where_sql}
        ORDER BY m.last_modified DESC
        LIMIT ? OFFSET ?
    """, params + [page_size, off]).fetchall()
    conn.close()

    results = [{
        "s3_key": r["key"],
        "filename": r["name"] or os.path.basename(r["key"]),
        "project": r["project"],
        "date": r["last_modified"],
        "snippet": r["snippet"],
    } for r in rows]

    pages = max(1, (total + page_size - 1) // page_size)
    return jsonify({"results": results, "total": total, "page": page, "pages": pages})

@reports_bp.route("/file-url", methods=["GET"])
def file_url():
    key = request.args.get("key")
    if not key:
        return jsonify({"error": "Missing key"}), 400
    return jsonify({"url": _presign_pdf(key)})

# ---------- TXT Peek (paged, no PDF open) ----------
@reports_bp.route("/peek", methods=["GET"])
def peek():
    """
    Read the TXT sidecar from S3 and return paged HTML windows with <mark> highlights.
    Query params:
      - key: S3 PDF key (required)
      - q: search query (optional, for highlighting windows)
      - offset: starting window index (default 0)
      - limit: number of windows to return (default 3)
    Response:
      {
        "windows": [ "<html>", ... ],      # one HTML string per window
        "total_hits": 12,                   # total occurrences (all matches)
        "total_windows": 5,                 # total window count after merging overlaps
        "next_offset": 3,                   # null if no more
        "txt_key": "OCRed_reports/…/file.txt"
      }
    """
    key = (request.args.get("key") or "").strip()
    q = (request.args.get("q") or "").strip()
    try:
        offset = max(0, int(request.args.get("offset", 0)))
    except Exception:
        offset = 0
    try:
        limit = max(1, min(50, int(request.args.get("limit", 3))))
    except Exception:
        limit = 3

    if not key:
        return jsonify({"error": "Missing key"}), 400

    txt_key = _as_txt_key(key)
    try:
        text = _read_s3_text(txt_key)
    except Exception as e:
        if key.lower().endswith(".txt"):
            try:
                text = _read_s3_text(key)
                txt_key = key
            except Exception as e2:
                return jsonify({"error": "Cannot read txt", "detail": str(e2), "txt_key": key}), 404
        else:
            return jsonify({"error": "Cannot read txt", "detail": str(e), "txt_key": txt_key}), 404

    pattern = _compile_query_pattern(q)
    windows_all, total_hits = _build_windows(text, pattern, window=360, merge_gap=40)

    total_windows = len(windows_all)
    end = min(total_windows, offset + limit)
    windows_slice = windows_all[offset:end]
    next_offset = end if end < total_windows else None

    return jsonify({
        "windows": windows_slice,
        "total_hits": total_hits,
        "total_windows": total_windows,
        "next_offset": next_offset,
        "txt_key": txt_key,
    })

# ---------- PDF proxy (optional, avoids S3 CORS) ----------
import logging
log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

@reports_bp.route("/proxy", methods=["GET", "HEAD", "OPTIONS"])
def proxy():
    if request.method == "OPTIONS":
        resp = Response(status=204)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET,HEAD,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type,Range"
        return resp

    key = (request.args.get("key") or "").strip()
    range_hdr = request.headers.get("Range")
    ua = request.headers.get("User-Agent", "")
    log.info("PDF proxy: method=%s key=%r range=%r ua=%r", request.method, key, range_hdr, ua)

    if not key:
        return jsonify({"error": "Missing key"}), 400

    s3 = _s3()

    try:
        head = s3.head_object(Bucket=REPORTS_BUCKET, Key=key)
    except Exception as e:
        return jsonify({
            "error": "Cannot head object",
            "bucket": REPORTS_BUCKET,
            "key": key,
            "detail": str(e),
            "hint": "Ensure s3:GetObject and kms:Decrypt (if SSE-KMS)."
        }), 404

    obj_size = int(head.get("ContentLength", 0) or 0)
    last_modified = head.get("LastModified")
    etag = (head.get("ETag") or "").strip('"')

    common_headers = {
        "Content-Type": "application/pdf",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": f'inline; filename="{os.path.basename(key)}"',
        "Content-Security-Policy": "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
    }

    if etag:
        common_headers["ETag"] = f'"{etag}"'
    if last_modified:
        common_headers["Last-Modified"] = last_modified.strftime("%a, %d %b %Y %H:%M:%S GMT")

    if request.method == "HEAD":
        resp = Response(status=200)
        resp.headers.update(common_headers)
        resp.headers["Content-Length"] = str(obj_size)
        log.info("Proxy HEAD returning 200 size=%d", obj_size)
        return resp

    # ---- GET (stream) ----
    start, end = 0, obj_size - 1
    is_partial = False
    if range_hdr and range_hdr.startswith("bytes="):
        try:
            start_s, end_s = range_hdr[6:].split("-", 1)
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else (obj_size - 1)
            if start < 0 or end < start or end >= obj_size:
                resp = Response(status=416)
                resp.headers.update(common_headers)
                resp.headers["Content-Range"] = f"bytes */{obj_size}"
                return resp
            is_partial = True
        except Exception:
            start, end, is_partial = 0, obj_size - 1, False

    get_params = {"Bucket": REPORTS_BUCKET, "Key": key}
    if is_partial:
        get_params["Range"] = f"bytes={start}-{end}"

    try:
        obj = s3.get_object(**get_params)
        log.info("S3 get_object ok: range=%s", get_params.get("Range"))
    except Exception as e:
        return jsonify({
            "error": "Cannot fetch object",
            "bucket": REPORTS_BUCKET,
            "key": key,
            "range": get_params.get("Range", ""),
            "detail": str(e),
            "hint": "If bucket uses SSE-KMS, grant kms:Decrypt to this app role."
        }), 502

    body = obj["Body"]
    chunk_size = 1024 * 1024  # 1MB
    bytes_target = (end - start + 1)
    bytes_sent_box = {"n": 0}

    def generate():
        try:
            for chunk in body.iter_chunks(chunk_size=chunk_size):
                if not chunk:
                    break
                bytes_sent_box["n"] += len(chunk)
                yield chunk
        finally:
            try:
                body.close()
            except Exception:
                pass
            log.info(
                "Proxy stream finished: sent=%d bytes (expected=%d)",
                bytes_sent_box["n"], bytes_target
            )

    status = 206 if is_partial else 200
    headers = dict(common_headers)
    headers["Content-Length"] = str(bytes_target)
    if is_partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{obj_size}"
        log.info("Proxy returning 206 Content-Range=%s", headers["Content-Range"])
    else:
        log.info("Proxy returning 200 Content-Length=%d", bytes_target)

    return Response(stream_with_context(generate()), status=status, headers=headers)
