import React, { useState } from 'react';
import axios from 'axios';
import '../employeeStyle/Handbook.css';
import getConfig from '../../config';

const Handbook = () => {
  const [handbookPrompt, setHandbookPrompt] = useState('');
  const [handbookResponse, setHandbookResponse] = useState('');
  const [submittedInput, setSubmittedInput] = useState('');
  const [error, setError] = useState('');
  const { apiUrl } = getConfig();

  const handleHandbookRequest = async () => {
    setError('');
    setHandbookResponse('');
    setSubmittedInput(handbookPrompt);

    try {
      const response = await axios.post(`${apiUrl}/employee-guide/handbook-query`, {
        handbookPrompt,
      });

      let formattedOutput = response.data.response
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>');

      formattedOutput = `<ul>${formattedOutput}</ul>`;
      setHandbookResponse(formattedOutput);
    } catch (error) {
      console.error('There was an error searching the handbook!', error);
      setError('An error occurred while processing your request. Please try again.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleHandbookRequest();
    }
  };

  return (
    <div className="handbook-page-container">
      <div className="handbook-centering-container">
        <div className="handbook-search-section">
          <div className="handbook-controls">
            <span>Search Handbook</span>
          </div>
          <div className="handbook-form">
            <input
              type="text"
              value={handbookPrompt}
              onChange={(e) => setHandbookPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your query..."
              className="handbook-input-field"
            />
          </div>

          {error ? (
            <p className="handbook-error-message">{error}</p>
          ) : (
            <div className="handbook-response-container">
              {submittedInput && (
                <div className="handbook-submitted-query">
                  <p>{submittedInput}</p>
                </div>
              )}

              {handbookResponse && (
                <div
                  className="handbook-response"
                  dangerouslySetInnerHTML={{ __html: handbookResponse }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Handbook;
