from datetime import timedelta, datetime
from flask import Flask, request, jsonify, session
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
from bson.objectid import ObjectId
import gridfs
import secrets
from model_building import Model
from model_functions import run_query
from flask_session import Session
from model_settings import get_uri
from model_functions import ParseFile  # Assuming the updated ParseFile class is in parse_file.py

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

class User(UserMixin):
    def __init__(self, user_id, email):
        self.id = user_id
        self.email = email

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
    chat_session = model.get_chat_session()
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(chat_session, prompt)
    return jsonify({"response": output})

@app.route('/program-selection/add-files', methods=['POST'])
def upload_file():
    files = request.files.getlist('files')
    processed_files = [entry['filename'] for entry in pdf_data_db.pdf_data.find()]

    for file in files:
        filename = file.filename

        if filename not in processed_files:
            # Process file with ParseFile class
            parser = ParseFile(file)
            cleaned_text = parser.generate_sentence_list()
            
            # Save the cleaned text to GridFS
            file_id = fs.put(cleaned_text.encode('utf-8'), filename=filename)
            save_to_db(filename, cleaned_text)
        else:
            print(f"File {filename} has already been processed.")

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

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    
    # THIS IS TEMPORARY FOR TESTING PURPOSES
    if email != "taikiy49@gmail.com" and email != "jason@geolabs.net" and email != "ryang@geolabs.net" and email != "lola@geolabs.net":
        return jsonify({"message": "THIS PROGRAM IS CURRENTLY RESTRICTED TO TAIKI AND 3 OTHERS"}), 400

    # REPLACE WITH THIS IN THE FUTURE
    # if not email.endswith('@geolabs.net'):
    #     return jsonify({"message": "Registration restricted to geolabs.net email addresses"}), 400

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
    app.run(debug=True)
