import google.generativeai as genai
import sqlite3
from model_settings import get_api_key, get_generation_config

class Model:
    def __init__(self):
        genai.configure(api_key=get_api_key())
        self._model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            generation_config=get_generation_config(),
            system_instruction=(
                "You will be contextualized with up to 10 files relating to geotechnical projects. "
                "The initial input for contextualization will include the filename of each report, "
                "which contains the work order number. This work order number is a crucial identifier for each project. "
                "The content of each report follows, providing detailed information about the project. "
                "You are required to answer questions strictly based on the content of the files that have been contextualized to you. "
                "\n\n"
                "When responding to a user's query, follow these guidelines:\n"
                "1. Ensure that your answer is accurate, concise, and directly references the information found in the reports.\n"
                "2. Always cite the specific file and work order number where the information was sourced.\n"
                "3. Use the following format for your responses:\n"
                "\t- **Project Name (Work Order Number)**: 'Relevant content or findings from the report.'\n"
                "4. If the information requested is not available in the provided reports, clearly state that the requested information cannot be found.\n"
                "\n"
                "Example response:\n"
                "\t- **Foundation Analysis Report (WO-1234-56)**: 'The soil bearing capacity was determined to be 1500 psf based on the boring logs and lab tests.'"
            ),
        )
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
  
    def create_chat_session(self, history):
        return self._model.start_chat(history=history)

    def create_chat_history(self, documents):
        history = []
        for doc in documents:
            history.append({"role": "user", "parts": [doc['filename']]})
            history.append({"role": "model", "parts": [doc['content']]})
        return history

    def generate_response(self, chat_session, prompt):
        response = chat_session.send_message(prompt)
        return response

    def generate_summary(self, chat_session, content):
        response = chat_session.send_message(
            content + " Given all this information, generate a concise and comprehensive summary of the text.")
        return response

    def close(self):
        # Close the SQLite connection when done
        self._conn.close()
