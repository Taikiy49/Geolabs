# reports.py
import os, sqlite3, boto3
from botocore.config import Config
from urllib.parse import quote
from flask import Blueprint, jsonify, request, Response, stream_with_context
from flask_cors import CORS

REPORTS_BUCKET = os.getenv("REPORTS_BUCKET", "geolabs-s3-bucket")
OCR_PREFIX     = os.getenv("OCR_PREFIX", "OCRed_reports/")
AWS_REGION     = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
PRESIGN_TTL    = int(os.getenv("REPORTS_PRESIGN_TTL", "3600"))
FTS_DB_PATH    = os.getenv("FTS_DB_PATH", os.path.join(os.path.dirname(__file__), "uploads", "reports_fts.db"))

reports_bp = Blueprint("reports", __name__, url_prefix="/api/reports")
CORS(reports_bp, resources={r"/api/*": {"origins": "*"}})

def _s3():
    cfg = Config(region_name=AWS_REGION, retries={"max_attempts": 10, "mode": "standard"})
    return boto3.client("s3", config=cfg)

def _presign_inline(key: str) -> str:
    s3 = _s3()
    filename = key.split("/")[-1]
    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": REPORTS_BUCKET,
            "Key": key,
            "ResponseContentDisposition": f'inline; filename="{filename}"',
            "ResponseContentType": "application/pdf",
        },
        ExpiresIn=PRESIGN_TTL,
    )

@reports_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": os.path.exists(FTS_DB_PATH), "bucket": REPORTS_BUCKET, "prefix": OCR_PREFIX, "fts_db": FTS_DB_PATH})

@reports_bp.route("/file", methods=["GET"])
def presign_file():
    key = request.args.get("key")
    if not key: return jsonify({"error": "Missing key"}), 400
    return jsonify({"key": key, "url": _presign_inline(key)})

@reports_bp.route("/proxy", methods=["GET"])
def proxy_file():
    key = request.args.get("key")
    if not key: return jsonify({"error": "Missing key"}), 400
    s3 = _s3()
    try:
        obj = s3.get_object(Bucket=REPORTS_BUCKET, Key=key)
    except Exception as e:
        return jsonify({"error": f"Cannot fetch object: {e}"}), 404
    filename = key.split("/")[-1]
    headers = {
        "Content-Type": "application/pdf",
        "Content-Disposition": f'inline; filename="{filename}"',
        "Cache-Control": "private, max-age=3600",
        "X-Frame-Options": "SAMEORIGIN",
    }
    def generate():
        for chunk in iter(lambda: obj["Body"].read(8192), b""): yield chunk
    return Response(stream_with_context(generate()), headers=headers)

@reports_bp.route("/search", methods=["GET"])
def search_reports():
    q = (request.args.get("q") or "").strip()
    limit = int(request.args.get("limit", "50"))
    prefix = (request.args.get("prefix") or "").strip()
    if not q: return jsonify({"q": "", "hits": []})
    if not os.path.exists(FTS_DB_PATH):
        return jsonify({"error": "Index DB not found. Run build_index.py"}), 500

    conn = sqlite3.connect(FTS_DB_PATH)
    conn.row_factory = sqlite3.Row
    sql = """
SELECT m.key AS pdf_key, m.name, m.size, m.last_modified,
       snippet(docs_fts, 0, '<mark>', '</mark>', ' … ', 24) AS snip
FROM docs_fts
JOIN docs_meta m ON m.key = docs_fts.key
WHERE docs_fts MATCH ?
"""
    params = [q]
    if prefix:
        sql += " AND m.key LIKE ? "
        params.append(prefix + "%")
    sql += " LIMIT ? "
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    qfrag = f"#search={quote(q)}"
    hits = []
    for r in rows:
        key = r["pdf_key"]
        url = _presign_inline(key) + qfrag
        hits.append({
            "pdfKey": key,
            "name": r["name"] or key.split("/")[-1],
            "size": r["size"] or 0,
            "lastModified": r["last_modified"],
            "snippet": r["snip"] or "",
            "pdfUrl": url,
        })
    return jsonify({"q": q, "hits": hits})

@reports_bp.route("/list", methods=["GET"])
def list_reports():
    """
    Paginated listing from docs_meta (no S3 listing).
    Query:
      - prefix: optional LIKE filter: '2024/ClientA/' to scope
      - page:   1-based page (default 1)
      - page_size: items per page (default 200, max 1000)
      - order:  'lm_desc' (default), 'lm_asc', 'name_asc', 'name_desc'
    Returns: { page, page_size, total, items: [{key,name,size,lastModified,pdfUrl}] }
    """
    if not os.path.exists(FTS_DB_PATH):
        return jsonify({"error": "Index DB not found. Run build_index.py"}), 500

    prefix = (request.args.get("prefix") or "").strip()
    page = max(1, int(request.args.get("page", "1")))
    page_size = min(1000, max(1, int(request.args.get("page_size", "200"))))
    order = (request.args.get("order") or "lm_desc").lower()

    order_sql = {
        "lm_desc": "ORDER BY COALESCE(last_modified,'') DESC",
        "lm_asc":  "ORDER BY COALESCE(last_modified,'') ASC",
        "name_asc": "ORDER BY name COLLATE NOCASE ASC",
        "name_desc":"ORDER BY name COLLATE NOCASE DESC",
    }.get(order, "ORDER BY COALESCE(last_modified,'') DESC")

    where = ""
    params = []
    if prefix:
        where = "WHERE key LIKE ?"
        params.append(prefix + "%")

    off = (page - 1) * page_size

    conn = sqlite3.connect(FTS_DB_PATH)
    conn.row_factory = sqlite3.Row

    total = conn.execute(f"SELECT COUNT(*) AS c FROM docs_meta {where}", params).fetchone()["c"]

    rows = conn.execute(
        f"""
        SELECT key, name, size, last_modified
        FROM docs_meta
        {where}
        {order_sql}
        LIMIT ? OFFSET ?
        """,
        params + [page_size, off]
    ).fetchall()
    conn.close()

    items = [{
        "key": r["key"],
        "name": r["name"] or r["key"].split("/")[-1],
        "size": r["size"] or 0,
        "lastModified": r["last_modified"],
        "pdfUrl": _presign_inline(r["key"]),
    } for r in rows]

    return jsonify({
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": items,
    })

@reports_bp.route("/suggest", methods=["GET"])
def suggest_recent():
    limit = int(request.args.get("limit", "25"))
    prefix = (request.args.get("prefix") or "").strip()
    if not os.path.exists(FTS_DB_PATH): return jsonify({"items": []})
    conn = sqlite3.connect(FTS_DB_PATH); conn.row_factory = sqlite3.Row
    sql = "SELECT key, name, size, last_modified FROM docs_meta"
    params = []
    if prefix:
        sql += " WHERE key LIKE ? "; params.append(prefix + "%")
    sql += " ORDER BY COALESCE(last_modified, '') DESC LIMIT ? "; params.append(limit)
    rows = conn.execute(sql, params).fetchall(); conn.close()
    items = [{
        "key": r["key"],
        "name": r["name"] or r["key"].split("/")[-1],
        "size": r["size"] or 0,
        "lastModified": r["last_modified"],
        "pdfUrl": _presign_inline(r["key"]),
    } for r in rows]
    return jsonify({"items": items})
