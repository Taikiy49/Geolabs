# helpers.py
import re
import sqlite3
from collections import defaultdict, Counter
import math
import heapq
import requests
import os
from dotenv import load_dotenv
from transformers import AutoTokenizer, AutoModel
import torch

from difflib import SequenceMatcher
import google.generativeai as genai

load_dotenv()

MODEL_NAME = "BAAI/bge-base-en-v1.5"
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
embedding_model = AutoModel.from_pretrained(MODEL_NAME)

def compute_embedding(text):
    inputs = tokenizer([text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        outputs = embedding_model(**inputs)

    return outputs.last_hidden_state.mean(dim=1).squeeze().numpy()


MAUI_LOCATIONS = {"maui", "lahaina", "kahului", "kihei", "wailuku", "makawao", "kula", "pukalani", "upcountry"}
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

query_cache = {}  # key: (user, file, query), value: answer

def is_similar(q1, q2, threshold=0.92):
    return SequenceMatcher(None, q1.lower(), q2.lower()).ratio() >= threshold

def preprocess_query(query):
    return re.findall(r'\b\w+\b', query.lower())

def is_in_work_order_range(filename, min_wo, max_wo):
    match = re.match(r"(\d{4,5})", filename)
    if match:
        work_order = int(match.group(1))
        return min_wo <= work_order <= max_wo
    return True

import numpy as np


def rank_documents(query, db_path, min_wo=0, max_wo=99999, top_k=20):
    query_tokens = preprocess_query(query)

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}

        if db_path.endswith("reports.db") and "inverted_index" in tables:
            # TODO: Use TF-IDF based ranking for reports.db
            return []

        if "chunks" not in tables:
            raise Exception("❌ 'chunks' table not found in database.")

        cursor.execute("SELECT file, chunk, text, embedding FROM chunks")
        rows = cursor.fetchall()

        if not rows:
            return []

        texts = []
        embeddings = []
        file_chunk_pairs = []

        for file, chunk, text, emb_blob in rows:
            if not is_in_work_order_range(file, min_wo, max_wo):
                continue
            texts.append(text)
            embeddings.append(np.frombuffer(emb_blob, dtype=np.float32))
            file_chunk_pairs.append((file, chunk))

        if not embeddings:
            return []

        query_embedding = compute_embedding(query)

        scores = [np.dot(query_embedding, emb) / (np.linalg.norm(query_embedding) * np.linalg.norm(emb)) for emb in embeddings]

        ranked = sorted(zip(file_chunk_pairs, texts, scores), key=lambda x: x[2], reverse=True)[:top_k]

        return [
            {
                'file': file,
                'chunk': chunk,
                'score': round(score, 4),
                'text': text
            }
            for (file, chunk), text, score in ranked
        ]

def get_quick_view_sentences(file, query, db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    if "chunks" not in tables:
        raise Exception("❌ 'chunks' table not found in database.")

    cursor.execute("PRAGMA table_info(chunks)")
    columns = {col[1] for col in cursor.fetchall()}
    col = "text" if "text" in columns else "chunk"

    cursor.execute(f"SELECT {col} FROM chunks WHERE file = ?", (file,))
    rows = cursor.fetchall()

    full_text = " ".join(row[0] for row in rows if isinstance(row[0], str))
    print(f"🤖 Loaded {len(full_text.split())} words from {file}")

    return [full_text]

# Gemini model config
genai.configure(api_key=GEMINI_API_KEY)
gemini_model = genai.GenerativeModel("gemini-2.5-pro")


def ask_gemini_single_file(query, file_name, snippets, user='guest', use_cache=True, use_web=False):
    if not query:
        return "No query provided."
    if not snippets:
        return "No relevant content found for this file."

    cache_key = (user, file_name, query.strip().lower())

    if use_cache:
        for (cached_user, cached_file, cached_query), cached_answer in query_cache.items():
            if cached_user == user and cached_file == file_name and is_similar(query, cached_query):
                print(f"⚡ Cache hit for: '{query}' ≈ '{cached_query}'")
                return cached_answer

    prompt = f"""You are a helpful AI assistant. Please answer the user's question using the provided excerpt below.

**Requirements:**
- You do not need an introduction; just go straight to the point.
- Respond in **clear, readable Markdown**.
- Use **bold headings**, bullet points, and spacing to organize content.
- Bold any key phrases like "Work Order", "Policy", "Contact", "Deadline", or section names if mentioned.
- Keep paragraphs short and avoid large walls of text.
"""

    if use_web:
        prompt += "- You may also include relevant general knowledge if helpful.\n"

    prompt += f"""

---

**Question:**
{query}

**Excerpt from {file_name}:**
{chr(10).join(snippets)}

---

**Answer (in well-formatted Markdown):**
"""

    try:
        print("🧠 Gemini Prompt Preview:\n", prompt[:300])
        response = gemini_model.generate_content(prompt)
        answer = response.text.strip()

        if use_cache:
            query_cache[cache_key] = answer

        return answer

    except Exception as e:
        import traceback
        print("❌ Gemini SDK error:")
        traceback.print_exc()
        return f"Gemini SDK error: {str(e)}"

import os, sqlite3, threading, re

_DB_LOCK = threading.Lock()
_DB_CONN = None

REPORTS_DB = os.getenv("REPORTS_INDEX_DB", os.path.join(os.path.dirname(__file__), "data", "reports_index.db"))
S3_BUCKET = os.getenv("S3_BUCKET")

def get_reports_conn():
    global _DB_CONN
    if _DB_CONN is None:
        with _DB_LOCK:
            if _DB_CONN is None:
                os.makedirs(os.path.dirname(REPORTS_DB), exist_ok=True)
                _DB_CONN = sqlite3.connect(REPORTS_DB, check_same_thread=False)
                _DB_CONN.execute("PRAGMA journal_mode=WAL;")
    return _DB_CONN

SNIP_RE = re.compile(r"\s+")

def make_snippet(body: str, q: str, length=240):
    if not body:
        return ""
    ql = (q or "").strip().lower()
    if not ql:
        return body[:length].strip()
    idx = body.lower().find(ql)
    if idx == -1:
        return body[:length].strip()
    start = max(0, idx - length // 4)
    end = min(len(body), idx + len(ql) + length // 2)
    snippet = body[start:end]
    snippet = SNIP_RE.sub(" ", snippet)
    return snippet.strip()

def highlight(text: str, q: str):
    if not q or not text:
        return text
    try:
        return re.sub(f"({re.escape(q)})", r"<mark>\1</mark>", text, flags=re.IGNORECASE)
    except re.error:
        return text

