from pymongo import MongoClient
import gridfs
from model_building import get_uri

# Function to connect to the database and remove all files
def remove_all_files_from_gridfs():
    client = MongoClient(get_uri(), tlsAllowInvalidCertificates=True)  # Replace get_uri() with your connection string
    pdf_data_db = client['PDFData']
    fs = gridfs.GridFS(pdf_data_db)

    # Remove all files from fs.files
    pdf_data_db.fs.files.delete_many({})
    # Remove all corresponding chunks from fs.chunks
    pdf_data_db.fs.chunks.delete_many({})

    print("All files and chunks have been removed from GridFS.")

# Call the function to remove all files
remove_all_files_from_gridfs()
