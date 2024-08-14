import PyPDF4
import google.api_core.exceptions


def return_keywords(chat_session, prompt):
    keywords = chat_session.send_message(f'Give me the most important words and 50 other words that mean similar to the same set of important words from the question: {prompt}. Give it to me separated by spaces and do not bold. For example, "holes drilling filling"')
    chat_session.send_message(f'Completely disregard everything that I asked you earlier for future questions')
    return keywords.text.split()

class ParseFile:
    def __init__(self, file):
        self._file = file

    def generate_sentence_list(self):
        sentence_list = []
        pdf_reader = PyPDF4.PdfFileReader(self._file)
        for page_num in range(pdf_reader.getNumPages()):
            page = pdf_reader.getPage(page_num)
            sentence_list.append(page.extractText().replace('\n', ''))
        return " ".join(sentence_list)
