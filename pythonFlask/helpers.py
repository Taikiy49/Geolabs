# helpers.py
import re
import sqlite3
from collections import defaultdict, Counter
import math
import google.generativeai as genai
import os

# Configure Gemini
if os.getenv("GEMINI_API_KEY"):
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
else:
    genai.configure(api_key="AIzaSyDqi4HACfmjzWp_8_yg0t_Q_xqu9HL5AQA")

model = genai.GenerativeModel("models/gemini-1.5-flash") 

MAUI_LOCATIONS = {"maui", "lahaina", "kahului", "kihei", "wailuku", "makawao", "kula", "pukalani", "upcountry"}


def get_system_instruction(chatbot_type):
    if chatbot_type == 'reports':
        return (
            "You are a geotechnical report assistant contextualized with up to 10 files. "
            "Always cite work order numbers and only use information found in those files."
        )
    elif chatbot_type == 'handbook':
        return (
            "You are GeoBot, the employee handbook assistant. Provide concise answers and cite section numbers."
        )
    return ""


def preprocess_query(query):
    return re.findall(r'\b\w+\b', query.lower())


def is_in_work_order_range(filename, min_wo, max_wo):
    match = re.match(r"(\d{4,5})", filename)
    if match:
        work_order = int(match.group(1))
        return min_wo <= work_order <= max_wo
    return False


def rank_documents(query, db_path, min_wo, max_wo, top_k=20):
    query_tokens = preprocess_query(query)
    tf = defaultdict(Counter)
    df = Counter()
    total_docs = 0

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(DISTINCT file) FROM inverted_index")
        total_docs = cursor.fetchone()[0]

        for token in query_tokens:
            cursor.execute("SELECT file, chunk_id, term_freq FROM inverted_index WHERE keyword = ?", (token,))
            for file, _, freq in cursor.fetchall():
                if is_in_work_order_range(file, min_wo, max_wo):
                    tf[file][token] += freq
                    df[token] += 1

        tfidf_scores = []
        for file, counts in tf.items():
            score = sum(counts[t] * (math.log((total_docs + 1)/(df[t] + 1)) + 1) for t in query_tokens)

            cursor.execute("SELECT chunk FROM chunks WHERE file = ? LIMIT 3", (file,))
            chunks = [row[0] for row in cursor.fetchall()]
            combined_text = "\n---\n".join(chunks)

            boost = 3 if any(loc in file.lower() for loc in MAUI_LOCATIONS) else 0
            if any(loc in combined_text.lower() for loc in MAUI_LOCATIONS):
                boost += 2

            tfidf_scores.append({
                'file': file,
                'chunk': combined_text,
                'score': round(score + boost, 3)
            })

    tfidf_scores.sort(key=lambda x: x['score'], reverse=True)
    print("\nTop Ranked Files:")
    for doc in tfidf_scores[:top_k]:
        print(f"- {doc['file']} (score: {doc['score']})")

    return tfidf_scores[:top_k]


def ask_gemini(query, ranked_chunks):
    sources = ""
    for i, doc in enumerate(ranked_chunks, 1):
        sources += f"[{i}] File: {doc['file']}\n{doc['chunk']}\n\n"

    prompt = f"""
You are a geotechnical engineer. Answer the user's question using only the excerpts below.

Instructions:
- Be specific, factual, and technical.
- Use only information provided below.
- Always cite the file(s) the answer comes from.
- If the answer is not found, say \"The provided reports do not contain this information.\"

Question: {query}

Report Excerpts:
{sources}

Final Answer (with citations):
"""
    response = model.generate_content(prompt, generation_config={
        "temperature": 0.2,
        "max_output_tokens": 1024
    })
    return response.text


def get_quick_view_sentences(filename, query, db_path):
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT chunk FROM chunks WHERE file = ?", (filename,))
        rows = cursor.fetchall()
    if not rows:
        return []
    content = " ".join(row[0] for row in rows)
    keywords = preprocess_query(query)
    sentences = re.split(r'[.!?]', content)
    matched = [s.strip() for s in sentences if any(k in s.lower() for k in keywords)]
    return matched[:3]
