from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile


app = Flask(__name__)
CORS(app)

@app.route('/programs', methods=['GET'])
def get_programs():
    programs = ['Search Files', '...']
    return jsonify(programs)

@app.route('/sendInput', methods=['POST'])
def send_input():
    data = request.get_json()
    user_input = data.get('input')
    print(user_input)
    return jsonify(f"Received input: {user_input}")

@app.route('/upload', methods=['POST'])
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

        with open(file_path, 'r') as f:
            print('---', file_path, '---')
            print(f.readlines())

    return jsonify({'message': 'Files uploaded successfully', 'file_paths': file_paths}), 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)
