import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
import PyPDF4

<<<<<<< HEAD
def return_keywords(chat_session, prompt):
    keywords = chat_session.send_message(f'Give me the most important words and 50 other words that mean similar to the same set of important words from the question: {prompt}. Give it to me separated by spaces and do not bold. For example, "holes drilling filling"')
    chat_session.send_message(f'Completely disregard everything that I asked you earlier for future questions')
    return keywords.text.split()

def run_query(chat_session, prompt):
    response = chat_session.send_message("Given just all the information I fed you earlier" + prompt + "ONLY give me answers that are related to the topic and keep it short!")
    return response.text.strip()
=======
# Ensure NLTK resources are downloaded
nltk.download('punkt')
nltk.download('stopwords')
>>>>>>> d3b779cd86d2b3c16f5d273d297649dc02b05afa

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
<<<<<<< HEAD
        return " ".join(sentence_list)
=======
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
>>>>>>> d3b779cd86d2b3c16f5d273d297649dc02b05afa
