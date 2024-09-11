import os
import re

desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Define patterns for detecting non-English words, excluding numbers
non_english_word_pattern = re.compile(r'\b[^A-Za-z0-9\s]+\b')  # Matches words that are not English (non-A-Z characters) and not numbers

def contains_consecutive_non_english_words(line):
    # Find all non-English words in the line
    non_english_words = non_english_word_pattern.findall(line)
    # Check if there are more than three consecutive non-English words
    return len(non_english_words) > 3

# Process each .txt file in the directory
for filename in os.listdir(ocr_reports_folder):
    if filename.endswith('.txt'):
        try:
            file_path = os.path.join(ocr_reports_folder, filename)
            
            # Read the file content
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                text = file.readlines()

            print(f"\nCleaning file: {filename}")

            # Filter out lines with more than 3 consecutive non-English words
            cleaned_content = [line for line in text if not contains_consecutive_non_english_words(line.strip())]

            # Write the cleaned content back to the file
            with open(file_path, 'w', encoding='utf-8') as file:
                file.writelines(cleaned_content)

            print(f"Cleaned {filename} successfully.")

        except Exception as e:
            print(f"Error processing file {filename}: {e}")
