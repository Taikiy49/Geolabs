from dotenv import load_dotenv
import os

# Adjust the path to the .env file to be compatible with the PyInstaller bundled executable
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')

def get_api_key():  # For security purposes
    load_dotenv(dotenv_path)
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

def get_uri():  # For security purposes
    load_dotenv(dotenv_path)
    return os.getenv('MONGO_URI')
