from flask import Flask, jsonify, request, session, send_from_directory
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
import webbrowser
import re
from file_handler import open_series_directories
import math


# Initialize Flask app and configure session
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)
Session(app)

CORS(app, resources={r"/*": {"origins": "*"}}) 
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# @app.route('/', defaults={'path': ''})
# @app.route('/<path:path>')
# def serve_react_app(path):
#     if path and os.path.exists(os.path.join(app.static_folder, path)):
#         return send_from_directory(app.static_folder, path)
#     return send_from_directory(app.static_folder, 'index.html')

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


def bm25_score(query, content, k1=1.5, b=0.75):
    content_words = content.split()
    query_words = query.split()

    # Calculate document length and average document length
    doc_length = len(content_words)
    avg_doc_length = doc_length  # Assuming each content is a separate document for simplicity

    # Calculate IDF for each query term
    idf_scores = {}
    for word in query_words:
        n_qi = sum(1 for doc in content_words if word in doc)
        idf_scores[word] = math.log((len(content_words) - n_qi + 0.5) / (n_qi + 0.5) + 1)

    # Calculate BM25 score
    score = 0
    for word in query_words:
        if word in content_words:
            tf = content_words.count(word)
            numerator = tf * (k1 + 1)
            denominator = tf + k1 * (1 - b + b * (doc_length / avg_doc_length))
            score += idf_scores[word] * numerator / denominator

    return score

def rank_documents_by_bm25(query, documents):
    document_scores = []

    for doc in documents:
        # BM25 Score
        bm25 = bm25_score(query, doc['content'])

        document_scores.append({'filename': doc['filename'], 'content': doc['content'], 'score': bm25})

    return sorted(document_scores, key=lambda x: x['score'], reverse=True)



def init_sqlite_db():
    try:
        conn = sqlite3.connect('data.db')
        cursor = conn.cursor()
        print("Creating tables...")

        # Create 'users' table if not exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        ''')

        # Create FTS5 virtual table for documents
        cursor.execute('''
            CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
                filename,
                content,
                date
            )
        ''')

        conn.commit()
        conn.close()
        print("Tables created successfully!")
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")



def save_to_db(filename, content):
    submission_date = extract_date(content)
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    
    cursor.execute('SELECT rowid FROM documents WHERE filename = ?', (filename,))
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


def extract_and_rank_keywords(prompt):
    """
    Extracts and ranks keywords from the prompt based on a simple heuristic:
    Matching city names or engineering terms or words longer than 2 letters.
    """
    words = re.findall(r'\b\w+\b', prompt)
    keywords = [word for word in words if word.lower() in oahu_cities or word.lower() in civil_engineering_terms or len(word) > 2]
    return keywords

def extract_keywords_with_logic(prompt):
    """
    Extracts keywords from the prompt and handles logical operators like AND/OR.
    """
    parts = re.split(r'\s+(and|or)\s+', prompt, flags=re.IGNORECASE)
    keywords_with_logic = []
    
    for part in parts:
        if part.strip().lower() in {"and", "or"}:
            keywords_with_logic.append(part.strip().upper())
        else:
            keywords = extract_and_rank_keywords(part)
            keywords_with_logic.extend(keywords)
    
    return keywords_with_logic

def match_exact_word(phrase, content):
    """
    Matches exact words only.
    """
    # Ensure that only exact matches of the word 'phrase' are found.
    pattern = r'\b' + re.escape(phrase) + r'\b'
    return re.findall(pattern, content, re.IGNORECASE)


