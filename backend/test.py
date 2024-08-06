from model_building import Model

model = Model()
query = "specific query about the documents"
search_results = model.search_documents(query)
print(search_results)
