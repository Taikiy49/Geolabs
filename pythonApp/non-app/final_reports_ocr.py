#!/usr/bin/env python3
"""
S3 PDFs -> (Same bucket) OCRed_reports/* : Searchable PDFs + TXT sidecars
(Tesseract-only, Parallel, Idempotent, Robust I/O, Skips OCR for text-native PDFs)

- Scans s3://<bucket>/reports/**.pdf
- For each source PDF, writes to s3://<bucket>/OCRed_reports/<same subpath>.pdf + .txt + .done
- Skips work if outputs already exist (.done OR both .pdf and .txt)
- For text-native PDFs: copies original PDF and extracts embedded text (no OCR)
- For image PDFs: renders via PyMuPDF, runs local Tesseract EXE to produce PDF+TXT
"""

import os
import sys
import io
import time
import uuid
import shutil
import tempfile
import subprocess
from typing import Iterable, Tuple, Optional, List

import boto3
from botocore.exceptions import ClientError
from botocore.config import Config

import fitz  # PyMuPDF
from PIL import Image, ImageFile

# Be lenient on odd inputs so Pillow doesn't crash during close()
ImageFile.LOAD_TRUNCATED_IMAGES = True

# =========================
# SETTINGS (edit if needed)
# =========================
S3_BUCKET      = os.getenv("S3_BUCKET", "geolabs-s3-bucket")
SRC_PREFIX     = os.getenv("SRC_PREFIX", "reports/")   # must end with '/'
DST_PREFIX     = os.getenv("DST_PREFIX", "OCRed_reports/")  # must end with '/'

RENDER_DPI     = int(os.getenv("RENDER_DPI", "300"))  # 240–300 is a good balance
OCR_LANGS      = os.getenv("OCR_LANGS", "eng")        # e.g., "eng+jpn"
TESSERACT_EXE  = os.getenv("TESSERACT_EXE", r"C:\Users\tyamashita\AppData\Local\Programs\Tesseract-OCR\tesseract.exe")

# Parallelism
DEFAULT_WORKERS = max(1, (os.cpu_count() or 4) - 1)
WORKERS         = int(os.getenv("WORKERS", str(DEFAULT_WORKERS)))

# Optional limit (e.g. LIMIT=5 to test first 5)
LIMIT           = int(os.getenv("LIMIT", "10"))  # 0 => no limit

# Region override (optional)
REGION_OVERRIDE = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or None
# =========================


def banner():
    print("🚀 S3 → S3 (same bucket) OCR pipeline (Tesseract-only, Parallel, Idempotent)")
    print(f"   Bucket   : {S3_BUCKET}")
    print(f"   Source   : {SRC_PREFIX}")
    print(f"   Dest     : {DST_PREFIX}")
    print(f"   Workers  : {WORKERS}  |  Limit: {LIMIT or 'ALL'}")
    print(f"   Tesseract: {TESSERACT_EXE} (exists={os.path.exists(TESSERACT_EXE)})")
    print(f"   DPI/Lang : {RENDER_DPI} / {OCR_LANGS}")


def human_err(e: ClientError) -> Tuple[str, str]:
    err = e.response.get("Error", {})
    return err.get("Code", "Unknown"), err.get("Message", str(e))


def bucket_region(bucket: str) -> str:
    s3_global = boto3.client("s3", config=Config(retries={"max_attempts": 10, "mode": "standard"}))
    resp = s3_global.get_bucket_location(Bucket=bucket)
    loc = resp.get("LocationConstraint")
    return (loc or "us-east-1")


def make_s3(region: str):
    cfg = Config(
        region_name=region,
        retries={"max_attempts": 10, "mode": "standard"},
        user_agent_extra="geolabs-tesseract-ocr/3.0"
    )
    return boto3.client("s3", config=cfg)


def list_pdfs(s3, bucket: str, prefix: str) -> Iterable[str]:
    print(f"🔎 Listing PDFs under s3://{bucket}/{prefix} …")
    paginator = s3.get_paginator("list_objects_v2")
    total = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if key.endswith("/") or not key.lower().endswith(".pdf"):
                continue
            total += 1
            yield key
    print(f"✅ Found {total} PDF(s).")


# ---------- Key mapping & existence checks on S3 ----------

def out_key_base(src_key: str) -> str:
    """
    Map: reports/path/file.pdf  ->  OCRed_reports/path/file   (no extension)
    """
    assert SRC_PREFIX.endswith("/")
    assert DST_PREFIX.endswith("/")
    rel = src_key[len(SRC_PREFIX):] if src_key.startswith(SRC_PREFIX) else src_key
    if rel.lower().endswith(".pdf"):
        rel = rel[:-4]  # drop .pdf
    return f"{DST_PREFIX}{rel}"


