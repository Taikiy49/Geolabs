from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi

# MongoDB connection URI
uri = "mongodb+srv://Taikiy49:Taikiy491354268097@geolabs.plekzlk.mongodb.net/?retryWrites=true&w=majority&appName=Geolabs"

# Create a new client and connect to the server
client = MongoClient(uri, server_api=ServerApi('1'), tlsAllowInvalidCertificates=True)

# Select the UserProfile database
user_profile_db = client['UserProfile']

# Insert some sample data into the 'users' collection (if not already existing)
user_profile_db.users.insert_many([
    { 'username': 'user1', 'password': 'password1' },
    { 'username': 'user2', 'password': 'password2' },
    { 'username': 'user3', 'password': 'password3' },
    { 'username': 'user4', 'password': 'password4' },
])

# Retrieve and print the users and passwords
users = user_profile_db.users.find({}, {'_id': 0, 'username': 1, 'password': 1})
for user in users:
    print(f"Username: {user['username']}, Password: {user['password']}")
