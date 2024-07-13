from dotenv import load_dotenv
import os
import google.generativeai as genai
import json
from pymongo import MongoClient

load_dotenv('.env')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

genai.configure(api_key=GEMINI_API_KEY)

generation_config = {
  "temperature": 1,
  "top_p": 0.95,
  "top_k": 64,
  "max_output_tokens": 8192,
  "response_mime_type": "text/plain",
}

model = genai.GenerativeModel(
  model_name="gemini-1.5-pro",
  generation_config=generation_config,
)

uri = "mongodb+srv://Taikiy49:Taikiy491354268097@geolabs.plekzlk.mongodb.net/?retryWrites=true&w=majority&appName=Geolabs"

# Create a new client and connect to the server
client = MongoClient(uri, tlsAllowInvalidCertificates=True)

# Select the UserProfile database
pdf_data_db = client['PDFData']

def load_data_from_db():
    data = []
    for document in pdf_data_db.pdf_data.find():
        data.append({"role": "user", "parts": [document['filename']]})
        data.append({"role": "model", "parts": [document['content']]})
    return data
 
# this will run when app.py is run
try:
  conversation_data = load_data_from_db()
  chat_session = model.start_chat(history=conversation_data)
except Exception as e:
  print(f'An error occurred: {e}')

def run_query(prompt):
  response = chat_session.send_message("Given just all the information I fed you earlier" + prompt + "ONLY give me answers that are related to the topic and keep it short!")
  return response.text.strip()
