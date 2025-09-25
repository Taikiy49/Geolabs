import os, sqlite3, pathlib, re
from typing import List
import fitz  # PyMuPDF

# --- Base paths (use pathlib everywhere) ---
BASE = pathlib.Path(__file__).parent.resolve()

# Point these at your actual folders/files. Using Path + resolve() avoids surprises.
OCR_DIR = (BASE / ".." / "uploads" / "OCRed_reports").resolve()
DB_PATH  = (BASE / ".." / "uploads" / "reports.db").resolve()

CHUNK_SIZE = 1400
CHUNK_OVERLAP = 200

def read_text_for_pdf(pdf_path: pathlib.Path) -> str:
    txt_path = pdf_path.with_suffix(".txt")
    if txt_path.exists():
        return txt_path.read_text(encoding="utf-8", errors="ignore")
    # fallback: extract quickly from PDF (already OCRed)
    doc = fitz.open(str(pdf_path))
    parts = []
    for i in range(doc.page_count):
        parts.append(doc.load_page(i).get_text("text") or "")
    doc.close()
    return "\n".join(parts)

def chunk_text(t: str, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP) -> List[str]:
    t = re.sub(r"\s+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    tokens = list(t)
    chunks = []
    i = 0
    while i < len(tokens):
        j = min(len(tokens), i + size)
        chunk = "".join(tokens[i:j]).strip()
        if chunk:
            chunks.append(chunk)
        i = j - overlap
        if i < 0: i = 0
        if i >= len(tokens): break
    return chunks

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript("""
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  rel_path TEXT UNIQUE,
  abs_pdf_path TEXT,
  title TEXT,
  client TEXT,
  project TEXT,
  pages INTEGER DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER,
  chunk_ix INTEGER,
  content TEXT,
  FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  doc_id UNINDEXED,
  chunk_ix UNINDEXED,
  tokenize='porter'
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
""")
    conn.commit()
    return conn

def upsert_document(conn, rel_path: str, abs_pdf: str) -> int:
    parts = pathlib.Path(rel_path).parts
    title = pathlib.Path(rel_path).name
    client = parts[1] if len(parts) > 2 else None
    project = parts[2] if len(parts) > 3 else None

    conn.execute("""
INSERT INTO documents(rel_path, abs_pdf_path, title, client, project)
VALUES(?,?,?,?,?)
ON CONFLICT(rel_path) DO UPDATE SET abs_pdf_path=excluded.abs_pdf_path
""", (rel_path, abs_pdf, title, client, project))
    doc_id = conn.execute(
        "SELECT id FROM documents WHERE rel_path=?",
        (rel_path,)
    ).fetchone()[0]
    return doc_id

def index_pdf(conn, rel_pdf: str):
    abs_pdf = str((OCR_DIR / rel_pdf).resolve())
    doc_id = upsert_document(conn, rel_pdf, abs_pdf)
    # clear old chunks for idempotency
    conn.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
    conn.execute("DELETE FROM chunks_fts WHERE doc_id=?", (doc_id,))

    text = read_text_for_pdf((OCR_DIR / rel_pdf))
    chunks = chunk_text(text)
    for i, ch in enumerate(chunks):
        cur = conn.execute(
            "INSERT INTO chunks(doc_id, chunk_ix, content) VALUES(?,?,?)",
            (doc_id, i, ch)
        )
        chunk_id = cur.lastrowid
        conn.execute(
            "INSERT INTO chunks_fts(rowid, content, doc_id, chunk_ix) VALUES(?,?,?,?)",
            (chunk_id, ch, doc_id, i)
        )

def walk_reports() -> List[str]:
    rels = []
    for p in OCR_DIR.rglob("*.pdf"):
        rels.append(str(p.relative_to(OCR_DIR)).replace("\\","/"))
    return rels

def main():
    print(f"📁 OCR_DIR : {OCR_DIR}")
    print(f"🗄️  DB_PATH: {DB_PATH}")
    assert OCR_DIR.exists(), f"{OCR_DIR} not found"
    conn = init_db()
    rels = walk_reports()
    print(f"🔎 Found {len(rels)} PDFs to index")
    for rel in rels:
        print("Indexing:", rel)
        index_pdf(conn, rel)
        conn.commit()
    conn.close()
    print("✅ Done. DB at", DB_PATH)

if __name__ == "__main__":
    main()
