import React, { useState } from 'react';
import axios from 'axios';
import './DatabaseStyle.css'; 

const SearchDatabase = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post('http://localhost:5000/sendInput', { input });
      setOutput(response.data);
    } catch (error) {
      console.error('There was an error sending the input to the server!', error);
    }
  };

  return (
    <div className="search-files-container">
        <form onSubmit={handleSubmit} className="search-form">
        <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Start searching..."
        className="input-field"
        />
        <button className="submit-button">Submit</button>
        </form>
    </div>
  );
};

export default SearchDatabase;

