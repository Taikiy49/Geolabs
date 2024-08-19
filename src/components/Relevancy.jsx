import React, { useState } from 'react';
import axios from 'axios';
import '../styles/Relevancy.css';

const Relevancy = () => {
  const [input, setInput] = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [submittedInput, setSubmittedInput] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmittedInput(input);
    setInput('');
    setFileNames([]);
    setSelectedFileContent('');
    try {
      const response = await axios.post('http://13.56.252.100:8000/program-selection/search-filenames', { prompt: input });
      setFileNames(response.data.filenames);
    } catch (error) {
      console.error('There was an error retrieving the file names from the server!', error);
    }
  };

  const handleViewClick = async (fileName) => {
    try {
      const response = await axios.post('http://13.56.252.100:8000/program-selection/get-quick-view', {
        filename: fileName,
        prompt: submittedInput // Send the original query to find relevant sentences
      });
      console.log(response.data.content); // Log the content to see what is returned
      setSelectedFileContent(response.data.content);
    } catch (error) {
      console.error('There was an error retrieving the file content from the server!', error);
    }
  };
  
  return (
    <div className="relevancy-container">
      <div className="submitted-input-container">
        {submittedInput && (
          <div className="submitted-input-display">{submittedInput}</div>
        )}
      </div>
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
      {selectedFileContent && (
        <div className="file-content-display">
          <h3>Relevant Sentences</h3>
          <p>{selectedFileContent}</p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="relevancy-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your search query..."
          className="input-field"
        />
        <button type="submit" className="submit-button">Submit</button>
      </form>
    </div>
  );
};

export default Relevancy;
