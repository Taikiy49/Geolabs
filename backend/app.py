from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from pymongo import MongoClient
from bson.objectid import ObjectId
import PyPDF4
import secrets
from model_building import Model
from model_functions import ParseFile, run_query, save_to_db

# global variables (could fix this later for readability)
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(24)
CORS(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
model = Model()
chat_session = model.get_chat_session()
client = model._client
users_db, pdf_data_db = client['UserProfile'], client['PDFData']

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

@app.route('/program-selection/build-resume', methods=['POST'])
def build_resume():
    data = request.get_json()

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(chat_session, prompt)
    return jsonify({"response": output})

@app.route('/program-selection/update-database', methods=['POST'])
def upload_file():
    files = request.files.getlist('files')

    processed_files = [entry['filename'] for entry in pdf_data_db.pdf_data.find()]

    for file in files:
        filename = file.filename

        if filename not in processed_files:
            sentences = ParseFile(file).generate_sentence_list()
            save_to_db(filename, sentences)
        else:
            print(f"File {filename} has already been processed.")

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    
    # THIS IS TEMMPORARY FOR TESTING PURPOSES
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
