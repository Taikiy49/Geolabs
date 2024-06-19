import React, { useState } from 'react';
import axios from 'axios';
import './SearchFiles.css'; // Import CSS

const SearchFiles = ({ onBack }) => {
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
    <>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter input"
        />
        <button type="submit">Submit</button>
      </form>
      {output && (
        <div>
          <h2>Output from Python:</h2>
          <p>{output}</p>
        </div>
      )}
      <button onClick={onBack}>Back</button>
    </>
  );
};

export default SearchFiles;
