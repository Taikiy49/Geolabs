from flask import Flask, request, jsonify
import sqlite3
import PyPDF4
from query import run_query
from update_database import init_db, ParseFile, save_to_db

app = Flask(__name__)

@app.route('/program-selection/search-database', methods=['POST'])
def send_input():
    data = request.get_json()
    prompt = data.get('prompt')
    output = run_query(prompt)
    return jsonify(output)

@app.route('/program-selection/update-database', methods=['POST'])
def upload_file():
    print('hi')
    if 'files' not in request.files:
        print('oh')
        return jsonify({'error': 'No file part in the request'}), 400

    files = request.files.getlist('files')
    conn, cursor = init_db()

    for file in files:
        filename = file.filename
        cursor.execute("SELECT COUNT(*) FROM pdf_files WHERE filename=?", (filename,))
        if cursor.fetchone()[0] == 0:
            sentences = ParseFile(file).generate_sentence_list()
            content = " ".join(sentences)
            save_to_db(cursor, filename, content)

    conn.commit()
    conn.close()

    return jsonify({'message': 'Files uploaded and processed successfully'}), 200

if __name__ == '__main__':
    app.run(debug=True)
