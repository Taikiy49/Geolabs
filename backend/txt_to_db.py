import os
import sqlite3

# # Function to initialize the database with FTS5 (if it doesn't already exist)
# def init_sqlite_db():
#     try:
#         conn = sqlite3.connect('data.db')
#         cursor = conn.cursor()

#         # Create FTS5 virtual table for documents
#         cursor.execute('''
#             CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
#                 filename,
#                 content,
#                 date
#             )
#         ''')

#         conn.commit()
#         conn.close()
#         print("Database initialized successfully!")  # Debugging print statement
#     except sqlite3.Error as e:
#         print(f"An error occurred: {e}")  # Print any SQLite errors

# # Function to save the file content to the SQLite database
# def save_to_db(filename, content, date):
#     try:
#         conn = sqlite3.connect('data.db')
#         cursor = conn.cursor()
        
#         # Check if the file already exists in the database
#         cursor.execute('SELECT rowid FROM documents WHERE filename = ?', (filename,))
#         if cursor.fetchone() is not None:
#             print(f"File {filename} already exists in the database. Skipping...")  # If exists, skip the insertion
#             conn.close()
#             return

#         cursor.execute('''
#             INSERT INTO documents (filename, content, date)
#             VALUES (?, ?, ?)
#         ''', (filename, content, date))
#         conn.commit()
#         conn.close()
#         print(f"Saved: {filename} to the database.")  # Confirmation print statement
#     except sqlite3.Error as e:
#         print(f"Error saving {filename} to the database: {e}")

# # Function to process all renamed files in the OCR_REPORTS folder
# def process_all_files_in_folder(folder_path):
#     for filename in os.listdir(folder_path):
#         if filename.endswith('.txt'):  # Only process .txt files
#             file_path = os.path.join(folder_path, filename)
#             try:
#                 with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
#                     content = file.read()

#                 # Use the entire filename including numbers and other parts
#                 save_to_db(filename, content, filename.split('.')[0])  # Save the filename and extract the date

#             except Exception as e:
#                 print(f"Error processing file {file_path}: {e}")

# Function to search documents using FTS5
def search_documents(search_query):
    conn = sqlite3.connect('data.db')
    cursor = conn.cursor()

    # Perform a full-text search using FTS5 MATCH
    query = "SELECT filename, content FROM documents WHERE content MATCH ?"
    cursor.execute(query, (search_query,))
    results = [{"filename": row[0], "content": row[1]} for row in cursor.fetchall()]
    conn.close()

    # Print the search results
    for result in results:
        print(f"Filename: {result['filename']}")
        print(f"Content Snippet: {result['content'][:200]}")  # Show a snippet of the content
        print("-" + "-"*20)

    return results

# # Define the Path to the OCR_REPORTS Folder
# desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
# ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# # Initialize the database
# init_sqlite_db()

# # Process all renamed files in the OCR_REPORTS folder
# process_all_files_in_folder(ocr_reports_folder)

# Example search query
search_query = "engineering AND oahu"
search_results = search_documents(search_query)
