import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../reportsStyle/WorkOrder.css';
import getConfig from '../../config';

const WorkOrder = () => {
  const [workOrderNumber, setWorkOrderNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [suggestions, setSuggestions] = useState([]); // State to store work order suggestions
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { apiUrl } = getConfig();

  // Fetch work order suggestions as user types
  useEffect(() => {
    if (workOrderNumber.length > 1) {
      axios
        .get(`${apiUrl}/reports/work-order-suggestions?query=${workOrderNumber}`)
        .then((response) => {
          setSuggestions(response.data.suggestions);
        })
        .catch((err) => {
          console.error(err);
        });
    } else {
      setSuggestions([]);
    }
  }, [workOrderNumber]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!workOrderNumber) {
      setError('Please enter a valid work order number.');
      return;
    }
    setLoading(true);
    setError('');
    setSummary('');

    try {
      const response = await axios.post(`${apiUrl}/reports/search-work-order`, { workOrderNumber });
      if (response.data.summary) {
        let formattedSummary = response.data.summary
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/^\s*\*\s*(.+)$/gm, '<li>$1</li>');
        formattedSummary = `<ul>${formattedSummary}</ul>`;
        setSummary(formattedSummary);
      } else {
        setError('No summary found for this work order.');
      }
    } catch (err) {
      console.error('Error fetching summary:', err);
      setError('An error occurred while fetching the summary.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="workorder-container">
      <div className='workorder-left-menu'>
        <p className='workorder-instructions-text'>Enter work order:</p>
        <form onSubmit={handleSearch} className="workorder-form">
          <input
            type="text"
            placeholder="####-##"
            value={workOrderNumber}
            onChange={(e) => setWorkOrderNumber(e.target.value)}
            className="workorder-input"
          />
        </form>
        {suggestions.length > 0 && (
          <ul className="workorder-suggestions">
            {suggestions.map((suggestion, index) => (
              <li key={index} onClick={() => setWorkOrderNumber(suggestion)}>
                {suggestion}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className='workorder-right-container'>
        {loading && <p className="workorder-loading">Loading...</p>}
        {error && <p className="workorder-error">{error}</p>}
        {summary && (
          <div className="workorder-summary">
            <div dangerouslySetInnerHTML={{ __html: summary }} />
          </div>
        )}
        </div>
    </div>
  );
};

export default WorkOrder;
