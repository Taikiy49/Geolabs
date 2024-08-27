import React, { useState } from 'react';
import axios from 'axios';
import '../reportsStyle/WorkOrder.css';
import getConfig from '../../config';

const WorkOrder = () => {
  const [workOrderNumber, setWorkOrderNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { apiUrl } = getConfig();

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
      console.log('Sending work order number:', workOrderNumber); // Debugging line
      const response = await axios.post(`${apiUrl}/reports/search-work-order`, { workOrderNumber });
      if (response.data.summary) {
        // Apply similar formatting to the summary as done in SearchDatabase
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
      <h1 className="workorder-title">Work Order Summary</h1>
      <form onSubmit={handleSearch} className="workorder-form">
        <input
          type="text"
          placeholder="Enter work order number..."
          value={workOrderNumber}
          onChange={(e) => setWorkOrderNumber(e.target.value)}
          className="workorder-input"
        />
        <button type="submit" className="workorder-button">Search</button>
      </form>
      {loading && <p className="workorder-loading">Loading...</p>}
      {error && <p className="workorder-error">{error}</p>}
      {summary && (
        <div className="workorder-summary">
          <h2>Summary:</h2>
          {/* Display formatted summary */}
          <div dangerouslySetInnerHTML={{ __html: summary }} />
        </div>
      )}
    </div>
  );
};

export default WorkOrder;
