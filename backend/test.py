from PyPDF2 import PdfReader
import re

months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

# Define a regex pattern to match common date formats
date_pattern = re.compile(r'(\b(?:' + '|'.join(months) + r')\b[\s\.,]*\d{1,2}[\s\.,]*\d{2,4})|(\d{1,2}[\s\.,]*(?:' + '|'.join(months) + r')\b[\s\.,]*\d{2,4})', re.IGNORECASE)

def read_dates_from_first_page(file_path):
    """Reads dates from the first page of a PDF."""
    try:
        # Initialize PDF reader
        reader = PdfReader(file_path)

        # Read the first page
        first_page = reader.pages[0]
        text = first_page.extract_text()

        # Find dates using regex if text is found
        if text:
            # Use regex to find all date matches
            matches = date_pattern.findall(text)
            # Flatten the list of matches
            matched_dates = [match for group in matches for match in group if match]

            if matched_dates:
                print("Dates found on the first page:")
                return matched_dates
            else:
                print("No dates found on the first page.")
                return []
        else:
            print("No readable text found on the first page.")
            return []
    except Exception as e:
        print(f"Error reading the PDF: {e}")
        return []

# Example Usage
file_path = "6309-00.tk1.PJR.KamokilaBoulevardReconstruction-ocr.pdf"
print(read_dates_from_first_page(file_path))
