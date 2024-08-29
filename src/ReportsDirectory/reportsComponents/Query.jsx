import React, { useState, useRef } from 'react';
import axios from 'axios';
import '../reportsStyle/Query.css';
import getConfig from '../../config';

const Query = () => {
  const [input, setInput] = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [chatbotPrompt, setChatbotPrompt] = useState('');
  const [chatbotResponse, setChatbotResponse] = useState('');
  const [submittedInput, setSubmittedInput] = useState('');
  const [error, setError] = useState('');
  const [useFileSelector, setUseFileSelector] = useState(false);
  const { apiUrl } = getConfig();
  const listRef = useRef(null);

  const searchFiles = async (query) => {
    setError('');
    try {
      const response = await axios.post(`${apiUrl}/reports/search-filenames`, { prompt: query });
      setFileNames(response.data.filenames);
      setInput('');
    } catch (error) {
      console.error('There was an error retrieving the file names from the server!', error);
      setError('An error occurred while searching for relevant files. Please try again.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target.name === 'chatbot') {
        handleChatbotRequest(); // Submit the query when Enter is pressed in chatbot input
      } else {
        searchFiles(input);
      }
    }
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
    setInput('');
    setFileNames([]);
  };

  return (
    <div className="relevancy-page-container" onMouseUp={handleMouseUp}>
      <div className="relevancy-file-section">
        <div className="relevancy-controls">
          <label className="relevancy-switch">
            <input type="checkbox" checked={useFileSelector} onChange={toggleFileSelector} />
            <span className="relevancy-slider"></span>
          </label>
          <span>File Selection</span>
        </div>

        {useFileSelector && (
          <>
            <form onSubmit={(e) => e.preventDefault()} className="relevancy-form">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a word..."
                className="relevancy-input-field"
              />
            </form>
            {error ? (
              <p className="relevancy-error-message">{error}</p>
            ) : (
              <div className="relevancy-mini-container">
                <div className="relevancy-file-list-container" ref={listRef}>
                  <ul className="relevancy-file-list">
                    {fileNames.map((fileName, index) => (
                      <li
                        key={index}
                        className={`relevancy-file-item ${selectedFiles.includes(fileName) ? 'relevancy-selected' : ''}`}
                        onMouseDown={() => handleMouseDown(fileName)}
                        onMouseOver={() => handleMouseOver(fileName)}
                      >
                        <div className="relevancy-rank-container">
                          <span className="relevancy-rank-number">{index + 1}</span>
                        </div>
                        <div className="relevancy-filename-box">
                          <span className="relevancy-filename-text">{fileName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <button onClick={handleResetSelection} className="relevancy-reset-button">
                  Reset Selection
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="relevancy-chatbot-section">
        <div className="relevancy-chatbot-container">
          <textarea
            name="chatbot"
            value={chatbotPrompt}
            onChange={(e) => setChatbotPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your query..."
            className="relevancy-chatbot-input"
          />
          
          <div className="relevancy-file-count-text">
            {selectedFiles.length} files selected
          </div>

          {submittedInput && (
            <div className="relevancy-submitted-query">
              <p><strong>Your Query:</strong> {submittedInput}</p>
            </div>
          )}

          {chatbotResponse && (
            <div
              className="relevancy-chatbot-response"
              dangerouslySetInnerHTML={{ __html: chatbotResponse }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Query;
