import React, { useState } from 'react';
import axios from 'axios';
import '../reportsStyle/Relevancy.css';
import getConfig from '../../config';

const Relevancy = () => {
  const [input, setInput] = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [submittedInput, setSubmittedInput] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [error, setError] = useState(''); // Add error state
  const { apiUrl } = getConfig();

  const searchFiles = async (query) => {
    setError(''); // Clear previous error
    try {
      const response = await axios.post(`${apiUrl}/reports/search-filenames`, { prompt: query });
      setFileNames(response.data.filenames);
      setSubmittedInput(query); // Store the latest query as the submitted input
    } catch (error) {
      console.error('There was an error retrieving the file names from the server!', error);
      setError('An error occurred while searching for relevant files. Please try again.'); // Display error
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent the form from submitting
      searchFiles(input);
    }
  };

  const handleViewClick = async (fileName) => {
    try {
      const response = await axios.post(`${apiUrl}/reports/get-quick-view`, {
        filename: fileName,
        prompt: submittedInput // Send the original query to find relevant sentences
      });
      setSelectedFileContent(response.data.content);
    } catch (error) {
      console.error('There was an error retrieving the file content from the server!', error);
      setError('An error occurred while retrieving the file content. Please try again.'); // Display error
    }
  };

  return (
    <div className="relevancy-container">
      <form onSubmit={(e) => e.preventDefault()} className="relevancy-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown} // Trigger search on Enter key press
          placeholder="Type a word..."
          className="input-field"
        />
      </form>
      {error ? (
        <p className="relevancy-error">{error}</p> // Display error message
      ) : (
        <div className="mini-container">
          <div>
            <div className="filenames-list-container">
              <ul className="filenames-list">
                {fileNames.map((fileName, index) => (
                  <li key={index} className="filename-item">
                    <div className="rank-container">
                      <span className="rank-number">{index + 1}</span>
                    </div>
                    <div className="filename-box">
                      <span className="filename-text">{fileName}</span>
                      <button className="view-button" onClick={() => handleViewClick(fileName)}>Quick View</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            {selectedFileContent && (
              <div className="file-content-display">
                <h3>Relevant Sentences</h3>
                <p>{selectedFileContent}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Relevancy;
