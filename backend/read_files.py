import PyPDF4
import os

class ParseFile:
    def __init__(self, file):
        self._file = file

    def generate_sentence_list(self):
        sentence_list = []
        with open(self._file, "rb") as f:
            pdf_reader = PyPDF4.PdfFileReader(f)
            for page_num in range(pdf_reader.getNumPages()):
                page = pdf_reader.getPage(page_num)
                sentence_list.append(page.extractText().replace('\n', ''))
        return sentence_list

class FindFromText:
    def __init__(self, sentence_list):
        self._sentence_list = sentence_list
    
    def search_sentences(self, keyword):
        found_sentences = []
        for sentence in self._sentence_list:
            if keyword in sentence:
                found_sentences.append(sentence)
        return found_sentences
    
def return_pdf_list(directory):
    return [os.path.join(directory, file) for file in os.listdir(directory) if file.endswith('.pdf')]


if __name__ == "__main__":
    directory = 'C:/Users/taiki/OneDrive/Desktop/Geolabs/test_files' # for testing purposes
    pdf_list = return_pdf_list(directory)
    sentence_list = []

    for file in pdf_list:
        sentence_list.append(ParseFile(file).generate_sentence_list())
    
    found_sentences = FindFromText(sentence_list).search_sentences(input("Enter keyword: "))
    print(found_sentences)


    # below for testing purposes
    # while run:
    #     keyword = input("Enter keyword: ")

    #     if keyword == 'q' or keyword == 'Q':
    #         run = False
    #     else:
    #         found_sentences = FindFromText(sentence_list).search_sentences(keyword)
    #         print(found_sentences)
