import os
import re

# Function to remove date from the beginning of the filename
def remove_date_from_filename(filename):
    # Define the pattern to match date formats like "MM-DD-YYYY", "MM/DD/YYYY", etc.
    date_pattern = r'^\d{2}-\d{2}-\d{4}|' \
                   r'^\d{2}/\d{2}/\d{4}|' \
                   r'^\d{2}-\d{2}-\d{2}|' \
                   r'^\d{2}/\d{2}/\d{2}|' \
                   r'^[A-Za-z]+-XX-\d{4}'  # Matches "Month-XX-YYYY"

    # Remove the date at the start of the filename
    new_filename = re.sub(date_pattern, '', filename).lstrip(' ._-')  # Strip leading whitespace or delimiters

    return new_filename

# Function to process all .txt files in the OCR_REPORTS folder
def process_files_in_folder(folder_path):
    for filename in os.listdir(folder_path):
        if filename.endswith('.txt'):  # Only process .txt files
            file_path = os.path.join(folder_path, filename)
            # Remove the date from the filename
            new_filename = remove_date_from_filename(filename)
            new_path = os.path.join(folder_path, new_filename)

            # Rename the file if the name has changed
            if new_filename != filename:
                try:
                    os.rename(file_path, new_path)
                    print(f"Renamed: {filename} to {new_filename}")
                except Exception as e:
                    print(f"Error renaming file {filename}: {e}")

# Define the Path to the OCR_REPORTS Folder
desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Process all .txt files in the OCR_REPORTS folder
process_files_in_folder(ocr_reports_folder)
