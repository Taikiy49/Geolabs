from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from dotenv import load_dotenv
import os

# MongoDB connection URI
load_dotenv('.env')
uri = os.getenv('MONGO_URI')

# Create a new client and connect to the server
client = MongoClient(uri, server_api=ServerApi('1'), tlsAllowInvalidCertificates=True)

# Select the UserProfile and PDFData databases
users_db = client['UserProfile']
pdf_data_db = client['PDFData']

# Delete all documents in the 'users' collection
users_result = users_db.users.delete_many({})
print(f'Deleted {users_result.deleted_count} user(s) from the UserProfile database.')

# Insert some sample data into the 'users' collection
users_db.users.insert_one({
    'email': 'test_email', 'password': 'test_password'
})
print('Inserted sample user into the UserProfile database.')

# Retrieve and print the users and passwords
users = users_db.users.find({}, {'_id': 0, 'email': 1, 'password': 1})
for user in users:
    print(f"Email: {user['email']}, Password: {user['password']}")

# Delete all documents in the 'pdf_data' collection
pdf_data_result = pdf_data_db.pdf_data.delete_many({})
print(f'Deleted {pdf_data_result.deleted_count} document(s) from the PDFData database.')

# Optionally, insert some sample data into the 'pdf_data' collection
pdf_data_db.pdf_data.insert_one({
    'filename': 'sample_file.pdf',
    'content': 'This is some sample content from a PDF file.'
})
print('Inserted sample PDF data into the PDFData database.')

# Retrieve and print the PDF data
pdf_data = pdf_data_db.pdf_data.find({}, {'_id': 0, 'filename': 1, 'content': 1})
for data in pdf_data:
    print(f"Filename: {data['filename']}, Content: {data['content']}")