def s3_key_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def outputs_already_done(s3, bucket: str, out_base_key: str) -> bool:
    """
    Consider it "done" if:
      - .done exists OR
      - both .pdf and .txt exist
    """
    if s3_key_exists(s3, bucket, out_base_key + ".done"):
        return True
    pdf_ok = s3_key_exists(s3, bucket, out_base_key + ".pdf")
    txt_ok = s3_key_exists(s3, bucket, out_base_key + ".txt")
    return pdf_ok and txt_ok


# ---------- Source sanity checks ----------

def preflight_pdf(s3, bucket: str, key: str) -> Tuple[bool, Optional[int]]:
    try:
        h = s3.head_object(Bucket=bucket, Key=key)
    except ClientError as e:
        code, msg = human_err(e)
        print(f"   💥 head_object failed for {key}: {code} — {msg}")
        return False, None
    storage = (h.get("StorageClass") or "STANDARD")
    if storage in ("GLACIER", "DEEP_ARCHIVE", "GLACIER_IR"):
        print(f"   🧊 Cold storage for {key}; skip until restored.")
        return False, None
    clen = h.get("ContentLength", 0)
    if clen <= 0:
        print(f"   ⚠️ Zero-length object: {key}")
        return False, None
    return True, int(clen)


# ---------- Local PDF helpers ----------

