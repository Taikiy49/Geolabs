import PyPDF4
import sqlite3

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
        pdf_reader = PyPDF4.PdfFileReader(self._file)
        for page_num in range(pdf_reader.getNumPages()):
            page = pdf_reader.getPage(page_num)
            sentence_list.append(page.extractText().replace('\n', ''))
        return sentence_list

def save_to_db(cursor, filename, content):
    print(filename)
    cursor.execute("INSERT OR IGNORE INTO pdf_files (filename, content) VALUES (?, ?)", (filename, content))
