import React, { useState } from 'react';
import './App.css';
import ProgramSelection from './ProgramSelection';
import SearchFiles from './SearchFiles';

const App = () => {
  const [step, setStep] = useState('start');
  const [selectedProgram, setSelectedProgram] = useState('');

  const handleSelectProgram = (program) => {
    if (program === 'Search Files') {
      setStep('search_files');
    }
  };

  const handleBack = () => {
    setStep('start');
  };


  return (
    <div className="app-container">

      <header>
        <div className='header-buttons'>
          <button className='header-button'>About</button>
          <button className='header-button'>About</button>
          <button className='header-button'>About</button>
        </div>

        <div className='auth-buttons'>
          <button className='auth-button'>Register</button>
          <button className='auth-button'>Login</button>
        </div>

      </header>

      <div className='title'>Geolabs, Inc.</div>
      <div className='subtitle'>Private Software</div>
      <div className='description'>Please connect to the VPN to use our software.</div>
      <div className='description'>Use sofware at your own risk.</div>
      <button className='info-button'>More Info</button>

      <body>
        <div className="container">
          {step === 'start' && (
            <ProgramSelection onSelectProgram={handleSelectProgram} />
          )}
          {step === 'search_files' && (
            <SearchFiles onBack={handleBack} />
          )}
        </div>
        
        <img src='./construction.png' className='main-menu-img'></img>
      </body>
    
      <footer><p>&copy; 2024 Geolabs, Inc. All rights reserved.</p></footer>

    </div>

  );
};

export default App;
