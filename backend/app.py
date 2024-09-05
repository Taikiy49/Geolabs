from flask import Flask, jsonify, request, session
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import secrets
from model import Model
from parse_files import ParseFile
from flask_session import Session
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime
import functools
from werkzeug.utils import secure_filename
from terms import oahu_cities, civil_engineering_terms
import os
from file_handler import open_series_directories, handle_file_request
import re
import spacy

# Initialize spaCy model
nlp = spacy.load("en_core_web_sm")

# Initialize Flask app and configure session
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)
Session(app)

CORS(app, resources={r"/*": {"origins": ["https://geolabs.vercel.app", "http://localhost:3000"]}})
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Function to extract dates from text content
def extract_date(text):
    date_patterns = [
        r'(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})',  
        r'([A-Za-z]+\s+\d{1,2},\s*\d{4})',    
        r'([A-Za-z]+\s+\d{1,2}[\s,\']+\d{4})' 
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            date_str = match.group(0)
            try:
                if re.match(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}', date_str):
                    date_obj = datetime.strptime(date_str, '%m/%d/%Y')
                else:
                    date_obj = datetime.strptime(date_str, '%B %d, %Y')
                return date_obj.strftime('%m-%d-%Y')
            except ValueError:
                continue
    return 'Unknown'

# SQLite Database Initialization
def init_sqlite_db():
    try:
        conn = sqlite3.connect('data.db')
        cursor = conn.cursor()
        print("Creating tables...")

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
                filename TEXT UNIQUE,
                content TEXT,
                date TEXT
            )
        ''')

        conn.commit()
        conn.close()
        print("Tables created successfully!")
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")

init_sqlite_db()

def save_to_db(filename, content):
    submission_date = extract_date(content)
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM documents WHERE filename = ?', (filename,))
    if cursor.fetchone() is not None:
        print(f"{filename} has already been processed. Skipping...")
        conn.close()
        return

    cursor.execute('''
        INSERT INTO documents (filename, content, date)
        VALUES (?, ?, ?)
    ''', (filename, content, submission_date))
    conn.commit()
    conn.close()
    print(f"Saved: {filename} with date {submission_date} to the database.")

def process_all_files_in_folder(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.txt'):
            file_path = os.path.join(folder_path, filename)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()
                save_to_db(filename, content)
            except Exception as e:
                print(f"Error processing file {file_path}: {e}")

desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# MAKE THIS LIKE A REFRESH BUTTON LATER COMMENTING OUT FOR NOW CUZ NO NEED
# process_all_files_in_folder(ocr_reports_folder)

def extract_and_rank_keywords(prompt):
    doc = nlp(prompt)
    keywords = []
    for token in doc:
        if token.text in oahu_cities or token.text in civil_engineering_terms:
            keywords.append(token.text)
        elif token.pos_ in ['NOUN', 'PROPN', 'ADJ'] and len(token.text) > 2:
            keywords.append(token.text)
    return keywords

def extract_keywords_with_logic(prompt):
    doc = nlp(prompt)
    parts = []
    buffer = []
    for token in doc:
        if token.text.lower() in ['and', 'or']:
            if buffer:
                parts.append(' '.join(buffer).strip())
            parts.append(token.text.upper())
            buffer = []
        else:
            buffer.append(token.text)
    if buffer:
        parts.append(' '.join(buffer).strip())

    keywords_with_logic = []
    for part in parts:
        if part in {"AND", "OR"}:
            keywords_with_logic.append(part)
        else:
            keywords = extract_and_rank_keywords(part)
            keywords_with_logic.extend(keywords)

    return keywords_with_logic

def match_exact_word(phrase, content):
    pattern = r'\b' + re.escape(phrase) + r'\b'  # Use word boundaries for exact match
    return re.search(pattern, content, re.IGNORECASE) is not None

def get_filtered_documents(keywords_list):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    query = "SELECT filename, content FROM documents"
    cursor.execute(query)
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

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

    if keywords_with_logic and (keywords_with_logic[0] in {"AND", "OR"}):
        keywords_with_logic = keywords_with_logic[1:]
    if keywords_with_logic and (keywords_with_logic[-1] in {"AND", "OR"}):
        keywords_with_logic = keywords_with_logic[:-1]

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
    forms.add(word)

    if word.endswith('s') and not word.endswith('ss'):
        singular = word[:-1]
        forms.add(singular)
    else:
        plural = word + 's'
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
