import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../reportsStyle/Query.css';
import getConfig from '../../config';

const Query = () => {
  const [input, setInput] = useState('');
  const [fileNames, setFileNames] = useState([]);
  const [filteredFileNames, setFilteredFileNames] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [chatbotPrompt, setChatbotPrompt] = useState('');
  const [chatbotResponse, setChatbotResponse] = useState('');
  const [submittedInput, setSubmittedInput] = useState('');
  const [error, setError] = useState('');
  const [useFileSelector, setUseFileSelector] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState([]); // State for selected checkboxes
  const { apiUrl } = getConfig();
  const listRef = useRef(null);

  // Options for the checkbox selection (can be adjusted as needed)
  const options = [
    'Subsurface Conditions',
    'Project Considerations',
    'Summary of Recommendations',
    'Foundations',
    'Earthwork',
    'Pavement',
  ];

  const handleChoice = (choice) => {
    setUseFileSelector(choice);
  };

  const handleRangeChange = () => {
    if (!rangeStart || !rangeEnd) {
      setError('Please enter both start and end values for the range.');
      return;
    }

    if (parseInt(rangeStart) > parseInt(rangeEnd)) {
      setError('Start value should not be greater than end value.');
      return;
    }

    setError(''); // Clear any previous errors
  };

  const searchFiles = async () => {
    handleRangeChange(); // Check the range validity

    if (error) return; // If there's an error, stop the search

    setError('');
    setSearchPerformed(false);

    try {
      const response = await axios.post(`${apiUrl}/reports/search-filenames`, {
        prompt: input,
        rangeStart,
        rangeEnd,
      });

      setFileNames(response.data.filenames);
      setFilteredFileNames(response.data.filenames);
      setLastSearchTerm(input);
      setInput('');
      setSearchPerformed(true);

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
      if (e.target.name === 'chatbot' && selectedFiles.length > 0) {
        handleChatbotRequest();
        setChatbotPrompt('');
      } else {
        searchFiles();
        setInput('');
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
        filenames: selectedFiles,
        prompt: chatbotPrompt,
        useFileSelector,
      });
  
      let formattedOutput = response.data.response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>')
        .replace(/\n/g, '<br>');
  
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
    }
    // No need to reset the chatbotPrompt, this ensures the input remains visible
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

  const handleCheckboxChange = (option) => {
    setSelectedOptions((prevSelected) =>
      prevSelected.includes(option)
        ? prevSelected.filter((item) => item !== option)
        : [...prevSelected, option]
    );
  };

  const handleGenerateSummary = async () => {
    if (!selectedFiles.length || !selectedOptions.length) {
      setError('Please select at least one file and one option.');
      return;
    }
  
    setError('');
    setChatbotResponse(''); // Clear existing response
    setLoading(true); // This will also disable the buttons
  
    try {
      const response = await axios.post(`${apiUrl}/reports/generate-summary`, {
        filenames: selectedFiles,
        selectedOptions,
      });
  
      if (response.data.summary) {
        let formattedSummary = response.data.summary
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>')
          .replace(/\n/g, '<br>');
        formattedSummary = `<ul>${formattedSummary}</ul>`;
        setChatbotResponse(formattedSummary); // Set the summary in the same box
      } else {
        setError('No summary found for this request.');
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      setError('An error occurred while generating the summary.');
    } finally {
      setLoading(false); // Re-enable the buttons
    }
  };
  

  return (
    <div className="relevancy-page-container" onMouseUp={handleMouseUp}>
      <div className="query-centering-container">
        <div className="relevancy-file-section">
          {/* Input fields for range selection */}
          <div className="range-input-container">
            <input
              type="number"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              placeholder="From (eg. 6000)"
              className="range-input"
            />
            <span className="range-dash">-</span> {/* Dash between inputs */}
            <input
              type="number"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              placeholder="To (e.g., 7000)"
              className="range-input"
            />
          </div>

          {/* Search form */}
            <form onSubmit={(e) => e.preventDefault()} className="relevancy-form">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter word(s) here..."
                className="relevancy-input-field"
              />
              <button 
                type="button" 
                onClick={searchFiles} 
                className="relevancy-submit-button"
              >
                Search
              </button>
            </form>

          {error ? (
            <p className="relevancy-error-message">{error}</p>
          ) : (
            <div className="relevancy-mini-container">
              <div className="relevancy-file-list-container" ref={listRef}>
                <div className='relevancy-file-top-menu'>
                  {lastSearchTerm && (
                    <p className="relevancy-last-search">Searched: {lastSearchTerm}</p>
                  )}
                  {selectedFiles.length > 0 && (
                    <div onClick={handleResetSelection} className="relevancy-reset-button">
                      <img className="reset-button-img" src="../reset-button.svg" alt="reset button for relevance" />
                      <p className="relevancy-reset-button-text">Reset</p>
                    </div>
                  )}
                </div>
                <ul className="relevancy-file-list">
                  {filteredFileNames.map((fileName, index) => (
                    <li
                      key={index}
                      className={`relevancy-file-item ${selectedFiles.includes(fileName) ? 'relevancy-selected' : ''}`}
                      onDoubleClick={() => handleOpenFile(fileName)}
                      onMouseDown={() => handleMouseDown(fileName)}
                      onMouseOver={() => handleMouseOver(fileName)}
                    >
                      <div className="relevancy-rank-filename-container">
                        <div className="relevancy-rank-container">
                          <div className="relevancy-rank-number">Rank {index + 1}</div>
                        </div>
                        <div className="relevancy-filename-box">
                          <span className="relevancy-filename-text">{fileName}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="relevancy-chatbot-section">
          <div className="relevancy-chatbot-container">
            {submittedInput && (
              <div className="relevancy-submitted-query">
                <p>
                  <strong>{submittedInput}</strong>
                </p>
              </div>
            )}

            {/* Unified response box for chatbot and summary */}
            <div className="relevancy-chatbot-response" dangerouslySetInnerHTML={{ __html: chatbotResponse }} />

            <div className="relevancy-file-count-text">{selectedFiles.length} files selected</div>

            <div className='relevancy-chatbot-input-form'>
            <input
              name="chatbot"
              value={chatbotPrompt}
              onChange={(e) => setChatbotPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your query..."
              className={`relevancy-chatbot-input ${selectedFiles.length === 0 || loading ? 'disabled' : ''}`}
              disabled={selectedFiles.length === 0 || loading} // Disable input if loading or no files selected
            />
            <button 
              type="button" 
              onClick={handleChatbotRequest} 
              className="relevancy-submit-button"
              disabled={selectedFiles.length === 0 || loading} // Disable button if loading or no files selected
            >
              Submit
            </button>
          </div>

          </div>

          {/* Checkbox section for generating summary */}
          <div className='relevancy-right-menu-container'>
            <div className="relevancy-summary-checkboxes-container">
              {options.map((option, index) => (
                <label key={index} className={`relevancy-workorder-checkbox ${loading ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    value={option}
                    checked={selectedOptions.includes(option)}
                    onChange={() => handleCheckboxChange(option)}
                    disabled={loading} // Disable checkboxes when loading
                  />
                  {option}
                </label>
              ))}
            </div>

            <div
              className={`relevancy-generate-summary-button ${loading ? 'disabled' : ''}`}
              onClick={handleGenerateSummary}
              disabled={!selectedFiles.length || loading} // Disable button when loading or no files selected
            >
              Submit
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Query;
