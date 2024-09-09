import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../employeeStyle/Handbook.css';
import getConfig from '../../config';

const Handbook = () => {
  const [handbookPrompt, setHandbookPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState([]); // Store chat history
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false); // State to manage loading UI
  const { apiUrl } = getConfig();
  const chatContainerRef = useRef(null); // Ref to manage chat scrolling

  useEffect(() => {
    // Scroll to the bottom of the chat whenever a new response is added
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleHandbookRequest = async () => {
    if (!handbookPrompt.trim()) return; // Prevent empty requests

    setError('');
    setLoading(true); // Show loading UI
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { role: 'user', content: handbookPrompt },
    ]);

    try {
      const response = await axios.post(`${apiUrl}/employee-guide/handbook-query`, {
        handbookPrompt,
      });

      // Simulate typing animation by using setTimeout
      let formattedOutput = response.data.response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>');
      formattedOutput = `<ul>${formattedOutput}</ul>`;

      const animateResponse = (text, index = 0) => {
        if (index < text.length) {
          setChatHistory((prevHistory) => [
            ...prevHistory.slice(0, -1),
            {
              ...prevHistory[prevHistory.length - 1],
              content: prevHistory[prevHistory.length - 1].content + text[index],
            },
          ]);
          setTimeout(() => animateResponse(text, index + 1), 5); // Adjust speed of typing animation
        } else {
          setLoading(false); // Hide loading UI after response is fully typed
        }
      };

      setChatHistory((prevHistory) => [
        ...prevHistory,
        { role: 'model', content: '' },
      ]);

      animateResponse(formattedOutput);
    } catch (error) {
      console.error('There was an error searching the handbook!', error);
      setError('An error occurred while processing your request. Please try again.');
      setLoading(false);
    }

    setHandbookPrompt('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleHandbookRequest();
    }
  };

  return (
    <div className="handbook-page-container">
      <div className="handbook-inside-container">
        <div className="handbook-search-section">
          {error ? (
            <p className="handbook-error-message">{error}</p>
          ) : (
            <div className="handbook-response-container" ref={chatContainerRef}>
              {chatHistory.map((message, index) => (
                <div
                  key={index}
                  className={`handbook-message ${index % 2 === 0 ? 'right-message' : 'left-message'}`}
                  dangerouslySetInnerHTML={{ __html: message.content }}
                />
              ))}
              {loading && <div className="loading-spinner">...</div>} {/* Loading UI */}
            </div>
          )}
          </div>
        </div>
        <div className="handbook-form">
          <input
            type="text"
            value={handbookPrompt}
            onChange={(e) => setHandbookPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask GeoBot..."
            className="handbook-input-field"
          />
          <div className='handbook-chatbot-notice-text'>GeoBot can make mistakes. Please always verify important info.</div>
        </div>
      </div>
  );
};

export default Handbook;
