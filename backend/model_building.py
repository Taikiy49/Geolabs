import google.generativeai as genai
import sqlite3
from model_settings import get_api_key, get_generation_config

class Model:
    def __init__(self):
        genai.configure(api_key=get_api_key())
        self._model = genai.GenerativeModel(model_name="gemini-1.5-flash", generation_config=get_generation_config())
        self._data_list = []
        self._trained_data_list = []

        # Initialize SQLite connection
        self._conn = sqlite3.connect('data.db')
        self._cursor = self._conn.cursor()

    def load_data_from_db(self):
        self._cursor.execute('SELECT filename, content FROM documents')
        rows = self._cursor.fetchall()
        for row in rows:
            self._data_list.append({"role": "user", "parts": [row[0]]})
            self._data_list.append({"role": "model", "parts": [row[1]]})
        return self._data_list
  
    def create_chat_session(self, _history):
        return self._model.start_chat(history=_history)

    def create_chat_history(self, documents):
        history = []
        for doc in documents:
            history.append({"role": "user", "parts": [doc['filename']]})
            history.append({"role": "model", "parts": [doc['content']]})
        return history

    def generate_response(self, chat_session, prompt):
        response = chat_session.send_message(
            "Given just all the information I fed you earlier, " + prompt + 
            "ONLY give me answers that are related to the topic",
        )
        return response

    def close(self):
        # Close the SQLite connection when done
        self._conn.close()