def get_filtered_documents(keywords_list):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    # Use FTS5 MATCH syntax for fast full-text search
    query = "SELECT filename, content FROM documents WHERE content MATCH ?"
    query_string = ' OR '.join(f'"{kw}"' for kw in keywords_list)  # Properly quote each keyword for FTS5
    cursor.execute(query, (query_string,))
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    if not documents:
        return []

    # Exact word matching for filtering documents
    filtered_documents = []
    for doc in documents:
        content = doc["content"]
        matches_found = False

        for keyword in keywords_list:
            if match_exact_word(keyword, content):
                matches_found = True
                # Optionally, highlight matches in content
                content = re.sub(rf'\b{re.escape(keyword)}\b', f'<mark>{keyword}</mark>', content, flags=re.IGNORECASE)
        
        if matches_found:
            filtered_documents.append({"filename": doc["filename"], "content": content})

    # Rank documents using BM25 after filtering
    ranked_documents = rank_documents_by_bm25(' '.join(keywords_list), filtered_documents)
    return ranked_documents




def get_filtered_documents_with_logic(keywords_with_logic):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    # Start the query
    query = "SELECT filename, content FROM documents WHERE content MATCH ?"
    
    # Prepare FTS5 query with logical operators
    query_string = ' '.join(keywords_with_logic)
    
    print(f"Executing FTS5 query: {query} with query_string: {query_string}")

    cursor.execute(query, (query_string,))
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]

    filtered_documents = []
    for doc in documents:
        content = doc["content"]
        matches_found = False

        for keyword in keywords_with_logic:
            if keyword not in {"AND", "OR"}:
                if match_exact_word(keyword, content):
                    matches_found = True
                    # Optionally, highlight matches in content
                    content = re.sub(rf'\b{re.escape(keyword)}\b', f'<mark>{keyword}</mark>', content, flags=re.IGNORECASE)
        
        if matches_found:
            filtered_documents.append({"filename": doc["filename"], "content": content})

    conn.close()
    return filtered_documents




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
    response = model.generate_response_no_filenames(chat_session, prompt).text
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
    
    # Perform the search for filenames using the updated filtering function
    ranked_documents = get_filtered_documents(keywords_with_logic)
    
    # Extract filenames from the ranked documents
    filenames = [doc['filename'] for doc in ranked_documents]

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
    filenames = data.get('filenames', [])  # Get the selected filenames from the user's request
    prompt = data.get('prompt', '')
    use_file_selector = data.get('useFileSelector', True)

    if not use_file_selector:
        # Use keyword extraction if file selector is not being used
        keywords_list = extract_and_rank_keywords(prompt)
        documents = get_filtered_documents(keywords_list)
        filenames = [doc["filename"] for doc in documents[:5]]

    if not filenames:
        return jsonify({"response": "No files selected or found."}), 400

    # Fetch content for selected filenames only
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT filename, content FROM documents WHERE filename IN ({','.join('?' * len(filenames))})",
        filenames
    )
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    # Rank documents using BM25
    ranked_documents = rank_documents_by_bm25(prompt, documents)

    # Create chat history based on ranked documents
    model = Model('reports')
    history = model.create_chat_history(ranked_documents)
    chat_session = model.create_chat_session(history)

    # Pass the sorted filenames (by relevance) to the generate_response method
    response = model.generate_response(chat_session, prompt, [doc['filename'] for doc in ranked_documents]).text

    # Sort filenames by their BM25 score in descending order
    sorted_filenames = [doc['filename'] for doc in ranked_documents]

    return jsonify({"response": response, "ranked_filenames": sorted_filenames})


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

    response = model.generate_response_no_filenames(persistent_chat_session, handbook_prompt).text

    return jsonify({"response": response})

@app.route('/reports/open-file', methods=['POST'])
def open_file():
    try:
        # Retrieve the filename from the request
        data = request.get_json()
        filename = data.get('filename')
        print(f"Received filename: {filename}")

        # Define the network path
        network_path = r"\\geolabs.lan\fs\UserShare"
        
        # Call the open_series_directories function
        open_series_directories(network_path, filename)

        # Return success response
        return jsonify({'message': 'Filename processed successfully'}), 200
    except Exception as e:
        # Print and return error response
        print(f"Error receiving filename: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # webbrowser.open("http://localhost:8000")
    app.run(host='0.0.0.0', port=8000)
    