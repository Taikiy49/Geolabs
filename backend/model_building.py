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
<<<<<<< HEAD
=======
        
        # Initialize Elasticsearch client
        self._es = Elasticsearch([{'host': 'localhost', 'port': 9200, 'scheme': 'http'}])

        # Create Elasticsearch index if it does not exist
        self.create_index('documents')

    def create_index(self, index_name):
        if not self._es.indices.exists(index=index_name):
            self._es.indices.create(index=index_name, body={
                'settings': {
                    'number_of_shards': 1,
                    'number_of_replicas': 0,
                    'analysis': {
                        'analyzer': {
                            'default': {
                                'type': 'standard'
                            }
                        }
                    }
                }
            })
>>>>>>> d3b779cd86d2b3c16f5d273d297649dc02b05afa

    def load_data_from_db(self):
        for document in self._pdf_data_db.pdf_data.find():
            self._data_list.append({"role": "user", "parts": [document['filename']]})
            self._data_list.append({"role": "model", "parts": [document['content']]})
<<<<<<< HEAD
        return self._data_list
  
    def get_chat_session(self):
        return self._model.start_chat(history=self._data_list)

    def train_model_with_documents(self, documents):
        self._data_list = []
        for document in documents:
            self._data_list.append({"role": "user", "parts": [document['filename']]})
            self._data_list.append({"role": "model", "parts": [document['content']]})
        return self._model.start_chat(history=self._data_list)
=======
            
            # Index document into Elasticsearch
            self._es.index(index='documents', id=document['_id'], body={
                'filename': document['filename'],
                'content': document['content']
            })
        return self._data_list

    def get_chat_session(self):
        print(self.load_data_from_db())
        return self._model.start_chat(history=self.load_data_from_db())
    
    def search_documents(self, query):
        res = self._es.search(index='documents', body={
            'query': {
                'match': {
                    'content': query
                }
            }
        })
        results = [hit['_source']['content'] for hit in res['hits']['hits']]
        return results
>>>>>>> d3b779cd86d2b3c16f5d273d297649dc02b05afa
