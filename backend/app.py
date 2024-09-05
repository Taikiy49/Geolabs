from flask import Flask, jsonify, request, session
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import secrets
from model_building import Model
from model_functions import ParseFile
from flask_session import Session
from concurrent.futures import ThreadPoolExecutor
import spacy
from spacy.matcher import Matcher
from datetime import timedelta, datetime
import functools
from werkzeug.utils import secure_filename
from terms import oahu_cities, civil_engineering_terms
import os
from file_handler import open_series_directories, handle_file_request
import re


""" This is used to create the pyinstaller application

    python -m PyInstaller --onefile --add-data "C:\\Users\\tyamashita\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python311\\site-packages\\en_core_web_sm;en_core_web_sm" --add-data "backend/data.db;backend" backend/app.py

"""

# Initialize Flask app and configure session
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)
Session(app)

CORS(app, resources={r"/*": {"origins": ["https://geolabs.vercel.app", "http://localhost:3000"]}})
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Initialize Spacy
nlp = spacy.load('en_core_web_sm')
print(spacy.util.get_package_path('en_core_web_sm'))

# SQLite Database Initialization
import os
import sqlite3

# Get the base directory of the current script
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Define the path to the database file relative to the script location
DB_PATH = os.path.join(BASE_DIR, 'data.db')

# SQLite Database Initialization
def init_sqlite_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            content TEXT,
            last_updated TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_sqlite_db()

# Similarly, update all other references to use DB_PATH instead of hardcoded strings


