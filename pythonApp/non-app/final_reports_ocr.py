#!/usr/bin/env python3
"""
S3 PDFs -> Local Searchable PDFs + TXT sidecars
(Tesseract-only, PARALLEL, Idempotent, Robust I/O, Skips OCR for text-native PDFs)

- Uses local Tesseract EXE to produce image+text PDF + .txt sidecar.
- Each worker has its own temp dir; atomic writes; verified downloads.
- If a PDF already has embedded text, we SKIP OCR: copy PDF and extract text to .txt.
- Resumable with .done sentinel; parallel workers; graceful Ctrl+C.
"""

import os
import sys
import io
import time
import uuid
import shutil
import tempfile
import subprocess
import signal
from typing import Iterable, Tuple, Dict, Optional, List

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
S3_BUCKET     = "geolabs-s3-bucket"
BASE_PREFIX   = "reports/"            # must end with '/'
RENDER_DPI    = 300                   # 240–300 is a good balance
OCR_LANGS     = "eng"                 # e.g., "eng+jpn"
TESSERACT_EXE = r"C:\Users\tyamashita\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"

# Output folder
LOCAL_OUTDIR  = os.path.join(os.path.dirname(__file__), "OCRed_reports")

# Workers
DEFAULT_WORKERS = max(1, (os.cpu_count() or 4) - 1)
WORKERS = int(os.environ.get("WORKERS", DEFAULT_WORKERS))

# Region override (optional)
REGION_OVERRIDE = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or None
# =========================


def banner():
    print("🚀 S3 PDFs → Local Searchable PDFs + TXT (Tesseract-only, PARALLEL, Idempotent, native-text skip)")
    print(f"   Bucket   : {S3_BUCKET}")
    print(f"   Prefix   : {BASE_PREFIX}")
    print(f"   OutDir   : {LOCAL_OUTDIR}")
    print(f"   Workers  : {WORKERS}")
    print(f"   Tesseract: {TESSERACT_EXE} (exists={os.path.exists(TESSERACT_EXE)})")
    print(f"   DPI      : {RENDER_DPI} | langs={OCR_LANGS}")


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
        user_agent_extra="geolabs-tesseract-ocr/2.5"
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


def out_base_for(pdf_key: str) -> str:
    """Base path (without extension) under LOCAL_OUTDIR that mirrors S3 path."""
    assert BASE_PREFIX.endswith("/")
    rel = pdf_key[len(BASE_PREFIX):] if pdf_key.startswith(BASE_PREFIX) else pdf_key
    base = os.path.join(LOCAL_OUTDIR, os.path.splitext(rel)[0])  # drop .pdf
    return base


