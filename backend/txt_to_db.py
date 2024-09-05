import os
import sqlite3

# Function to initialize the database (if it doesn't already exist)
def init_sqlite_db():
    try:
        conn = sqlite3.connect('data.db')
        cursor = conn.cursor()

        # Create 'documents' table if not exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                content TEXT,
                date TEXT
            )
        ''')

        conn.commit()
        conn.close()
        print("Database initialized successfully!")  # Debugging print statement
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")  # Print any SQLite errors

# Function to save the file content to the SQLite database
def save_to_db(filename, content, date):
    try:
        conn = sqlite3.connect('data.db')
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO documents (filename, content, date)
            VALUES (?, ?, ?)
        ''', (filename, content, date))
        conn.commit()
        conn.close()
        print(f"Saved: {filename} to the database.")  # Confirmation print statement
    except sqlite3.Error as e:
        print(f"Error saving {filename} to the database: {e}")

# Function to process all renamed files in the OCR_REPORTS folder
def process_all_files_in_folder(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.txt'):  # Only process .txt files
            file_path = os.path.join(folder_path, filename)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()

                # Extract date from the filename
                date = filename.split('.')[0]  # Assuming the date is the first part before the first dot

                # Extract the original filename by removing everything up to the first '.' and after the last '.'
                original_filename = '.'.join(filename.split('.')[1:-1])

                save_to_db(original_filename, content, date)

            except Exception as e:
                print(f"Error processing file {file_path}: {e}")

# Define the Path to the OCR_REPORTS Folder
desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Initialize the database
init_sqlite_db()

# Process all renamed files in the OCR_REPORTS folder
process_all_files_in_folder(ocr_reports_folder)
