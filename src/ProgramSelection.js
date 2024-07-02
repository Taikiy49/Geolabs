// ProgramSelection.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ProgramSelection.css';

const ProgramSelection = () => {
  const navigate = useNavigate();

  return (
    <div className="container">
      <div className="options-container">
        <div className="option-box" onClick={() => navigate('/program-selection/update-database')}>
          <h2>Update</h2>
          <p>Updates the database in the system</p>
        </div>
        <div className="option-box" onClick={() => navigate('/program-selection/search-database')}>
          <h2>Search</h2>
          <p>Search through the database to find solutions</p>
        </div>
        <div className="option-box" onClick={() => navigate('/program-selection/build-resume')}>
          <h2>Resume</h2>
          <p>Build resume based on specific needs</p>
        </div>
        <div className="option-box" onClick={() => navigate('/section-info')}>
          <h2>Section</h2>
          <p>What will happen in this section...</p>
        </div>
        <div className="option-box" onClick={() => navigate('/section-info')}>
          <h2>Section</h2>
          <p>What will happen in this section...</p>
        </div>
        <div className="option-box" onClick={() => navigate('/section-info')}>
          <h2>Section</h2>
          <p>What will happen in this section...</p>
        </div>
      </div>
    </div>
  );
};

export default ProgramSelection;
