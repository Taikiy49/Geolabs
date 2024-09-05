import re
import os
from datetime import datetime

def extract_date(text):
    # Define patterns for various date formats
    date_patterns = [
        r'(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})',  # Matches 04/10/1972 or 4-10-72
        r'([A-Za-z]+\s+\d{1,2},\s*\d{4})',    # Matches "April 10, 1972"
        r'([A-Za-z]+\s+\d{1,2}[\s,\']+\d{4})' # Matches "Apr 10 1972" or "Apr. 10 1972"
    ]

    # Iterate over patterns to find the first valid date
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            date_str = match.group(0)
            # Convert to MM/DD/YYYY format if possible
            try:
                if re.match(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}', date_str):
                    date_obj = datetime.strptime(date_str, '%m/%d/%Y')
                else:
                    date_obj = datetime.strptime(date_str, '%B %d, %Y')
                return date_obj.strftime('%m-%d-%Y')  # Changed to use '-' for filename compatibility
            except ValueError:
                continue
    return 'Unknown'

# Function to Extract Date and Rename Files
def rename_all_files(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.txt'):  # Only process .txt files
            file_path = os.path.join(folder_path, filename)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()
                
                # Extract the date from the content
                submission_date = extract_date(content)
                
                if submission_date == 'Unknown':
                    # Use XX-XX-XXXX for unknown dates
                    submission_date = 'XX-XX-XXXX'
                
                # Construct the new filename in the format "date.filename.txt"
                new_filename = f"{submission_date}.{filename}"
                new_path = os.path.join(folder_path, new_filename)
                os.rename(file_path, new_path)
                print(f"Renamed: {filename} to {new_filename}")

            except Exception as e:
                print(f"Error processing file {file_path}: {e}")

# Define the Path to the OCR_REPORTS Folder
desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Rename all .txt Files in the OCR_REPORTS Folder
rename_all_files(ocr_reports_folder)
