import React, { useState } from 'react';
import axios from 'axios';
import '../styles/SearchDatabase.css';
import getConfig from '../config';

const SearchDatabase = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [submittedInput, setSubmittedInput] = useState('');
  const { apiUrl } = getConfig();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmittedInput(input);
    setInput('');
    setOutput(''); 
    try {
      const response = await axios.post(`${apiUrl}/program-selection/search-database`, { prompt: input });
      let formattedOutput = response.data.response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>'); 

      formattedOutput = `<ul>${formattedOutput}</ul>`;
      setOutput(formattedOutput);
    } catch (error) {
      console.error('There was an error sending the input to the server!', error);
    }
  };

  return (
    <div className="search-files-container">
      <div className="chatbot-output-container">
        {submittedInput && (
          <div className="submitted-input-display">{submittedInput}</div>
        )}
        <div
          className="server-response"
          dangerouslySetInnerHTML={{ __html: output }}
        />
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
    </div>
  );
};

export default SearchDatabase;
