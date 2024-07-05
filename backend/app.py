from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import json

app = Flask(__name__)
CORS(app)

def run_query(user_input):
    file_path = 'pdf_data_test.json'
    
    # Check if the file exists
    if not os.path.exists(file_path):
        # Create an empty JSON file if it doesn't exist
        with open(file_path, 'w') as f:
            json.dump([], f)
    
    # Load the JSON data
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    # Implement your query logic here, for now, let's just return the data
    # filtered by user_input if it exists in any of the parts
    result = [entry for entry in data if user_input.lower() in entry['parts'][0].lower()]
    
    return result

@app.route('/programs', methods=['GET'])
def get_programs():
    programs = ['Search Files', '...']
    return jsonify(programs)

@app.route('/search-database', methods=['POST'])
def send_input():
    data = request.get_json()
    user_input = data.get('input')
    output = run_query(user_input)
    return jsonify(output)

@app.route('/update-database', methods=['POST'])
def upload_file():
    if 'files' not in request.files:
        return jsonify({'error': 'No files part in the request'}), 400

    files = request.files.getlist('files')
    file_paths = []
    for file in files:
        temp_dir = tempfile.mkdtemp()
        file_path = os.path.join(temp_dir, file.filename)
        file.save(file_path)
        file_paths.append(file_path)

    return jsonify({'message': 'Files uploaded successfully', 'file_paths': file_paths}), 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)