def ensure_parent_dir(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def is_probably_pdf(path: str) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(5)
        return head == b"%PDF-"
    except Exception:
        return False


def safe_open_pdf(path: str) -> fitz.Document:
    """Open a PDF with PyMuPDF; raise if unreadable."""
    try:
        return fitz.open(path)
    except Exception as e:
        raise RuntimeError(f"Unreadable PDF: {e}")


def download_with_verification(s3, bucket: str, key: str, dest_path: str, expected_len: Optional[int], retries: int = 2):
    """Download with size + header verification; retry a couple times."""
    for attempt in range(retries + 1):
        try:
            ensure_parent_dir(dest_path)
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
            return  # success
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
    """
    Sample up to `sample_pages` pages; if >= threshold_ratio of sampled pages have
    >= min_chars of extractable text, treat as text-native (skip OCR).
    """
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
    """Extract embedded text (no OCR) from all pages and return a single string."""
    doc = fitz.open(pdf_path)
    try:
        parts: List[str] = []
        for i in range(doc.page_count):
            parts.append(doc.load_page(i).get_text("text") or "")
        return "\n".join(parts)
    finally:
        doc.close()


def render_pdf_to_multipage_tif(pdf_path: str, tif_path: str, dpi: int) -> int:
    """
    Render all pages to a single multi-page TIF for Tesseract input. Returns page count.
    Writes to tif_path + ".part" first; renames atomically.
    """
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
            try:
                im.close()
            except Exception:
                pass

    if not os.path.exists(tif_path):
        raise RuntimeError("Failed to create TIF")
    return page_count


def run_tesseract(tif_path: str, out_base_no_ext: str, langs: str, mode: str, verbose_tag: str):
    """
    mode in {"pdf", "txt"}; writes out_base_no_ext + ".pdf" or ".txt".
    IMPORTANT: out_base_no_ext has NO '.tmp' in its name to avoid Tesseract confusion.
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


def finalize_output(out_base: str, out_base_tmp_no_ext: str, mode: str):
    r"""
    Move temp output to final name, normalizing .PDF capitalization; re-open to verify PDF.

    - out_base: final base path WITHOUT extension (e.g., C:\...\OCRed_reports\foo\bar)
    - out_base_tmp_no_ext: temp base path WITHOUT extension (e.g., C:\Temp\ocrw_xxx\out_UUID)
    """
    if mode == "pdf":
        src = out_base_tmp_no_ext + ".pdf"
        if not os.path.exists(src):
            alt = out_base_tmp_no_ext + ".PDF"
            if os.path.exists(alt):
                src = alt
            else:
                raise RuntimeError("Expected PDF not found after Tesseract.")
        dst = out_base + ".pdf"
    else:
        src = out_base_tmp_no_ext + ".txt"
        dst = out_base + ".txt"

    ensure_parent_dir(dst)
    os.replace(src, dst)

    # Verify produced PDF opens (catch corrupt outputs early)
    if mode == "pdf":
        try:
            d = fitz.open(dst)
            _ = d.page_count
            d.close()
        except Exception:
            try:
                os.remove(dst)
            except Exception:
                pass
            raise RuntimeError("Produced PDF failed to open; removed corrupt output.")


def write_done_sentinel(out_base: str):
    with open(out_base + ".done", "w", encoding="utf-8") as f:
        f.write("ok\n")


def have_done(out_base: str) -> bool:
    return os.path.exists(out_base + ".done")


def worker(pdf_key: str) -> str:
    """
    Child process entry. Every worker uses a unique temp dir and filenames.
    No filenames with '.tmp' are passed to Tesseract.
    """
    s3 = make_s3(REGION_OVERRIDE or bucket_region(S3_BUCKET))
    base = out_base_for(pdf_key)
    pdf_out = base + ".pdf"
    txt_out = base + ".txt"

    # Idempotency
    if have_done(base):
        return f"skip(done): {pdf_key}"

    ok, expected_len = preflight_pdf(s3, S3_BUCKET, pdf_key)
    if not ok:
        return f"skip(preflight): {pdf_key}"

    ensure_parent_dir(pdf_out)

    # Private temp dir + unique names
    workdir = tempfile.mkdtemp(prefix="ocrw_")
    uid = uuid.uuid4().hex
    tmp_pdf = os.path.join(workdir, f"in_{uid}.pdf")
    tif_path = os.path.join(workdir, f"pages_{uid}.tif")   # .tif (not .tiff/.tmp)
    out_base_tmp_no_ext = os.path.join(workdir, f"out_{uid}")  # no .tmp here

    t0 = time.time()
    try:
        print(f"\n==> START {pdf_key}")
        print(f"    ↘ downloading …")
        download_with_verification(s3, S3_BUCKET, pdf_key, tmp_pdf, expected_len)

        # Fast path: skip OCR if embedded text is present
        if pdf_has_embedded_text(tmp_pdf):
            print("    🔎 Embedded text detected → skipping OCR")
            need_pdf = not os.path.exists(pdf_out)
            need_txt = not os.path.exists(txt_out)

            if need_pdf:
                shutil.copyfile(tmp_pdf, pdf_out)
                d = fitz.open(pdf_out); _ = d.page_count; d.close()
                print(f"    ✅ Copied native-text PDF → {os.path.relpath(pdf_out)}")

            if need_txt:
                embedded = extract_embedded_text_to_txt(tmp_pdf)
                ensure_parent_dir(txt_out)
                with open(txt_out, "w", encoding="utf-8") as f:
                    f.write(embedded)
                print(f"    ✅ Wrote TXT from embedded text → {os.path.relpath(txt_out)}")

            write_done_sentinel(base)
            dt = time.time() - t0
            print(f"    ✔ DONE (no OCR) {pdf_key} in {dt:.1f}s")
            return f"done(native): {pdf_key} ({dt:.1f}s)"

        # Otherwise, render and OCR
        print(f"    🖼 rendering @ {RENDER_DPI} DPI …")
        pages = render_pdf_to_multipage_tif(tmp_pdf, tif_path, RENDER_DPI)
        print(f"    📄 pages: {pages}")

        need_pdf = not os.path.exists(pdf_out)
        need_txt = not os.path.exists(txt_out)

        if not need_pdf and not need_txt:
            write_done_sentinel(base)
            dt = time.time() - t0
            return f"skip(already both exist; restored .done): {pdf_key} ({dt:.1f}s)"

        if need_pdf:
            print(f"    🧠 OCR → PDF …")
            run_tesseract(tif_path, out_base_tmp_no_ext, OCR_LANGS, "pdf", "PDF")
            finalize_output(base, out_base_tmp_no_ext, "pdf")
            print(f"    ✅ PDF ready: {os.path.relpath(pdf_out)}")

        if need_txt:
            print(f"    🧠 OCR → TXT …")
            run_tesseract(tif_path, out_base_tmp_no_ext, OCR_LANGS, "txt", "TXT")
            finalize_output(base, out_base_tmp_no_ext, "txt")
            print(f"    ✅ TXT ready: {os.path.relpath(txt_out)}")

        write_done_sentinel(base)
        dt = time.time() - t0
        print(f"    ✔ DONE {pdf_key} in {dt:.1f}s")
        return f"done: {pdf_key} ({dt:.1f}s)"
    except Exception as e:
        return f"ERROR {pdf_key}: {e}"
    finally:
        try:
            shutil.rmtree(workdir, ignore_errors=True)
        except Exception:
            pass


def main():
    banner()

    if not os.path.exists(TESSERACT_EXE):
        print("❌ Tesseract EXE not found. Update TESSERACT_EXE at the top.")
        sys.exit(1)

    if not BASE_PREFIX.endswith("/"):
        print("❌ BASE_PREFIX must end with '/'.")
        sys.exit(2)

    region = REGION_OVERRIDE or bucket_region(S3_BUCKET)
    print(f"   Region : {region}")

    s3 = make_s3(region)
    os.makedirs(LOCAL_OUTDIR, exist_ok=True)

    keys = list(list_pdfs(s3, S3_BUCKET, BASE_PREFIX))
    total = len(keys)
    if total == 0:
        print("No PDFs found. Exiting.")
        return

    # Ctrl+C handling (let running tasks finish)
    interrupted = {"flag": False}
    def _sigint(_sig, _frm):
        print("\n🛑 Ctrl+C — finishing running tasks (no new submissions) …")
        interrupted["flag"] = True
    signal.signal(signal.SIGINT, _sigint)

    print(f"📨 Submitting {total} job(s) to {WORKERS} worker(s) …")

    from concurrent.futures import ProcessPoolExecutor

    start = time.time()
    counters: Dict[str, int] = {"done": 0, "skip_done": 0, "skip_pre": 0, "skip_exist": 0, "errors": 0}

    try:
        with ProcessPoolExecutor(max_workers=WORKERS) as ex:
            futures = [ex.submit(worker, k) for k in keys]
            for i, fut in enumerate(futures, 1):
                try:
                    msg = fut.result()  # no timeout -> no TimeoutError floods
                except KeyboardInterrupt:
                    print("\n🛑 Ctrl+C — stopping collection …")
                    raise
                except Exception as e:
                    msg = f"ERROR {e}"

                print(f"[{i}/{total}] {msg}")
                if msg.startswith("done(native):") or msg.startswith("done:"):
                    counters["done"] += 1
                elif msg.startswith("skip(done):"):
                    counters["skip_done"] += 1
                elif msg.startswith("skip(preflight):"):
                    counters["skip_pre"] += 1
                elif msg.startswith("skip(already both exist"):
                    counters["skip_exist"] += 1
                elif msg.startswith("ERROR"):
                    counters["errors"] += 1
                if interrupted["flag"]:
                    # Still let already-submitted futures finish; we’re just not submitting new ones anyway.
                    pass
    except KeyboardInterrupt:
        # Best-effort graceful exit; work already running will keep going until Python terminates.
        pass

    elapsed = time.time() - start
    print("\n================ SUMMARY ================")
    print(f"✅ done        : {counters['done']}")
    print(f"⏭  skip(done) : {counters['skip_done']}")
    print(f"⏭  skip(exist): {counters['skip_exist']}")
    print(f"⏭  skip(pre)  : {counters['skip_pre']}")
    print(f"💥 errors     : {counters['errors']}")
    print(f"⏱  elapsed    : {elapsed:.1f}s")
    print(f"📁 Output dir : {LOCAL_OUTDIR}")


if __name__ == "__main__":
    main()
