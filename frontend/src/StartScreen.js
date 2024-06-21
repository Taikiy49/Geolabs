import React from 'react';
import './StartScreen.css';

const StartScreen = ({ onSelectProgram }) => {
  return (
    <div className="start-screen">
      <header className="header">
        <h1>Geolabs Software</h1>
      </header>
      <div className="options-container">
        <div className="option-box" onClick={() => onSelectProgram('Search Files')}>
          <h2>Query</h2>
          <p>Read PDFs to find specific information</p>
        </div>
        <div className="option-box" onClick={() => onSelectProgram('Option 2')}>
          <h2>Resume</h2>
          <p>Build resume based on specific needs</p>
        </div>
        <div className="option-box" onClick={() => onSelectProgram('Option 3')}>
          <h2>Section</h2>
          <p>What will happen in this section...</p>
        </div>
      </div>
    </div>
  );
};

export default StartScreen;
