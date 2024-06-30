import React, { useState } from 'react';
import axios from 'axios';
import './DatabaseStyle.css'; 

const SearchDatabase = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post('http://localhost:5000/search-database', { input });
      setOutput(response.data.replace(/\*/g, ''));
    } catch (error) {
      console.error('There was an error sending the input to the server!', error);
    }
  };

  return (
    <div className="search-files-container">

      <div className="chatbot-output-container">
        {output && (
          <pre className="chatbot-output-display">{output.split('\n').map((line, index) => (
            <React.Fragment key={index}>
              {line}
              <br />
            </React.Fragment>
          ))}</pre>
        )}
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
