from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi

# MongoDB connection URI
uri = "mongodb+srv://Taikiy49:Taikiy491354268097@geolabs.plekzlk.mongodb.net/?retryWrites=true&w=majority&appName=Geolabs"

# Create a new client and connect to the server
client = MongoClient(uri, server_api=ServerApi('1'), tlsAllowInvalidCertificates=True)

# Select the UserProfile database
users_db = client['UserProfile']

# Delete all documents in the 'users' collection
users_db.users.delete_many({})

# Insert some sample data into the 'users' collection
users_db.users.insert_one({
    'email': 'test_email', 'password': 'test_password'
})

# Retrieve and print the users and passwords
users = users_db.users.find({}, {'_id': 0, 'email': 1, 'password': 1})
for user in users:
    print(f"Email: {user['email']}, Password: {user['password']}")
