@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data['email']
    password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    
    # THIS IS TEMPORARY FOR TESTING PURPOSES
    if email not in ["taikiy49@gmail.com", "jason@geolabs.net", "ryang@geolabs.net", "lola@geolabs.net"]:
        return jsonify({"message": "THIS PROGRAM IS CURRENTLY RESTRICTED TO TAIKI AND 3 OTHERS"}), 400

    if users_db.users.find_one({"email": email}):
        return jsonify({"message": "Email already registered"}), 400
    
    users_db.users.insert_one({"email": email, "password": password})
    return jsonify({"message": "User registered successfully"}), 200

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data['email']
    password = data['password']
    user = users_db.users.find_one({"email": email})
    if user and check_password_hash(user['password'], password):
        login_user(User(str(user["_id"]), user["email"]))
        session.permanent = True  # Make the session permanent
        return jsonify({"message": "Logged in successfully", "token": session['_id']}), 200
    return jsonify({"message": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully"}), 200

if __name__ == '__main__':
    app.run(debug=True)