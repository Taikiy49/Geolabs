import React, { useState } from 'react';
import axios from 'axios';
import './SearchFiles.css'; // Import CSS
import FileUpload from './FileUpload';

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
    <div className="search-files-container">
      <div className="file-upload-section">
        <FileUpload />
      </div>
      <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Start searching..."
          className="input-field"
        />
        <button type="submit" className="submit-button">Submit</button>
      </form>
      <button onClick={onBack} className="back-button">Back</button>
    </div>
  );
};

export default SearchFiles;
