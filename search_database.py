import sqlite3

# Initialize the database connection
def init_db():
    conn = sqlite3.connect('pdf_data.db')
    return conn, conn.cursor()

# Function to search for a keyword in the database
def search_in_db(cursor, keyword):
    cursor.execute("SELECT filename, content FROM pdf_files WHERE content LIKE ?", ('%' + keyword + '%',))
    return cursor.fetchall()

if __name__ == "__main__":
    conn, cursor = init_db()
    
    keyword = input("Enter keyword: ")
    
    # Search in the database
    results = search_in_db(cursor, keyword)
    if results:
        print("Keyword found in the following files:")
        for filename, content in results:
            print(f"File: {filename}")
            # Optional: Print sentences containing the keyword
            sentences = content.split('.')
            for sentence in sentences:
                if keyword in sentence:
                    print(f"  - {sentence.strip()}")
    else:
        print("Keyword not found in the database.")

    conn.close()
