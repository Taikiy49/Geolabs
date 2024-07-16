from dotenv import load_dotenv
import os

def get_api_key(): # for security purposes
    load_dotenv('.env')
    return os.getenv('GEMINI_API_KEY')

def get_generation_config():
    generation_config = {
        "temperature": 1,
        "top_p": 0.95,
        "top_k": 64,
        "max_output_tokens": 8192,
        "response_mime_type": "text/plain",
        }
    return generation_config

def get_uri(): # for security purposes
    load_dotenv('.env')
    return os.getenv('MONGO_URI')




