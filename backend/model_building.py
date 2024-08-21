import google.generativeai as genai
from pymongo import MongoClient
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
from model_settings import get_api_key, get_generation_config, get_uri

class Model:
    def __init__(self):
        genai.configure(api_key=get_api_key())
        self._model = genai.GenerativeModel(model_name="gemini-1.5-flash", generation_config=get_generation_config())
        self._client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)
        self._pdf_data_db = self._client['PDFData']
        self._data_list = []
        self._trained_data_list = []

    def load_data_from_db(self):
        for document in self._pdf_data_db.pdf_data.find():
            self._data_list.append({"role": "user", "parts": [document['filename']]})
            self._data_list.append({"role": "model", "parts": [document['content']]})
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
            "Given just all the information I fed you earlier" + prompt + 
            "ONLY give me answers that are related to the topic and keep it short!"
        )
        return response

