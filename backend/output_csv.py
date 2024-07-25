import json
import pandas as pd

# Function to convert JSON to CSV
def json_to_csv(json_file, csv_file):
    # Read JSON data
    with open(json_file, 'r') as f:
        data = json.load(f)
    
    # Convert JSON data to pandas DataFrame
    df = pd.DataFrame(data)
    
    # Save DataFrame to CSV
    df.to_csv(csv_file, index=False)

# Specify the JSON and CSV file names
json_file = 'pdf_data.json'
csv_file = 'pdf_data.csv'

# Call the function to convert JSON to CSV
json_to_csv(json_file, csv_file)

print(f"Converted {json_file} to {csv_file} successfully.")
