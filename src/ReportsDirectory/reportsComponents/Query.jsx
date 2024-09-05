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
  const [loading, setLoading] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState(''); // Store the last search term
  const { apiUrl } = getConfig();
  const listRef = useRef(null);

  const searchFiles = async (query) => {
    setError('');
    try {
      const response = await axios.post(`${apiUrl}/reports/search-filenames`, { prompt: query });
      setFileNames(response.data.filenames);
      setLastSearchTerm(input); // Update the last search term
      setInput('');

      if (response.data.filenames.length > 0) {
        listRef.current.classList.add('active');
      } else {
        listRef.current.classList.remove('active');
      }
    } catch (error) {
      console.error('There was an error retrieving the file names from the server!', error);
      setError('An error occurred while searching for relevant files. Please try again.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target.name === 'chatbot') {
        handleChatbotRequest();
      } else {
        searchFiles(input);
        setInput(''); // Clear the input box after submitting
      }
    }
  };

  const handleChatbotRequest = async () => {
    if (!chatbotPrompt.trim()) return;

    setError('');
    setChatbotResponse('');
    setSubmittedInput(chatbotPrompt);
    setLoading(true);

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

      const animateResponse = (text, index = 0) => {
        if (index < text.length) {
          setChatbotResponse((prevResponse) => prevResponse + text[index]);
          setTimeout(() => animateResponse(text, index + 1), 5);
        } else {
          setLoading(false);
        }
      };

      setChatbotResponse('');
      animateResponse(formattedOutput);
    } catch (error) {
      console.error('There was an error sending the selected files to the chatbot!', error);
      setError('An error occurred while processing your request. Please try again.');
      setLoading(false);
    } finally {
      setChatbotPrompt(''); // Clear the chatbot input box after submitting
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

  const handleOpenFile = async (fileName) => {
    try {
      const response = await axios.post(`${apiUrl}/reports/open-file`, { filename: fileName });
      if (response.status === 200) {
        console.log(`File ${fileName} opened successfully.`);
      } else {
        console.error(`Error opening file: ${response.data.error}`);
        setError('Error opening the file. Please try again.');
      }
    } catch (error) {
      console.error('There was an error opening the file!', error);
      setError('An error occurred while trying to open the file. Please try again.');
    }
  };

  return (
    <div className="relevancy-page-container" onMouseUp={handleMouseUp}>
      <div className="query-centering-container">
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
              {/* Display the last search term above the input box */}
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
                  {lastSearchTerm && (
                      <p className="relevancy-last-search">Searched: {lastSearchTerm}</p>
                    )}
                  <div className="relevancy-file-list-container" ref={listRef}>
      
                    <ul className="relevancy-file-list">
                      {fileNames.map((fileName, index) => (
                        <li
                          key={index}
                          className={`relevancy-file-item ${selectedFiles.includes(fileName) ? 'relevancy-selected' : ''}`}
                          onDoubleClick={() => handleOpenFile(fileName)}
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
                  {selectedFiles.length > 0 && (
                    <div onClick={handleResetSelection} className="relevancy-reset-button">
                      <img className="reset-button-img" src="../reset-button.svg" alt='reset button for relevance'/>
                      <p className="relevancy-reset-button-text">Reset</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="relevancy-chatbot-section">
          <div className="relevancy-chatbot-container">
            <div className="relevancy-file-count-text">
              {selectedFiles.length} files selected
            </div>
            <input
              name="chatbot"
              value={chatbotPrompt}
              onChange={(e) => setChatbotPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your query..."
              className="relevancy-chatbot-input"
            />

            {submittedInput && (
              <div className="relevancy-submitted-query">
                <p><strong>{submittedInput}</strong></p>
              </div>
            )}

            {chatbotResponse && (
              <div
                className="relevancy-chatbot-response"
                dangerouslySetInnerHTML={{ __html: chatbotResponse }}
              />
            )}
            {loading && <div className="loading-spinner">...</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Query;
