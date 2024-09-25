import os
import re
from spellchecker import SpellChecker  # Import the SpellChecker library
from clean_terms import oahu_cities, civil_engineering_terms  # Import terms from clean_terms.py

# Initialize the SpellChecker
spell = SpellChecker()

# Combine all terms into a single set for quick lookup
ignore_words = set(oahu_cities + civil_engineering_terms)

desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
ocr_reports_folder = os.path.join(desktop_path, 'OCR_REPORTS')

# Define a function to check if a word is an English word or in the ignore list
def is_english_word(word):
    # Check if the word is in the dictionary or in the ignore list
    return word.lower() in spell or word in ignore_words

# Define a function to find and remove sequences of exactly 3 consecutive non-English words
def remove_irrelevant_sequences(line):
    # Split the line into words
    word_list = re.findall(r'\b\w+\b', line)
    cleaned_words = []
    i = 0

    while i < len(word_list):
        # Check for sequences of exactly 3 consecutive non-English words
        if i <= len(word_list) - 3:
            if (not is_english_word(word_list[i]) and 
                not is_english_word(word_list[i + 1]) and 
                not is_english_word(word_list[i + 2])):
                # Skip these 3 words as they are irrelevant
                i += 3
                continue
        # If the word is relevant, add it to the cleaned list
        cleaned_words.append(word_list[i])
        i += 1

    # Rejoin the cleaned words into a single line
    return ' '.join(cleaned_words)

# Initialize a counter to keep track of the number of files processed
file_count = 0
max_files = 8000  # Set the maximum number of files to process

# Process each .txt file in the directory
for filename in os.listdir(ocr_reports_folder):
    if filename.endswith('.txt'):
        try:
            file_path = os.path.join(ocr_reports_folder, filename)

            # Read the file content
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as file:
                text = file.readlines()

            # Remove irrelevant sequences from each line
            cleaned_text = []
            for line in text:
                # Strip leading/trailing whitespace
                line = line.strip()

                # Remove irrelevant sequences from the line
                cleaned_line = remove_irrelevant_sequences(line)
                cleaned_text.append(cleaned_line)

            # Write the cleaned content back to the file
            with open(file_path, 'w', encoding='utf-8') as file:
                file.write("\n".join(cleaned_text))

            print(f"Cleaned {filename} successfully.")

            # Increment the file count
            file_count += 1

            # Stop after processing the maximum number of files
            if file_count >= max_files:
                break

        except Exception as e:
            print(f"Error processing file {filename}: {e}")
