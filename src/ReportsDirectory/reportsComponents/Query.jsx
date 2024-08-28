import React, { useState, useRef } from 'react';
import axios from 'axios';
import '../reportsStyle/Query.css';
import getConfig from '../../config';

const Relevancy = () => {
  const [input, setInput] = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]); // Track selected files
  const [isSelecting, setIsSelecting] = useState(false); // Track if the user is dragging
  const [chatbotPrompt, setChatbotPrompt] = useState(''); // New prompt for the chatbot
  const [chatbotResponse, setChatbotResponse] = useState(''); // Store chatbot response
  const [submittedInput, setSubmittedInput] = useState(''); // Store submitted chatbot prompt
  const [error, setError] = useState('');
  const [useFileSelector, setUseFileSelector] = useState(true); // Toggle for file selector
  const { apiUrl } = getConfig();
  const listRef = useRef(null); // Reference to the list container

  const searchFiles = async (query) => {
    setError('');
    try {
      const response = await axios.post(`${apiUrl}/reports/search-filenames`, { prompt: query });
      setFileNames(response.data.filenames);
      setInput(''); // Clear the input after searching
    } catch (error) {
      console.error('There was an error retrieving the file names from the server!', error);
      setError('An error occurred while searching for relevant files. Please try again.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchFiles(input);
    }
  };

  const handleFileSelection = (fileName) => {
    setSelectedFiles((prevSelected) => {
      if (prevSelected.includes(fileName)) {
        return prevSelected.filter((name) => name !== fileName);
      } else if (prevSelected.length < 10) {
        return [...prevSelected, fileName];
      }
      return prevSelected;
    });
  };

  const handleChatbotRequest = async () => {
    setError('');
    setChatbotResponse('');
    setSubmittedInput(chatbotPrompt);

    try {
      const response = await axios.post(`${apiUrl}/reports/relevancy`, {
        filenames: useFileSelector ? selectedFiles : [],
        prompt: chatbotPrompt,
        useFileSelector,
      });

      let formattedOutput = response.data.response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>');

      formattedOutput = `<ul>${formattedOutput}</ul>`;
      setChatbotResponse(formattedOutput);
    } catch (error) {
      console.error('There was an error sending the selected files to the chatbot!', error);
      setError('An error occurred while processing your request. Please try again.');
    }
  };

  const handleMouseDown = (fileName) => {
    setIsSelecting(true);
    handleFileSelection(fileName);
  };

  const handleMouseOver = (fileName) => {
    if (isSelecting) {
      handleFileSelection(fileName);
    }
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
  };

  const handleResetSelection = () => {
    setSelectedFiles([]);
  };

  const toggleFileSelector = () => {
    setUseFileSelector(!useFileSelector);
    setSelectedFiles([]);
  };

  return (
    <div className="relevancy-container" onMouseUp={handleMouseUp}>
      <div className="file-selection-area">
        <form onSubmit={(e) => e.preventDefault()} className="relevancy-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a word..."
            className="input-field"
          />
        </form>
        <div className="controls">
          <label className="switch">
            <input type="checkbox" checked={useFileSelector} onChange={toggleFileSelector} />
            <span className="slider"></span>
          </label>
          <span>Use File Selector</span>
        </div>
        {useFileSelector && (
          <>
            {error ? (
              <p className="relevancy-error">{error}</p>
            ) : (
              <div className="mini-container">
                <div className="filenames-list-container" ref={listRef}>
                  <ul className="filenames-list">
                    {fileNames.map((fileName, index) => (
                      <li
                        key={index}
                        className={`filename-item ${selectedFiles.includes(fileName) ? 'selected' : ''}`}
                        onMouseDown={() => handleMouseDown(fileName)}
                        onMouseOver={() => handleMouseOver(fileName)}
                      >
                        <div className="rank-container">
                          <span className="rank-number">{index + 1}</span>
                        </div>
                        <div className="filename-box">
                          <span className="filename-text">{fileName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <button onClick={handleResetSelection} className="reset-button">
                  Reset Selection
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="chatbot-area">
        <div className="chatbot-section">
          <textarea
            value={chatbotPrompt}
            onChange={(e) => setChatbotPrompt(e.target.value)}
            placeholder="Enter your query..."
            className="chatbot-prompt-input"
          />
          <button onClick={handleChatbotRequest} className="chatbot-button">
            Ask Chatbot ({selectedFiles.length} files selected)
          </button>

          {submittedInput && (
            <div className="submitted-input-display">
              <p><strong>Your Query:</strong> {submittedInput}</p>
            </div>
          )}

          {chatbotResponse && (
            <div
              className="chatbot-response"
              dangerouslySetInnerHTML={{ __html: chatbotResponse }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Relevancy;