def is_probably_pdf(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(5)
        return head == b"%PDF-"
    except Exception:
        return False


def safe_open_pdf(path: str) -> fitz.Document:
    try:
        return fitz.open(path)
    except Exception as e:
        raise RuntimeError(f"Unreadable PDF: {e}")


def download_with_verification(s3, bucket: str, key: str, dest_path: str, expected_len: Optional[int], retries: int = 2):
    for attempt in range(retries + 1):
        try:
            s3.download_file(bucket, key, dest_path)
            if expected_len is not None:
                actual = os.path.getsize(dest_path)
                if actual != expected_len:
                    raise RuntimeError(f"Size mismatch (got {actual}, expected {expected_len})")
            if not is_probably_pdf(dest_path):
                raise RuntimeError("Missing %PDF- header")
            doc = safe_open_pdf(dest_path)
            pc = doc.page_count
            doc.close()
            if pc <= 0:
                raise RuntimeError("PDF has 0 pages")
            return
        except Exception as e:
            if attempt < retries:
                print(f"   ⚠️ download verify failed (attempt {attempt+1}/{retries+1}): {e} — retrying …")
                try:
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                except Exception:
                    pass
                time.sleep(1.0 + attempt * 0.5)
                continue
            else:
                raise


def pdf_has_embedded_text(pdf_path: str, sample_pages: int = 5, min_chars: int = 40, threshold_ratio: float = 0.6) -> bool:
    doc = fitz.open(pdf_path)
    try:
        n = doc.page_count
        if n == 0:
            return False
        sample = min(sample_pages, n)
        hits = 0
        for i in range(sample):
            txt = (doc.load_page(i).get_text("text") or "").strip()
            if len(txt) >= min_chars:
                hits += 1
        return (hits / sample) >= threshold_ratio
    finally:
        doc.close()


def extract_embedded_text_to_txt(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    try:
        parts: List[str] = []
        for i in range(doc.page_count):
            parts.append(doc.load_page(i).get_text("text") or "")
        return "\n".join(parts)
    finally:
        doc.close()


def render_pdf_to_multipage_tif(pdf_path: str, tif_path: str, dpi: int) -> int:
    doc = safe_open_pdf(pdf_path)
    images = []
    try:
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            images.append(img)
    finally:
        page_count = doc.page_count
        doc.close()

    if not images:
        raise RuntimeError("No pages rendered")

    tmp = tif_path + ".part"
    try:
        if len(images) == 1:
            images[0].save(tmp, format="TIFF", compression="tiff_lzw")
        else:
            images[0].save(
                tmp,
                format="TIFF",
                save_all=True,
                append_images=images[1:],
                compression="tiff_lzw",
            )
        os.replace(tmp, tif_path)
    finally:
        for im in images:
            try: im.close()
            except Exception: pass

    if not os.path.exists(tif_path):
        raise RuntimeError("Failed to create TIF")
    return page_count


# ---------- Tesseract & Upload ----------

def run_tesseract(tif_path: str, out_base_no_ext: str, langs: str, mode: str, verbose_tag: str):
    """
    mode in {"pdf", "txt"}; writes out_base_no_ext + ".pdf" or ".txt".
    out_base_no_ext must NOT include ".tmp" (tesseract doesn't like odd bases).
    """
    assert mode in ("pdf", "txt")
    cmd = [TESSERACT_EXE, tif_path, out_base_no_ext, "-l", langs, mode]
    print(f"      ▶ {verbose_tag}: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Tesseract {mode} failed (exit {res.returncode})\n"
            f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )


def s3_upload_file(s3, bucket: str, local_path: str, key: str):
    """Upload a local file to S3 (final key)."""
    s3.upload_file(local_path, bucket, key)


def s3_put_text(s3, bucket: str, key: str, text: str):
    s3.put_object(Bucket=bucket, Key=key, Body=text.encode("utf-8"), ContentType="text/plain; charset=utf-8")


def s3_put_done(s3, bucket: str, base_key: str):
    s3.put_object(Bucket=bucket, Key=base_key + ".done", Body=b"ok\n", ContentType="text/plain")


# ---------- Worker ----------

def worker(pdf_key: str) -> str:
    """
    Runs in a child process: downloads src, decides native vs OCR, produces outputs,
    uploads to S3 under OCRed_reports/, and writes .done.
    """
    s3 = make_s3(REGION_OVERRIDE or bucket_region(S3_BUCKET))

    out_base_key = out_key_base(pdf_key)       # s3 key base for outputs (no extension)
    pdf_key_out  = out_base_key + ".pdf"
    txt_key_out  = out_base_key + ".txt"

    # Idempotency: skip if already done
    if outputs_already_done(s3, S3_BUCKET, out_base_key):
        return f"skip(done): {pdf_key}"

    ok, expected_len = preflight_pdf(s3, S3_BUCKET, pdf_key)
    if not ok:
        return f"skip(preflight): {pdf_key}"

    # Private temp dir
    workdir = tempfile.mkdtemp(prefix="ocrw_")
    uid = uuid.uuid4().hex
    tmp_pdf  = os.path.join(workdir, f"in_{uid}.pdf")
    tif_path = os.path.join(workdir, f"pages_{uid}.tif")
    out_base_local = os.path.join(workdir, f"out_{uid}")  # local tesseract base (no extension)

    t0 = time.time()
    try:
        print(f"\n==> START {pdf_key}")
        print(f"    ↘ downloading …")
        download_with_verification(s3, S3_BUCKET, pdf_key, tmp_pdf, expected_len)

        # Fast path: skip OCR if embedded text is present
        if pdf_has_embedded_text(tmp_pdf):
            print("    🔎 Embedded text detected → no OCR")
            # PDF: copy original to dest (upload original bytes)
            s3.upload_file(tmp_pdf, S3_BUCKET, pdf_key_out)
            print(f"    ✅ uploaded PDF → s3://{S3_BUCKET}/{pdf_key_out}")

            # TXT: extract embedded text and upload
            embedded = extract_embedded_text_to_txt(tmp_pdf)
            s3_put_text(s3, S3_BUCKET, txt_key_out, embedded)
            print(f"    ✅ uploaded TXT → s3://{S3_BUCKET}/{txt_key_out}")

            s3_put_done(s3, S3_BUCKET, out_base_key)
            dt = time.time() - t0
            return f"done(native): {pdf_key} ({dt:.1f}s)"

        # Otherwise, render once → run tesseract twice (pdf + txt)
        print(f"    🖼 rendering @ {RENDER_DPI} DPI …")
        pages = render_pdf_to_multipage_tif(tmp_pdf, tif_path, RENDER_DPI)
        print(f"    📄 pages: {pages}")

        # OCR → PDF
        print(f"    🧠 OCR → PDF …")
        run_tesseract(tif_path, out_base_local, OCR_LANGS, "pdf", "PDF")
        local_pdf = out_base_local + ".pdf"
        if not os.path.exists(local_pdf):
            alt = out_base_local + ".PDF"
            if os.path.exists(alt):
                local_pdf = alt
        if not os.path.exists(local_pdf):
            raise RuntimeError("Tesseract did not produce a PDF")
        # sanity open
        d = fitz.open(local_pdf); _ = d.page_count; d.close()
        s3_upload_file(s3, S3_BUCKET, local_pdf, pdf_key_out)
        print(f"    ✅ uploaded PDF → s3://{S3_BUCKET}/{pdf_key_out}")

        # OCR → TXT
        print(f"    🧠 OCR → TXT …")
        run_tesseract(tif_path, out_base_local, OCR_LANGS, "txt", "TXT")
        local_txt = out_base_local + ".txt"
        if not os.path.exists(local_txt):
            raise RuntimeError("Tesseract did not produce a TXT")
        s3_upload_file(s3, S3_BUCKET, local_txt, txt_key_out)
        print(f"    ✅ uploaded TXT → s3://{S3_BUCKET}/{txt_key_out}")

        # Mark done
        s3_put_done(s3, S3_BUCKET, out_base_key)
        dt = time.time() - t0
        return f"done: {pdf_key} ({dt:.1f}s)"
    except Exception as e:
        return f"ERROR {pdf_key}: {e}"
    finally:
        try:
            shutil.rmtree(workdir, ignore_errors=True)
        except Exception:
            pass


# ---------- Main ----------

def main():
    banner()

    if not os.path.exists(TESSERACT_EXE):
        print("❌ Tesseract EXE not found. Update TESSERACT_EXE (or set env).")
        sys.exit(1)

    if not SRC_PREFIX.endswith("/") or not DST_PREFIX.endswith("/"):
        print("❌ SRC_PREFIX and DST_PREFIX must end with '/'.")
        sys.exit(2)

    region = REGION_OVERRIDE or bucket_region(S3_BUCKET)
    print(f"   Region   : {region}")

    s3 = make_s3(region)

    # List all source PDFs
    all_keys = list(list_pdfs(s3, S3_BUCKET, SRC_PREFIX))
    if LIMIT and LIMIT > 0:
        all_keys = all_keys[:LIMIT]
        print(f"   Limiting to first {LIMIT} file(s) …")

    total = len(all_keys)
    if total == 0:
        print("No PDFs found. Exiting.")
        return

    # Pre-filter: skip items already done to avoid submitting unnecessary jobs
    todo = []
    skipped = 0
    for k in all_keys:
        if outputs_already_done(s3, S3_BUCKET, out_key_base(k)):
            skipped += 1
        else:
            todo.append(k)

    print(f"📋 To process: {len(todo)}  |  Already done: {skipped}")

    # Ctrl+C handling: let running tasks finish, no new submissions
    interrupted = {"flag": False}

    def _sigint(_sig, _frm):
        print("\n🛑 Ctrl+C — letting running tasks finish; not submitting more …")
        interrupted["flag"] = True

    import signal as _signal
    _signal.signal(_signal.SIGINT, _sigint)

    from concurrent.futures import ProcessPoolExecutor, as_completed

    counters = {"done": 0, "skip_done": skipped, "skip_pre": 0, "errors": 0}
    start = time.time()

    try:
        with ProcessPoolExecutor(max_workers=WORKERS) as ex:
            futures = {ex.submit(worker, k): k for k in todo}
            done_ct = skipped
            for fut in as_completed(futures):
                k = futures[fut]
                try:
                    msg = fut.result()
                except Exception as e:
                    msg = f"ERROR {k}: {e}"

                done_ct += 1
                print(f"[{done_ct}/{total}] {msg}")
                if msg.startswith("done(native):") or msg.startswith("done:"):
                    counters["done"] += 1
                elif msg.startswith("skip(preflight):"):
                    counters["skip_pre"] += 1
                elif msg.startswith("skip(done):"):
                    counters["skip_done"] += 1
                elif msg.startswith("ERROR"):
                    counters["errors"] += 1

                if interrupted["flag"]:
                    # We aren't submitting new work anyway; just draining
                    pass
    except KeyboardInterrupt:
        # Main process interrupted; already-running workers may still be working.
        pass

    elapsed = time.time() - start
    print("\n================ SUMMARY ================")
    print(f"✅ done         : {counters['done']}")
    print(f"⏭  skip(done)  : {counters['skip_done']}")
    print(f"⏭  skip(pre)   : {counters['skip_pre']}")
    print(f"💥 errors      : {counters['errors']}")
    print(f"⏱  elapsed     : {elapsed:.1f}s")
    print(f"📦 output base : s3://{S3_BUCKET}/{DST_PREFIX}")

if __name__ == "__main__":
    main()

"""
OCR / text extraction pipeline for project reports.

Usage:
  python final_reports_ocr.py --src ./reports_pdfs --out ./processed_reports
  python final_reports_ocr.py --s3-bucket YOUR_BUCKET --s3-prefix reports/ --out ./processed_reports

Outputs one JSONL per run:
  processed_reports/reports_YYYYmmdd_HHMMSS.jsonl
Each line:
  {
    "id": "<stable id>",
    "filename": "...pdf",
    "s3_key": ".../file.pdf" | null,
    "project": "...",
    "date": "YYYY-MM-DD" | null,
    "title": "...",
    "text": "... (raw full text) ..."
  }
"""
import argparse, hashlib, json, os, re, sys, datetime, io
from pathlib import Path

try:
    import boto3
except ImportError:
    boto3 = None

try:
    import PyPDF2
except ImportError:
    PyPDF2 = None

# Optional Tesseract (only used if --force-ocr and no extractable text)
USE_TESSERACT = os.getenv("USE_TESSERACT", "0") == "1"
if USE_TESSERACT:
    try:
        import fitz  # pymupdf
        import pytesseract
        from PIL import Image
    except ImportError:
        USE_TESSERACT = False

FILENAME_META_RE = re.compile(
    r"^(?P<project>[A-Za-z0-9_-]{2,20})[_\- ](?P<date>\d{4}[._-]?\d{2}[._-]?\d{2})[_\- ]?(?P<title>.+)?\.pdf$",
    re.IGNORECASE,
)

def parse_filename_metadata(fname: str):
    m = FILENAME_META_RE.match(fname)
    if not m:
        return {"project": None, "date": None, "title": os.path.splitext(fname)[0]}
    raw_date = re.sub(r"[._-]", "", m.group("date"))
    date_fmt = None
    try:
        date_fmt = datetime.datetime.strptime(raw_date, "%Y%m%d").date().isoformat()
    except Exception:
        pass
    title = (m.group("title") or "").replace("_", " ").strip() or os.path.splitext(fname)[0]
    return {
        "project": m.group("project"),
        "date": date_fmt,
        "title": title,
    }

def hash_bytes(b: bytes):
    return hashlib.sha256(b).hexdigest()[:40]

def extract_pdf_text(raw: bytes):
    if not PyPDF2:
        return ""
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(raw))
        parts = []
        for page in reader.pages:
            try:
                t = page.extract_text() or ""
                if t.strip():
                    parts.append(t)
            except Exception:
                pass
        text = "\n".join(parts).strip()
        if text or not USE_TESSERACT:
            return text
    except Exception:
        pass
    # Fallback OCR (slow)
    if USE_TESSERACT:
        try:
            doc = fitz.open(stream=raw, filetype="pdf")
            pages = []
            for page in doc:
                pix = page.get_pixmap(dpi=200)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                pages.append(pytesseract.image_to_string(img))
            return "\n".join(pages)
        except Exception:
            return ""
    return ""

def iter_local_pdfs(src_dir: Path):
    for p in src_dir.rglob("*.pdf"):
        if p.is_file():
            yield p.name, p.read_bytes(), None  # (filename, bytes, s3_key)

def iter_s3_pdfs(bucket: str, prefix: str):
    if not boto3:
        print("boto3 not installed; cannot read S3.", file=sys.stderr)
        return
    s3 = boto3.client("s3")
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix or ""):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if key.lower().endswith(".pdf") and not key.endswith("/"):
                b = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
                fname = key.split("/")[-1]
                yield fname, b, key

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="Local directory of PDFs")
    ap.add_argument("--s3-bucket")
    ap.add_argument("--s3-prefix", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_file = out_dir / f"reports_{stamp}.jsonl"

    count = 0
    rows = 0
    with out_file.open("w", encoding="utf-8") as f:
        if args.src:
            for fname, data, s3_key in iter_local_pdfs(Path(args.src)):
                if args.limit and count >= args.limit:
                    break
                meta = parse_filename_metadata(fname)
                text = extract_pdf_text(data)
                rid = hash_bytes(fname.encode() + data[:200])
                rec = {
                    "id": rid,
                    "filename": fname,
                    "s3_key": s3_key,
                    "project": meta["project"],
                    "date": meta["date"],
                    "title": meta["title"],
                    "text": text,
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                count += 1
        elif args.s3_bucket:
            for fname, data, s3_key in iter_s3_pdfs(args.s3_bucket, args.s3_prefix):
                if args.limit and count >= args.limit:
                    break
                meta = parse_filename_metadata(fname)
                text = extract_pdf_text(data)
                rid = hash_bytes(fname.encode() + data[:200])
                rec = {
                    "id": rid,
                    "filename": fname,
                    "s3_key": s3_key,
                    "project": meta["project"],
                    "date": meta["date"],
                    "title": meta["title"],
                    "text": text,
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                count += 1
        else:
            print("Provide --src OR --s3-bucket", file=sys.stderr)
            return
    print(f"Wrote {count} records to {out_file}")

if __name__ == "__main__":
    main()
