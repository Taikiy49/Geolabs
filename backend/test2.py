import fitz  # PyMuPDF library
import pytesseract
from PIL import Image
import os
from multiprocessing import Pool

def pdf_to_text_via_ocr(pdf_path):
    # Open the PDF file
    document = fitz.open(pdf_path)
    all_text = ""

    # Loop through each page in the PDF
    for page_number in range(document.page_count):
        # Load the page
        page = document.load_page(page_number)

        # Try extracting text directly from the PDF
        text = page.get_text()
        if text.strip():  # If embedded text is found, add it to all_text and continue to next page
            all_text += text + "\n"
        else:
            # If no embedded text, perform OCR
            print(f"Page {page_number + 1} has no embedded text, performing OCR...")

            # Convert the page to a pixmap (image object) for OCR
            pix = page.get_pixmap(dpi=300)

            # Convert the pixmap to an image for OCR
            image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            # Perform OCR on the image
            ocr_text = pytesseract.image_to_string(image, lang='eng')

            # Append the OCR text to the all_text variable
            all_text += ocr_text + "\n"

    # Close the document
    document.close()

    return all_text

def save_text_to_file(text, output_path):
    # Save the extracted text to a .txt file
    with open(output_path, "w", encoding="utf-8") as file:
        file.write(text)

def process_pdf_file(filename, directory_path, output_dir):
    pdf_path = os.path.join(directory_path, filename)
    output_path = os.path.join(output_dir, f"{os.path.splitext(filename)[0]}.txt")

    # Check if the output text file already exists
    if os.path.exists(output_path):
        print(f"Skipping {pdf_path} as it has already been processed.")
        return

    print(f"Processing {pdf_path}...")

    # Extract text from the PDF using OCR
    extracted_text = pdf_to_text_via_ocr(pdf_path)

    # Save the extracted text to a .txt file
    save_text_to_file(extracted_text, output_path)

    print(f"Extracted text saved to: {output_path}")

def process_pdfs_in_directory(directory_path):
    # Directory where you want to save the text files
    desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
    output_dir = os.path.join(desktop_path, "OCR REPORTS")

    # Create the output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Collect all PDF files in the directory
    pdf_files = [filename for filename in os.listdir(directory_path) if filename.lower().endswith('.pdf')]

    # Use multiprocessing to process PDFs in parallel
    with Pool() as pool:
        pool.starmap(process_pdf_file, [(filename, directory_path, output_dir) for filename in pdf_files])

if __name__ == "__main__":
    # Specify the directory containing PDFs
    directory_path = r"\\geolabs.lan\fs\Reports" 
    
    # Process all PDF files in the directory
    process_pdfs_in_directory(directory_path)
