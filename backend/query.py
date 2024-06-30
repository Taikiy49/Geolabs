from dotenv import load_dotenv
import os
import google.generativeai as genai
import json

load_dotenv('.env')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

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

def load_json_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

conversation_data = load_json_file('pdf_data_test.json')

chat_session = model.start_chat(
history=conversation_data
)

def run_query(prompt):
  response = chat_session.send_message("Given just all the information I fed you earlier" + prompt + "ONLY give me answers that are related to the topic and keep it short!")
  print(response.text)