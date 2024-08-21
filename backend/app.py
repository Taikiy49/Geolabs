from flask import Flask, send_from_directory, jsonify, request, session
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient, TEXT
from bson.objectid import ObjectId
import gridfs
import secrets
from model_building import Model
from model_functions import ParseFile, return_keywords
from flask_session import Session
from model_settings import get_uri
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import spacy
import os
from datetime import timedelta, datetime

# Global variables
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
app.config['SESSION_TYPE'] = 'filesystem'  # Use filesystem session storage
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)  # Session lifetime
Session(app)  # Initialize the session extension

CORS(app, resources={r"/*": {"origins": "https://geolabs.vercel.app"}})
login_manager = LoginManager(app)
login_manager.login_view = 'login'

print(get_uri())
client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)
users_db, pdf_data_db = client['UserProfile'], client['PDFData']

# Initialize GridFS
fs = gridfs.GridFS(pdf_data_db)

chat_session = None  # Initialize chat_session as a global variable
last_model_update = None  # Initialize last_model_update as a global variable

# Create a text index on the 'content' field in MongoDB
pdf_data_db.pdf_data.create_index([("content", TEXT)], default_language="english")

nlp = spacy.load('en_core_web_sm')

def save_to_db(filename, content):
    entry = {
        "filename": filename,
        "content": content,
        "last_updated": datetime.utcnow()
    }
    pdf_data_db.pdf_data.insert_one(entry)

class User(UserMixin):
    def __init__(self, user_id, email):
        self.id = user_id
        self.email = email

def get_filtered_documents(keywords_list):
    query = {"$text": {"$search": " ".join(keywords_list)}}
    filtered_documents = pdf_data_db.pdf_data.find(query, {"score": {"$meta": "textScore"}}).sort("score", {"$meta": "textScore"}).limit(20)
    documents = [{"filename": doc["filename"], "content": doc["content"]} for doc in filtered_documents]
    print("Top 5 matched files:")
    for doc in documents:
        print(doc["filename"])
    return documents

@login_manager.user_loader
def load_user(user_id):
    user = users_db.users.find_one({"_id": ObjectId(user_id)})
    if user:
        return User(str(user["_id"]), user["email"])
    return None

@app.route('/program-selection/build-resume', methods=['POST'])
def build_resume():
    data = request.get_json()

def extract_relevant_words(prompt):
    # Process the text using spaCy
    doc = nlp(prompt)
    relevant_words = []
    for token in doc:
        if token.pos_ in ["NOUN", "PROPN"]:  # Nouns and Proper Nouns
            relevant_words.append(token.text)
        elif token.ent_type_ in ["GPE", "LOC", "ORG"]:  # Locations, Geopolitical entities, Organizations
            relevant_words.append(token.text)
        elif token.like_num: 
            relevant_words.append(token.text)
    return relevant_words

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    model = Model()
    data = request.get_json()
    prompt = data.get('prompt')
    keywords_list = extract_relevant_words(prompt)
    print(keywords_list)
    filtered_documents = get_filtered_documents(keywords_list)
    history = model.create_chat_history(filtered_documents)
    chat_session = model.create_chat_session(history)
    response = model.generate_response(chat_session, prompt)
    return jsonify({"response": response.text})


@app.route('/program-selection/add-files', methods=['POST'])
def upload_file():
    files = request.files.getlist('files')
    processed_files = [entry['filename'] for entry in pdf_data_db.pdf_data.find()]

    def process_file(file):
        filename = file.filename
        if filename not in processed_files:
            sentences = ParseFile(file).generate_sentence_list()
            save_to_db(filename, sentences)
            print(filename + '  has been saved')
        else:
            print(f"File {filename} has already been processed.")

    with ThreadPoolExecutor() as executor:
        executor.map(process_file, files)

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

@app.route('/program-selection/list-files', methods=['GET'])
def list_files():
    files = list(pdf_data_db.pdf_data.find({}, {"filename": 1, "_id": 0}))
    return jsonify(files), 200

@app.route('/program-selection/remove-files', methods=['POST'])
def remove_files():
    filenames = request.json.get('filenames', [])
    
    # Remove files from GridFS and the database
    for filename in filenames:
        file_entry = pdf_data_db.pdf_data.find_one({"filename": filename})
        if file_entry:
            fs.delete(file_entry["_id"])
    
    result = pdf_data_db.pdf_data.delete_many({"filename": {"$in": filenames}})
    if result.deleted_count > 0:
        return jsonify({"message": f"{result.deleted_count} files removed successfully"}), 200
    else:
        return jsonify({"message": "No files were removed"}), 400


@app.route('/program-selection/search-filenames', methods=['POST'])
def search_filenames():
    data = request.get_json()
    prompt = data.get('prompt')
    keywords_list = extract_relevant_words(prompt)
    filtered_documents = get_filtered_documents(keywords_list)
    filenames = [doc["filename"] for doc in filtered_documents]
    return jsonify({"filenames": filenames})

@app.route('/program-selection/get-quick-view', methods=['POST'])
def get_quick_view():
    data = request.get_json()
    filename = data.get('filename')
    file_entry = pdf_data_db.pdf_data.find_one({"filename": filename})
    
    if file_entry:
        content = file_entry.get('content', [])
        prompt = request.json.get('prompt', '')
        keywords = extract_relevant_words(prompt)

        print(f"Extracted keywords: {keywords}")  # Debug: Show extracted keywords

        relevant_sentences = []
        sentences = content.split('.')  
        i = 0
        for keyword in keywords:
            print(keyword)
            if i > 3: break
            for sentence in sentences:
                if i > 3: break
                if keyword.lower() in sentence.lower():
                    relevant_sentences.append(sentence)
                    i += 1

        # Find sentences that contain any of the relevant keywords
        print(f"Relevant sentences: {relevant_sentences}")  # Debug: Show relevant sentences

        # Return the first 3 relevant sentences
        quick_view_content = " ".join(relevant_sentences[:3])
        return jsonify({"content": quick_view_content}), 200
    else:
        return jsonify({"message": "File not found"}), 404

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    
    # THIS IS TEMPORARY FOR TESTING PURPOSES
    if email not in ["taikiy49@gmail.com", "jason@geolabs.net", "ryang@geolabs.net", "lola@geolabs.net"]:
        return jsonify({"message": "THIS PROGRAM IS CURRENTLY RESTRICTED TO TAIKI AND 3 OTHERS"}), 400

    if users_db.users.find_one({"email": email}):
        return jsonify({"message": "Email already registered"}), 400
    
    users_db.users.insert_one({"email": email, "password": password})
    return jsonify({"message": "User registered successfully"}), 200

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data['email']
    password = data['password']
    user = users_db.users.find_one({"email": email})
    if user and check_password_hash(user['password'], password):
        login_user(User(str(user["_id"]), user["email"]))
        session.permanent = True  # Make the session permanent
        return jsonify({"message": "Logged in successfully", "token": session['_id']}), 200
    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)

