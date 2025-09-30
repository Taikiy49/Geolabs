# init_chat_db.py

import sqlite3
import os

# Ensure the uploads directory exists
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Full path to the DB in uploads/
db_path = os.path.join(UPLOAD_DIR, "chat_history.db")

# Create and connect
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Create chat_history table with db_name tracking
cur.execute("""
CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    question TEXT,
    answer TEXT,
    sources TEXT,
    timestamp TEXT,
    db_name TEXT
)
""")

conn.commit()
conn.close()
print(f"✅ chat_history.db initialized at {db_path}")
