import spacy

# Load spaCy's language model
nlp = spacy.load("en_core_web_sm")

# Function to generate all forms of a word
def generate_all_forms(word):
    forms = set()
    
    # Process the word with spaCy
    doc = nlp(word)
    
    # Original word
    forms.add(word)
    
    # Lemmatized word
    lemma = doc[0].lemma_
    forms.add(lemma)
    
    # Singular/Plural forms
    if word.endswith('s') and not word.endswith('ss'):
        singular = lemma if lemma.endswith('y') else word[:-1]
        forms.add(singular)
    else:
        plural = lemma + 's'
        forms.add(plural)
    
    return forms

# Example list of keywords
keywords_list = ["capacities", "running", "jumps", "fairly"]

# Generate all forms for each keyword
all_keywords = set()
for keyword in keywords_list:
    all_keywords.update(generate_all_forms(keyword))

print(all_keywords)
