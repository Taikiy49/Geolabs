import PyPDF4
import os
import sqlite3
import json

# Initialize the database
def init_db():
    conn = sqlite3.connect('pdf_data.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS pdf_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE,
            content TEXT
        )
    ''')
    conn.commit()
    return conn, c

# Class to parse PDF file
class ParseFile:
    def __init__(self, file):
        self._file = file

    def generate_sentence_list(self):
        sentence_list = []
        with open(self._file, "rb") as f:
            pdf_reader = PyPDF4.PdfFileReader(f)
            for page_num in range(pdf_reader.getNumPages()):
                page = pdf_reader.getPage(page_num)
                sentence_list.append(page.extractText().replace('\n', ''))

        return sentence_list

def return_pdf_list(directory):
    return [os.path.join(directory, file) for file in os.listdir(directory) if file.endswith('.pdf')]

def save_to_db(cursor, filename, content):
    cursor.execute("INSERT OR IGNORE INTO pdf_files (filename, content) VALUES (?, ?)", (filename, content))


def run_update_database():
    directory = '/Users/taikiyamashita/Desktop/Geolabs/test_files'  # TEMPORARILY HARDCODED
    pdf_list = return_pdf_list(directory)
    
    conn, cursor = init_db()

    for file in pdf_list:
        filename = os.path.basename(file)
        cursor.execute("SELECT COUNT(*) FROM pdf_files WHERE filename=?", (filename,))
        if cursor.fetchone()[0] == 0:
            sentences = ParseFile(file).generate_sentence_list()
            content = " ".join(sentences)
            save_to_db(cursor, filename, content)
    
    conn.commit()
    conn.close()


    json_data = []
    conn, cursor = init_db()
    cursor.execute("SELECT filename, content FROM pdf_files")
    rows = cursor.fetchall()
    for row in rows:
        json_data.append({"role": "user", "parts": [row[0]]})
        json_data.append({"role": "model", "parts" : [row[1]]})
    

    with open("pdf_data_test.json", 'w', encoding='utf-8') as json_file:
        json.dump(json_data, json_file, ensure_ascii=False, indent=4)

