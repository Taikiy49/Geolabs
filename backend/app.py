from datetime import timedelta, datetime
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient, TEXT
from bson.objectid import ObjectId
import gridfs
import secrets
from model_building import Model
from model_functions import ParseFile, run_query, return_keywords
from flask_session import Session
from model_settings import get_uri
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor

# Global variables
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
app.config['SESSION_TYPE'] = 'filesystem'  # Use filesystem session storage
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)  # Session lifetime
Session(app)  # Initialize the session extension

CORS(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)
users_db, pdf_data_db = client['UserProfile'], client['PDFData']

# Initialize GridFS
fs = gridfs.GridFS(pdf_data_db)

chat_session = None  # Initialize chat_session as a global variable
last_model_update = None  # Initialize last_model_update as a global variable

# Create a text index on the 'content' field in MongoDB
pdf_data_db.pdf_data.create_index([("content", TEXT)], default_language="english")

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
    filtered_documents = pdf_data_db.pdf_data.find(query, {"score": {"$meta": "textScore"}}).sort("score", {"$meta": "textScore"}).limit(5)
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

def save_to_db(filename, content):
    entry = {
        "filename": filename,
        "content": content,
        "last_updated": datetime.utcnow()
    }
    pdf_data_db.pdf_data.insert_one(entry)

@app.route('/program-selection/build-resume', methods=['POST'])
def build_resume():
    data = request.get_json()

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    model = Model()
    chat_session = model.get_chat_session() # initial prompt
    data = request.get_json()
    prompt = data.get('prompt')
    keywords_list = return_keywords(chat_session, prompt)
    # Fetch filtered documents using cached function
    filtered_documents = get_filtered_documents(tuple(keywords_list))
    chat_session = model.train_model_with_documents(filtered_documents)
    output = run_query(chat_session, prompt)
    return jsonify({"response": output})

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

if __name__ == '__main__':
    app.run(debug=True)