# Save file content to SQLite
def save_to_db(filename, content):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO documents (filename, content, last_updated)
        VALUES (?, ?, ?)
    ''', (filename, content, datetime.utcnow()))
    conn.commit()
    conn.close()

# Function to check for an exact word match using regular expressions
def match_exact_word(phrase, content):
    pattern = r'\b' + re.escape(phrase) + r'\b'  # Use word boundaries for exact match
    return re.search(pattern, content, re.IGNORECASE) is not None

def extract_and_rank_keywords(prompt):
    doc = nlp(prompt)
    matcher = Matcher(nlp.vocab)

    patterns = [
        [{"POS": "PROPN"}],
        [{"IS_DIGIT": True}, {"IS_PUNCT": True}, {"IS_DIGIT": True}],  # Work order pattern like "7860-00"
        [{"POS": "ADJ"}, {"POS": "NOUN"}],  # Adjective + Noun (e.g., "boring holes")
        [{"POS": "NOUN"}, {"POS": "NOUN"}],  # Noun + Noun (e.g., "project details")
        [{"POS": "NOUN"}]  # Single Noun (e.g., "holes")
    ]

    matcher.add("KEY_PHRASES", patterns)
    matches = matcher(doc)

    relevant_phrases = []
    for match_id, start, end in matches:
        span = doc[start:end]
        relevant_phrases.append(span.text)

    # Rank phrases based on custom heuristics
    def rank_phrase(phrase):
        if any(char.isdigit() for char in phrase) and '-' in phrase:
            return (5, phrase)  # High priority for work orders
        elif phrase in oahu_cities:
            return (4, phrase)  # Highest priority for locations
        elif phrase in civil_engineering_terms:
            return (3, phrase)
        elif len(phrase.split()) > 1:
            return (2, phrase)  # Medium priority for multi-word phrases
        else:
            return (1, phrase)  # Lowest priority for single words

    ranked_phrases = sorted(relevant_phrases, key=rank_phrase, reverse=True)
    return ranked_phrases

def extract_keywords_with_logic(prompt):
    parts = []
    buffer = []
    i = 0

    while i < len(prompt):
        if prompt[i:i + 3].upper() == "AND":
            if buffer:
                parts.append(''.join(buffer).strip())
            parts.append("AND")
            buffer = []
            i += 3
        elif prompt[i:i + 2].upper() == "OR":
            if buffer:
                parts.append(''.join(buffer).strip())
            parts.append("OR")
            buffer = []
            i += 2
        else:
            buffer.append(prompt[i])
            i += 1

    if buffer:
        parts.append(''.join(buffer).strip())

    # Extract individual keywords and phrases
    keywords_with_logic = []
    for part in parts:
        if part in {"AND", "OR"}:
            keywords_with_logic.append(part)
        else:
            keywords = extract_and_rank_keywords(part)
            keywords_with_logic.extend(keywords)

    return keywords_with_logic

def get_filtered_documents(keywords_list):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    query = "SELECT filename, content FROM documents"
    cursor.execute(query)
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    # Filter documents based on exact word matches
    filtered_documents = []
    for doc in documents:
        content = doc["content"]
        if any(match_exact_word(keyword, content) for keyword in keywords_list):
            filtered_documents.append(doc)

    return filtered_documents

def get_filtered_documents_with_logic(keywords_with_logic):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    query = "SELECT filename, content FROM documents WHERE "
    query_parts = []
    params = []

    # Ensure the list does not start or end with "AND" or "OR"
    if keywords_with_logic and (keywords_with_logic[0] in {"AND", "OR"}):
        keywords_with_logic = keywords_with_logic[1:]
    if keywords_with_logic and (keywords_with_logic[-1] in {"AND", "OR"}):
        keywords_with_logic = keywords_with_logic[:-1]

    # Build the SQL query dynamically based on "AND" and "OR" logic
    for keyword in keywords_with_logic:
        if keyword == "AND":
            query_parts.append("AND")
        elif keyword == "OR":
            query_parts.append("OR")
        else:
            query_parts.append("content LIKE ?")
            params.append(f'%{keyword}%')

    final_query = query + ' '.join(query_parts)
    print(f"Executing query: {final_query} with params {params}")

    if "content LIKE ?" in final_query:
        cursor.execute(final_query, params)
        documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    else:
        documents = []

    conn.close()
    return documents

class User(UserMixin):
    def __init__(self, user_id, email):
        self.id = user_id
        self.email = email

@login_manager.user_loader
def load_user(user_id):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return User(user[0], user[1])
    return None

@functools.lru_cache(maxsize=100)
def get_summary_from_model(work_order_number, combined_content):
    model = Model('reports')
    chat_session = model.create_chat_session([])
    summary = model.generate_summary(chat_session, combined_content)
    return summary.text

def generate_all_forms(word):
    forms = set()
    doc = nlp(word)
    forms.add(word)
    lemma = doc[0].lemma_
    forms.add(lemma)

    if word.endswith('s') and not word.endswith('ss'):
        singular = lemma if lemma.endswith('y') else word[:-1]
        forms.add(singular)
    else:
        plural = lemma + 's'
        forms.add(plural)

    return forms

# Define routes
@app.route('/reports/search-database', methods=['POST'])
def send_input():
    model = Model('reports')
    data = request.get_json()
    prompt = data.get('prompt')
    keywords_list = extract_and_rank_keywords(prompt)
    filtered_documents = get_filtered_documents(keywords_list)
    history = model.create_chat_history(filtered_documents)
    chat_session = model.create_chat_session(history)
    response = model.generate_response(chat_session, prompt).text
    return jsonify({"response": response})

@app.route('/reports/add-files', methods=['POST'])
def upload_file():
    files = request.files.getlist('files')
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT filename FROM documents')
    processed_files = [row[0] for row in cursor.fetchall()]
    conn.close()

    def process_file(file):
        filename = file.filename
        if filename not in processed_files:
            sentences = ParseFile(file).generate_sentence_list()
            save_to_db(filename, sentences)
            print(f'{filename} has been saved')
        else:
            print(f"File {filename} has already been processed.")

    with ThreadPoolExecutor() as executor:
        executor.map(process_file, files)

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

@app.route('/reports/list-files', methods=['GET'])
def list_files():
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT filename FROM documents')
    files = [{"filename": row[0]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(files), 200

@app.route('/reports/remove-files', methods=['POST'])
def remove_files():
    filenames = request.json.get('filenames', [])
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.executemany('DELETE FROM documents WHERE filename = ?', [(filename,) for filename in filenames])
    conn.commit()
    conn.close()
    print(f"{len(filenames)} files were removed.")
    return jsonify({"message": f"{len(filenames)} files removed successfully"}), 200

@app.route('/reports/search-filenames', methods=['POST'])
def search_filenames():
    data = request.get_json()
    prompt = data.get('prompt')
    keywords_with_logic = extract_keywords_with_logic(prompt)
    filtered_documents = get_filtered_documents_with_logic(keywords_with_logic)
    filenames = [doc["filename"] for doc in filtered_documents]
    return jsonify({"filenames": filenames})

@app.route('/reports/get-quick-view', methods=['POST'])
def get_quick_view():
    data = request.get_json()
    filename = data.get('filename')
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT content FROM documents WHERE filename = ?', (filename,))
    file_entry = cursor.fetchone()
    conn.close()

    if file_entry:
        content = file_entry[0]
        prompt = request.json.get('prompt', '')
        keywords = extract_and_rank_keywords(prompt)
        relevant_sentences = []
        sentences = content.split('.')
        i = 0
        for keyword in keywords:
            if i > 3:
                break
            for sentence in sentences:
                if i > 3:
                    break
                if keyword.lower() in sentence.lower():
                    relevant_sentences.append(sentence)
                    i += 1

        quick_view_content = " ".join(relevant_sentences[:3])
        return jsonify({"content": quick_view_content}), 200
    else:
        return jsonify({"message": "File not found"}), 404

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')

    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        return jsonify({"message": "Email already registered"}), 400

    cursor.execute('''
        INSERT INTO users (email, password)
        VALUES (?, ?)
    ''', (email, password))
    conn.commit()
    conn.close()
    return jsonify({"message": "User registered successfully"}), 200

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data['email']
    password = data['password']

    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, password FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()

    if user and check_password_hash(user[1], password):
        login_user(User(user[0], email))
        session.permanent = True
        return jsonify({"message": "Logged in successfully", "token": session['_id']}), 200
    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully"}), 200

@app.route('/reports/search-work-order', methods=['POST'])
def search_work_order():
    data = request.get_json()
    work_order_number = data.get('workOrderNumber')
    if not work_order_number:
        return jsonify({"summary": "Work order number is required."}), 400

    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute("SELECT filename, content FROM documents WHERE filename LIKE ?", (f'%{work_order_number}%',))
    filtered_documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    if filtered_documents:
        combined_content = " ".join([doc["content"] for doc in filtered_documents])
        summary = get_summary_from_model(work_order_number, combined_content)
        return jsonify({"summary": summary, "filenames": [doc["filename"] for doc in filtered_documents]})
    else:
        return jsonify({"summary": "No relevant documents found for this work order number."}), 404

@app.route('/reports/relevancy', methods=['POST'])
def chatbot_request():
    data = request.get_json()
    filenames = data.get('filenames', [])
    prompt = data.get('prompt', '')
    use_file_selector = data.get('useFileSelector', True)

    if not use_file_selector:
        keywords_list = extract_and_rank_keywords(prompt)
        documents = get_filtered_documents(keywords_list)
        filenames = [doc["filename"] for doc in documents[:5]]

    if not filenames:
        return jsonify({"response": "No files selected or found."}), 400

    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT filename, content FROM documents WHERE filename IN ({','.join('?' * len(filenames))})",
        filenames
    )
    documents = cursor.fetchall()
    conn.close()

    model = Model('reports')
    history = model.create_chat_history([{"filename": doc[0], "content": doc[1]} for doc in documents])
    chat_session = model.create_chat_session(history)
    response = model.generate_response(chat_session, prompt).text

    return jsonify({"response": response})

# Employee Section
def init_employee_db():
    conn = sqlite3.connect('employee.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            content TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_employee_db()

@app.route('/employee-guide/upload-files', methods=['POST'])
def upload_employee_files():
    files = request.files.getlist('files')
    if not files:
        return jsonify({"message": "No files provided"}), 400

    conn = sqlite3.connect('employee.db')
    cursor = conn.cursor()

    for file in files:
        filename = secure_filename(file.filename)
        parsed_text = ParseFile(file).generate_sentence_list()
        cursor.execute('''
            INSERT INTO documents (filename, content)
            VALUES (?, ?)
        ''', (filename, ' '.join(parsed_text)))

    conn.commit()
    conn.close()

    return jsonify({"message": "Files uploaded and processed successfully"}), 200

persistent_chat_session = None

@app.route('/employee-guide/handbook-query', methods=['POST'])
def query_handbook():
    global persistent_chat_session

    model = Model('handbook')
    data = request.get_json()
    handbook_prompt = data.get('handbookPrompt')

    if not handbook_prompt:
        return jsonify({"response": "Query is required."}), 400

    if persistent_chat_session is None:
        conn = sqlite3.connect('employee.db')
        cursor = conn.cursor()
        cursor.execute('SELECT filename, content FROM documents')
        documents = cursor.fetchall()
        conn.close()
        history = [{"role": "user", "parts": [document[1]]} for document in documents]
        persistent_chat_session = model.create_chat_session(history)
    else:
        persistent_chat_session.history.append({"role": "user", "parts": [handbook_prompt]})

    response = model.generate_response(persistent_chat_session, handbook_prompt).text

    return jsonify({"response": response})

@app.route('/reports/open-file', methods=['POST'])
def open_file():
    try:
        data = request.get_json()
        filename = data.get('filename')
        print(f"Received filename: {filename}")
        network_path = r"\\geolabs.lan\fs\UserShare"
        open_series_directories(network_path, filename)
        return jsonify({'message': 'Filename processed successfully'}), 200
    except Exception as e:
        print(f"Error receiving filename: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
