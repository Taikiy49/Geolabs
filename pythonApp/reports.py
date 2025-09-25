# reports.py
import os
import re
import json
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz  # PyMuPDF
from flask import (
    Blueprint,
    current_app,
    jsonify,
    request,
    send_file,
    abort,
    Response,
)

# -------------------------------
# Configuration
# -------------------------------

# Default to local OCR output beside this file:
DEFAULT_BASE = Path(__file__).resolve().parent / "OCRed_reports"
REPORTS_BASE_DIR = Path(os.environ.get("REPORTS_BASE_DIR", str(DEFAULT_BASE))).resolve()

# How many bytes of the .txt to keep as excerpt (kept small for fast client-side search)
TXT_EXCERPT_BYTES = int(os.environ.get("TXT_EXCERPT_BYTES", "20000"))  # ~20KB

# Cache the index in-memory to avoid rescans on every call
_INDEX_CACHE: Dict[str, Dict] = {
    # "data": [...],
    # "built_at": epoch,
    # "etag": "...",
    # "base_mtime": float,
}

reports_bp = Blueprint("reports", __name__)

# Regex helpers (best-effort extraction from file/folder names)
RE_WO = re.compile(r"\b(?:WO[-_ ]?)?(\d{3,6}(?:[-_]\d+)?(?:\([A-Z]\))?)\b", re.IGNORECASE)
RE_YEAR = re.compile(r"(^|[\\/])([12]\d{3})([\\/]|$)")


# -------------------------------
# Utilities
# -------------------------------

def _safe_within(base: Path, target: Path) -> bool:
    """Ensure target is inside base (prevent path traversal)."""
    try:
        target = target.resolve()
        base = base.resolve()
        return str(target).startswith(str(base))
    except Exception:
        return False


def _guess_year_from_path(rel: str) -> Optional[str]:
    m = RE_YEAR.search(rel)
    if m:
        return m.group(2)
    return None


def _extract_wo(text: str) -> Optional[str]:
    m = RE_WO.search(text or "")
    if m:
        # Normalize letter like 8292-05B -> 8292-05(B)
        wo = m.group(1)
        if re.match(r".*[A-Za-z]$", wo):
            return f"{wo[:-1]}({wo[-1].upper()})"
        return wo
    return None


def _title_from_filename(name: str) -> str:
    # "WO-8292-05B_Report_Final.pdf" -> "WO-8292-05B Report Final"
    base = name.rsplit(".", 1)[0]
    base = base.replace("_", " ").replace("-", " ").strip()
    base = re.sub(r"\s+", " ", base)
    return base


def _scan_txt_excerpt(txt_path: Path, max_bytes: int) -> str:
    try:
        with open(txt_path, "rb") as f:
            raw = f.read(max_bytes)
        # best-effort decode
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _page_count(pdf_path: Path) -> int:
    try:
        doc = fitz.open(str(pdf_path))
        n = doc.page_count
        doc.close()
        return n
    except Exception:
        return 0


