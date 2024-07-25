import PyPDF4

def run_query(chat_session, prompt):
  response = chat_session.send_message("Given just all the information I fed you earlier" + prompt + "ONLY give me answers that are related to the topic and keep it short!")
  return response.text.strip()

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