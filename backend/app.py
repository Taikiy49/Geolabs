from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
from bson.objectid import ObjectId
import json
import PyPDF4
import os
from query import run_query
import secrets

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
CORS(app)


uri = "mongodb+srv://Taikiy49:Taikiy491354268097@geolabs.plekzlk.mongodb.net/?retryWrites=true&w=majority&appName=Geolabs"

# Create a new client and connect to the server
client = MongoClient(uri, tlsAllowInvalidCertificates=True)

# Select the UserProfile database
users_db = client['UserProfile']

login_manager = LoginManager(app)
login_manager.login_view = 'login'

JSON_FILE = 'pdf_data.json'

# Initialize the JSON file
def init_json():
    if not os.path.exists(JSON_FILE):
        with open(JSON_FILE, 'w') as f:
            json.dump([], f)

class ParseFile:
    def __init__(self, file):
        self._file = file

    def generate_sentence_list(self):
        sentence_list = []
        pdf_reader = PyPDF4.PdfFileReader(self._file)
        for page_num in range(pdf_reader.getNumPages()):
            page = pdf_reader.getPage(page_num)
            sentence_list.append(page.extractText().replace('\n', ''))
        return " ".join(sentence_list)

def save_to_json(filename, content):
    with open(JSON_FILE, 'r') as f:
        data = json.load(f)

    entry = {
        "role": "user",
        "parts": [filename],
    }
    data.append(entry)

    entry = {
        "role": "model",
        "parts": [content],
    }
    data.append(entry)

    with open(JSON_FILE, 'w') as f:
        json.dump(data, f, indent=4)

# User model
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

@app.route('/program-selection/search-database', methods=['POST'])
@login_required
def send_input():
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(prompt)
    return jsonify({"response": output})

@app.route('/program-selection/update-database', methods=['POST'])
@login_required
def upload_file():
    files = request.files.getlist('files')
    init_json()

    # Read the existing data
    with open(JSON_FILE, 'r') as f:
        data = json.load(f)

    processed_files = [entry['parts'][0] for entry in data if entry['role'] == 'user']

    for file in files:
        filename = file.filename

        if filename not in processed_files:
            sentences = ParseFile(file).generate_sentence_list()
            save_to_json(filename, sentences)
        else:
            print(f"File {filename} has already been processed.")

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')

    existing_users = users_db.users.find()
    for user in existing_users:
        print(f"Email: {user['email']}, Password: {user['password']}")
    
    if users_db.users.find_one({"email": email}):
        return jsonify({"message": "Email already registered"}), 400
    
    users_db.users.insert_one({"email": email, "password": password}).inserted_id
    return jsonify({"message": "User registered successfully"}), 200

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data['email']
    password = data['password']
    user = users_db.users.find_one({"email": email})
    if user and check_password_hash(user['password'], password):
        login_user(User(str(user["_id"]), user["email"]))
        return jsonify({"message": "Logged in successfully"}), 200
    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    try:
        logout_user()
        return jsonify({"message": "Logged out successfully"}), 200
    except Exception as e:
        print(f"Error during logout: {e}")
        return jsonify({"message": "Logout failed"}), 500

if __name__ == '__main__':
    app.run(debug=True)
