from bson.objectid import ObjectId
from pymongo.mongo_client import MongoClient
from dotenv import load_dotenv
import os

# MongoDB connection URI
load_dotenv('.env')
uri = os.getenv('MONGO_URI')

# Connect to MongoDB
client = MongoClient(uri)
db = client['PDFData']
fs = db['fs.files']  # This is the default collection name for GridFS file metadata

# Find the file by its ObjectId (replace with your file's ObjectId)
file_id = ObjectId('your_file_object_id')
file_metadata = fs.find_one({'_id': file_id})

if file_metadata:
    file_size_bytes = file_metadata['length']  # Size in bytes
    file_size_mb = file_size_bytes / (1024 * 1024)  # Convert to MB
    print(f"File size: {file_size_mb:.2f} MB")
else:
    print("File not found")
