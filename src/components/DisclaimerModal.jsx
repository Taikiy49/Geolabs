import React from 'react';
import '../styles/DisclaimerModal.css';

export default function DisclaimerModal({ onContinue, onCancel }) {
  return (
    <div className="disclaimer-overlay">
      <div className="disclaimer-modal">
        <h2>⚠️ Chat Submission Notice</h2>
        <p>
          Any question you submit will be saved to a shared chat history that is visible to others in the company.
          This makes it easier for everyone to view commonly asked questions and avoid duplicates.
          Please avoid submitting personal or sensitive information. If you submit something by mistake, you can right-click the entry to delete it from the chat history.
        </p>
        <div className="disclaimer-buttons">
          <button onClick={onCancel} className="cancel-btn">Cancel</button>
          <button onClick={onContinue} className="continue-btn">Continue</button>
        </div>
      </div>
    </div>
  );
}
