import React from 'react';
import './ProgramSelection.css';

const ProgramSelection = ({ onSelectProgram }) => {
  return (
    <div className="options-container">
      <div className="option-box" onClick={() => onSelectProgram('Search Files')}>
        <h2>Search</h2><p>Read PDFs to find specific information</p>
      </div>
      <div className="option-box" onClick={() => onSelectProgram('Option 2')}>
        <h2>Resume</h2><p>Build resume based on specific needs</p>
      </div>
      <div className="option-box" onClick={() => onSelectProgram('Option 3')}>
        <h2>Section</h2><p>What will happen in this section...</p>
      </div>
    </div>
  );
};

export default ProgramSelection;
