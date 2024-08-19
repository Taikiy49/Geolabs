from pymongo import MongoClient
from model_settings import get_uri

try:
    client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)
    print(client.server_info())  # Should print MongoDB server info if connected
    print("MongoDB connected successfully.")
except Exception as e:
    print(f"Failed to connect to MongoDB: {e}")
