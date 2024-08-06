import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
import PyPDF4

# Ensure NLTK resources are downloaded
nltk.download('punkt')
nltk.download('stopwords')

class ParseFile:
    def __init__(self, file):
        self._file = file

    def preprocess_text(self, text):
        # Tokenize text
        tokens = word_tokenize(text)
        # Convert to lower case
        tokens = [token.lower() for token in tokens]
        # Remove punctuation and non-alphabetic tokens but keep numbers
        tokens = [token for token in tokens if token.isalpha() or token.isnumeric()]
        # Remove stop words
        stop_words = set(stopwords.words('english'))
        tokens = [token for token in tokens if token not in stop_words]
        return ' '.join(tokens)

    def generate_sentence_list(self):
        sentence_list = []
        pdf_reader = PyPDF4.PdfFileReader(self._file)
        for page_num in range(pdf_reader.getNumPages()):
            page = pdf_reader.getPage(page_num)
            sentence_list.append(page.extractText().replace('\n', ''))
        raw_text = " ".join(sentence_list)
        
        # Print raw text for comparison
        print(f"Raw text:\n{raw_text}\n")
        
        # Preprocess text
        cleaned_text = self.preprocess_text(raw_text)
        
        # Print cleaned text for comparison
        print(f"Cleaned text:\n{cleaned_text}\n")
        
        return cleaned_text

    
def run_query(chat_session, prompt):
  response = chat_session.send_message("Given just all the information I fed you earlier" + prompt + "ONLY give me answers that are related to the topic and keep it short!")
  return response.text.strip()