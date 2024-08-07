import google.generativeai as genai
from pymongo import MongoClient
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
from model_settings import get_api_key, get_generation_config, get_uri

class Model:
    def __init__(self):
        genai.configure(api_key=get_api_key())
        self._model = genai.GenerativeModel(model_name="gemini-1.5-pro", generation_config=get_generation_config())
        self._client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)
        self._pdf_data_db = self._client['PDFData']
        self._data_list = []

    def load_data_from_db(self):
        for document in self._pdf_data_db.pdf_data.find():
            self._data_list.append({"role": "user", "parts": [document['filename']]})
            self._data_list.append({"role": "model", "parts": [document['content']]})
        return self._data_list
  
    def get_chat_session(self):
        return self._model.start_chat(history=[])

    def train_model_with_documents(self, documents):
        for document in documents:
            self._data_list.append({"role": "user", "parts": [document['filename']]})
            self._data_list.append({"role": "model", "parts": [document['content']]})
        
        # Using the updated _data_list to start a new chat session
        return self._model.start_chat(history=self._data_list)
