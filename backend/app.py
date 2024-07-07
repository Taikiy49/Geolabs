from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import PyPDF4
from query import run_query

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

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

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(prompt)
    return jsonify({"response": output})

@app.route('/program-selection/update-database', methods=['POST'])
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

if __name__ == '__main__':
    app.run(debug=True)
