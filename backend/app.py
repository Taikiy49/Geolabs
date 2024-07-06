from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from query import run_query
from update_database import run_update_database

app = Flask(__name__)
CORS(app)

# Ensure the directory exists
UPLOAD_FOLDER = 'test_files'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(prompt)
    return jsonify(output)

@app.route('/program-selection/update-database', methods=['POST'])
def upload_file():
    if 'files' not in request.files:
        return jsonify({'error': 'No files part in the request'}), 400

    files = request.files.getlist('files')
    file_paths = []
    for file in files:
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)
        file_paths.append(file_path)

    run_update_database()
    return jsonify({'message': 'Files uploaded successfully', 'file_paths': file_paths}), 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)
