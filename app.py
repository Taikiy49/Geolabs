from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/programs', methods=['GET'])
def get_programs():
    programs = ['Search Files', '...']
    return jsonify(programs)

@app.route('/sendInput', methods=['POST'])
def send_input():
    data = request.get_json()
    user_input = data.get('input')
    print(f"Received input: {user_input}")
    return jsonify(f"Received input: {user_input}")

if __name__ == '__main__':
    app.run(port=5000, debug=True)
