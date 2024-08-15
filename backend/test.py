import spacy

# Load the pre-trained language model
nlp = spacy.load("en_core_web_sm")

# The prompt
prompt = "projects in Halawa"

# Process the text using spaCy
doc = nlp(prompt)

# Extract entities (like locations, organizations) and keywords (like nouns, proper nouns)
relevant_words = []
for token in doc:
    if token.pos_ in ["NOUN", "PROPN"]:  # Nouns and Proper Nouns
        relevant_words.append(token.text)
    elif token.ent_type_ in ["GPE", "LOC", "ORG"]:  # Locations, Geopolitical entities, Organizations
        relevant_words.append(token.text)

# Print relevant words
print("Relevant Words:", relevant_words)
