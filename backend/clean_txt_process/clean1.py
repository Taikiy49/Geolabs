import os
import re

desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Define broader patterns considered relevant to capture more meaningful content
relevant_patterns = [
    r'[A-Za-z ]+:\s*\d+',  # Matches headers or labels with numbers
    r'\b\d+(\.\d+)?\s*(psf|feet|lbs?|oz|cm|inches?|mg|g|ft|m|km|%)\b',  # Matches numbers with units (expanded)
    r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',  # Matches dates
    r'\b[A-Za-z ]{3,}\b',  # Matches any word or phrase with 3 or more letters to avoid removing text content
    r'\b\d+\b',  # Matches standalone numbers
    r'[A-Za-z0-9,\.\(\)/&\-]+',  # Matches general alphanumeric strings with common punctuation
]

# Compile the regex patterns for better performance
compiled_patterns = [re.compile(pattern) for pattern in relevant_patterns]

def is_relevant(line):
    # Check if a line matches any of the relevant patterns
    return any(pattern.search(line) for pattern in compiled_patterns)

# Process each .txt file in the directory
for filename in os.listdir(ocr_reports_folder):
    if filename.endswith('.txt'):
        try:
            file_path = os.path.join(ocr_reports_folder, filename)
            
            # Read the file content
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                text = file.readlines()

            # Filter out irrelevant content
            cleaned_content = [line for line in text if line.strip() and is_relevant(line.strip())]

            # Write the cleaned content back to the file
            with open(file_path, 'w', encoding='utf-8') as file:
                file.writelines(cleaned_content)

            print(f"Cleaned {filename} in place.")

        except Exception as e:
            print(f"Error processing file {filename}: {e}")