def _build_index(base_dir: Path) -> Tuple[List[Dict], float, str]:
    """
    Walk `base_dir`, collect *.pdf, and emit index rows:
    {
      id, title, client, project, wo, date, pages, size_bytes,
      pdf_path (API link), txt_path (internal), keywords, text_excerpt
    }
    """
    rows: List[Dict] = []
    base_dir = base_dir.resolve()

    if not base_dir.exists():
        base_dir.mkdir(parents=True, exist_ok=True)

    newest_mtime: float = 0.0

    for pdf in base_dir.rglob("*.pdf"):
        # gather paths
        if not _safe_within(base_dir, pdf):
            continue

        rel = str(pdf.relative_to(base_dir)).replace("\\", "/")
        size_bytes = pdf.stat().st_size if pdf.exists() else 0
        newest_mtime = max(newest_mtime, pdf.stat().st_mtime)

        # Adjacent TXT (optional)
        txt = pdf.with_suffix(".txt")
        text_excerpt = _scan_txt_excerpt(txt, TXT_EXCERPT_BYTES) if txt.exists() else ""

        # Derive metadata (best effort)
        parts = rel.split("/")
        filename = pdf.name
        title = _title_from_filename(filename)

        # Try to infer year, client, project from path convention like: year/client/project/filename.pdf
        year = _guess_year_from_path(rel)
        client = None
        project = None
        if len(parts) >= 3:
            # Heuristic: .../<year>/<client>/<project>/file.pdf  (or without year)
            # If the first part looks like a year, shift
            if re.fullmatch(r"[12]\d{3}", parts[0]):
                year = parts[0]
                client = parts[1] if len(parts) > 1 else None
                project = parts[2] if len(parts) > 2 else None
            else:
                client = parts[0]
                project = parts[1]

        # Work order from file or path text
        wo = _extract_wo(rel) or _extract_wo(title)

        # Basic keyword seeds from path chunks (fine to leave empty)
        keywords = list({*(wo or "").split(), *(client or "").split(), *(project or "").split()})
        keywords = [k for k in keywords if k]

        # Build a stable API link to stream the PDF from disk (no TXT exposed)
        pdf_api_href = f"/api/reports/pdf?rel={rel}"

        # Optional ISO date from file mtime (if not derivable from path)
        iso_date = time.strftime("%Y-%m-%d", time.localtime(pdf.stat().st_mtime)) if pdf.exists() else None

        row = {
            "id": rel,                          # unique within this index
            "title": title or rel,
            "client": client,
            "project": project,
            "wo": wo,
            "date": iso_date,                   # UI displays only the year by default
            "pages": _page_count(pdf),
            "size_bytes": size_bytes,
            "pdf_path": pdf_api_href,           # <--- this is what the React app opens
            "txt_path": str(txt) if txt.exists() else None,  # not used by UI, helpful for debugging
            "keywords": keywords,
            "text_excerpt": text_excerpt,
        }
        rows.append(row)

    # Sort newest first by mtime (just for determinism if not searching)
    rows.sort(key=lambda r: r["date"] or "", reverse=True)

    # ETag can be a simple digest of count + newest_mtime
    etag = f'W/"{len(rows)}-{int(newest_mtime)}"'
    return rows, newest_mtime, etag


def _get_cached_index(force: bool = False):
    base = REPORTS_BASE_DIR
    base_mtime = base.stat().st_mtime if base.exists() else 0.0

    if (
        not force
        and _INDEX_CACHE.get("data") is not None
        and _INDEX_CACHE.get("base_mtime") == base_mtime
    ):
        return _INDEX_CACHE["data"], _INDEX_CACHE["etag"]

    data, newest, etag = _build_index(base)
    _INDEX_CACHE["data"] = data
    _INDEX_CACHE["built_at"] = time.time()
    _INDEX_CACHE["etag"] = etag
    _INDEX_CACHE["base_mtime"] = base_mtime
    return data, etag


# -------------------------------
# API Endpoints
# -------------------------------

@reports_bp.get("/reports-index")
def get_reports_index_json():
    """
    Returns the JSON index the React Reports.jsx consumes.
    URL used by the frontend (primary):    /api/reports-index
    Also mapped at app-level to:           /reports-index.json   (fallback path)
    Query params:
      - force=1   → rebuild index (bypass in-memory cache)
    """
    force = request.args.get("force") in ("1", "true", "yes")
    data, etag = _get_cached_index(force=force)

    # ETag support (basic)
    inm = request.headers.get("If-None-Match")
    if inm and inm == etag and not force:
        return Response(status=304)

    resp = jsonify(data)
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = "no-store"
    return resp


@reports_bp.post("/reports-reindex")
def post_reports_reindex():
    """
    Manually rebuild the index (for admin buttons or CI hooks).
    """
    data, etag = _get_cached_index(force=True)
    resp = jsonify({"ok": True, "count": len(data), "etag": etag})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@reports_bp.get("/reports/pdf")
def get_report_pdf():
    """
    Streams a PDF from local disk by relative path inside OCRed_reports.
    Query:
      - rel=<relative/path/to/file.pdf>  (as provided in index id)
    """
    rel = request.args.get("rel")
    if not rel:
        abort(400, "Missing 'rel' parameter")

    pdf_path = (REPORTS_BASE_DIR / rel).resolve()
    if not _safe_within(REPORTS_BASE_DIR, pdf_path):
        abort(403, "Forbidden path")

    if not pdf_path.exists() or not pdf_path.is_file() or not str(pdf_path).lower().endswith(".pdf"):
        abort(404, "PDF not found")

    # Flask will set application/pdf automatically for pdf files
    # Disable aggressive caching for correctness while iterating
    response = send_file(
        str(pdf_path),
        mimetype="application/pdf",
        as_attachment=False,
        conditional=True,  # supports If-Modified-Since / ranges
        last_modified=time.gmtime(pdf_path.stat().st_mtime),
        etag=True,
        download_name=pdf_path.name,
    )
    response.headers["Cache-Control"] = "private, max-age=0, no-store"
    return response
