// ProgramSelection.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/ProgramSelection.css';

const ProgramSelection = () => {
  const navigate = useNavigate();

  return (
    <div className="program-selection-container">
      <div className='add-remove-container'>
          <div className="add-remove-option-box" onClick={() => navigate('/program-selection/add-files')}>
            <h2>Add Files</h2>
          </div>
        <div className="add-remove-option-box" onClick={() => navigate('/program-selection/remove-files')}>
          <h2>Remove Files</h2>
        </div>
        <div className='add-remove-text'>Please be cautious when using this method, as it affects the shared database accessed by all users. Ensure to seek authorization before proceeding, as only authorized personnel are permitted to use these options</div>
      </div>

      <div className="options-container">
        <div className="option-box" onClick={() => navigate('/program-selection/search-database')}>
          <h2>Search</h2>
          <p>Search through the database to find solutions</p>
        </div>
        <div className="option-box" onClick={() => navigate('/program-selection/build-resume')}>
          <h2>Resume</h2>
          <p>Build resume based on specific needs</p>
        </div>
        <div className="option-box" onClick={() => navigate('/program-selection/relevancy')}>
          <h2>Relevancy</h2>
          <p>Write a word and find relevant files</p>
        </div>
        <div className="option-box" onClick={() => navigate('/program-selection/section-info')}>
          <h2>Work Order</h2>
          <p>Enter work order number and gather information</p>
        </div>
      </div>
    </div>
  );
};

export default ProgramSelection;
