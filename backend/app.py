from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import os
import json
import PyPDF4
from query import run_query

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
CORS(app)
db = SQLAlchemy(app)
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
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

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
    if User.query.filter_by(email=email).first():
        return jsonify({"message": "Email already registered"}), 400
    new_user = User(email=email, password=password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"message": "User registered successfully"}), 200

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data['email']
    password = data['password']
    user = User.query.filter_by(email=email).first()
    if user and check_password_hash(user.password, password):
        login_user(user)
        return jsonify({"message": "Logged in successfully"}), 200
    return jsonify({"message": "Invalid credentials"}), 401


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)
