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
import json
from difflib import SequenceMatcher 
import os

CACHE_FILE_PATH = 'cache.json'
CACHE_SIMILARITY_THRESHOLD = 0.8

# Load cache from a file if it exists
def load_cache_from_file():
    if os.path.exists(CACHE_FILE_PATH):
        with open(CACHE_FILE_PATH, 'r') as cache_file:
            return json.load(cache_file)
    return {}

# Save cache to a file
def save_cache_to_file():
    with open(CACHE_FILE_PATH, 'w') as cache_file:
        json.dump(cache, cache_file)

# Initialize cache by loading from the file
cache = load_cache_from_file()

# Function to calculate similarity between two strings
def is_similar(query1, query2):
    return SequenceMatcher(None, query1, query2).ratio() > CACHE_SIMILARITY_THRESHOLD

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

# SQLite Database Initialization
def init_sqlite_db():
    conn = sqlite3.connect('data.db')
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

# Save file content to SQLite
def save_to_db(filename, content):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO documents (filename, content, last_updated)
        VALUES (?, ?, ?)
    ''', (filename, content, datetime.utcnow()))
    conn.commit()
    conn.close()

# Get filtered documents from SQLite
def get_filtered_documents(keywords_list):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    # Build the query to search the content and prioritize based on specific patterns
    # Assuming the first keyword in the list is the highest priority (e.g., a work order number)
    high_priority_keyword = f'%{keywords_list[0]}%'  # High-priority keyword
    other_keywords = keywords_list[1:]  # Other keywords
    
    query = "SELECT filename, content FROM documents WHERE content LIKE ?"
    if other_keywords:
        query += " OR " + " OR ".join(["content LIKE ?" for _ in other_keywords])
    
    # Prepare parameters
    params = [high_priority_keyword] + [f'%{keyword}%' for keyword in other_keywords]

    # Prioritize high-priority keyword in ordering
    query += " ORDER BY CASE WHEN content LIKE ? THEN 1 ELSE 2 END, "
    query += " + ".join([f"(content LIKE ?)" for _ in keywords_list]) + " DESC"
    query += " LIMIT 20"  # Limit to top 20 results
    
    # Add high-priority keyword again to the parameters for ordering, then all keywords again
    params += [high_priority_keyword] + [f'%{keyword}%' for keyword in keywords_list]

    cursor.execute(query, params)
    documents = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    print("Top 20 matched files:")
    for doc in documents:
        print(doc["filename"])
    return documents



# Flask-Login User class and loader
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

# Extract relevant words using Spacy
def extract_and_rank_keywords(prompt):
    doc = nlp(prompt)
    matcher = Matcher(nlp.vocab)
    
    # Define patterns to capture key phrases
    patterns = [
        [{"POS": "PROPN"}], 
        [{"IS_DIGIT": True}, {"IS_PUNCT": True}, {"IS_DIGIT": True}],  # Work order pattern like "7860-00"
        [{"POS": "ADJ"}, {"POS": "NOUN"}],    # Adjective + Noun (e.g., "boring holes")
        [{"POS": "NOUN"}, {"POS": "NOUN"}],   # Noun + Noun (e.g., "project details")
        [{"POS": "NOUN"}]                     # Single Noun (e.g., "holes")
    ]
    
    matcher.add("KEY_PHRASES", patterns)
    matches = matcher(doc)
    
    relevant_phrases = []
    for match_id, start, end in matches:
        span = doc[start:end]
        relevant_phrases.append(span.text)
    
    # Rank phrases based on custom heuristics
    def rank_phrase(phrase):
        # Prioritize work order numbers or similar important patterns
        if any(char.isdigit() for char in phrase) and '-' in phrase:
            return (3, phrase)  # Highest priority
        elif len(phrase.split()) > 1:
            return (2, phrase)  # Medium priority for multi-word phrases
        else:
            return (1, phrase)  # Lowest priority for single words

    ranked_phrases = sorted(relevant_phrases, key=rank_phrase, reverse=True)

    return ranked_phrases

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    model = Model()
    data = request.get_json()
    prompt = data.get('prompt')

    # Check if a similar query is in the cache
    for cached_prompt, cached_response in cache.items():
        if is_similar(prompt, cached_prompt):
            print("Returning cached response.")
            return jsonify({"response": cached_response})

    # Process new query
    keywords_list = extract_and_rank_keywords(prompt)
    print(keywords_list)
    filtered_documents = get_filtered_documents(keywords_list)
    history = model.create_chat_history(filtered_documents)
    chat_session = model.create_chat_session(history)
    response = model.generate_response(chat_session, prompt).text

    # Store the response in the cache
    cache[prompt] = response
    save_cache_to_file()  # Save the cache to the file after adding the new entry

    return jsonify({"response": response})

@app.route('/program-selection/add-files', methods=['POST'])
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
            print(filename + ' has been saved')
        else:
            print(f"File {filename} has already been processed.")

    with ThreadPoolExecutor() as executor:
        executor.map(process_file, files)

    # Invalidate the cache after adding new files
    cache.clear()
    save_cache_to_file()  # Save the cleared cache to the file

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

@app.route('/program-selection/list-files', methods=['GET'])
def list_files():
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.execute('SELECT filename FROM documents')
    files = [{"filename": row[0]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(files), 200

@app.route('/program-selection/remove-files', methods=['POST'])
def remove_files():
    filenames = request.json.get('filenames', [])
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()
    cursor.executemany('DELETE FROM documents WHERE filename = ?', [(filename,) for filename in filenames])
    conn.commit()
    conn.close()
    return jsonify({"message": f"{len(filenames)} files removed successfully"}), 200

@app.route('/program-selection/search-filenames', methods=['POST'])
def search_filenames():
    data = request.get_json()
    prompt = data.get('prompt')

    # Check cache for a similar query
    for cached_prompt, cached_response in cache.items():
        if is_similar(prompt, cached_prompt):
            print("Returning cached filenames from cache.")
            return jsonify({"filenames": cached_response})

    keywords_list = extract_and_rank_keywords(prompt)
    filtered_documents = get_filtered_documents(keywords_list)
    filenames = [doc["filename"] for doc in filtered_documents]

    # Store the filenames in the cache
    cache[prompt] = filenames
    save_cache_to_file()  # Save the cache to the file after adding the new entry

    return jsonify({"filenames": filenames})

# Save the cache before shutting down the app
import atexit
atexit.register(save_cache_to_file)


@app.route('/program-selection/get-quick-view', methods=['POST'])
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

        print(f"Extracted keywords: {keywords}")

        relevant_sentences = []
        sentences = content.split('.')
        i = 0
        for keyword in keywords:
            if i > 3: break
            for sentence in sentences:
                if i > 3: break
                if keyword.lower() in sentence.lower():
                    relevant_sentences.append(sentence)
                    i += 1

        print(f"Relevant sentences: {relevant_sentences}")

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
