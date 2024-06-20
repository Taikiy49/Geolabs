import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import StartScreen from './StartScreen';
import SelectProgram from './SelectProgram';
import SearchFiles from './SearchFiles';
import SideMenu from './SideMenu'; // Import SideMenu component

const App = () => {
  const [step, setStep] = useState('start');
  const [programs, setPrograms] = useState([]);
  const [selectedProgram, setSelectedProgram] = useState('');
  const [isMenuOpen, setMenuOpen] = useState(false);

  const handleStart = async () => {
    try {
      const response = await axios.get('http://localhost:5000/programs');
      setPrograms(response.data);
      setStep('select');
    } catch (error) {
      console.error('There was an error fetching the programs!', error);
    }
  };

  const handleSelectProgram = (program) => {
    setSelectedProgram(program);
    if (program === 'Search Files') {
      setStep('search_files');
    }
  };

  const handleBack = () => {
    if (step === 'search_files') {
      setStep('select');
    } else if (step === 'select') {
      setStep('start');
    }
  };

  const toggleMenu = () => {
    setMenuOpen(!isMenuOpen);
  };

  return (
    <div className="container">
      <SideMenu isMenuOpen={isMenuOpen} toggleMenu={toggleMenu} />
      
      <div className="header">
        <img src="/geolabs.png" className="geolab-image" alt="Geolabs Logo"></img>
        <h1>Geolabs Software</h1>
      </div>

      <div className="app_container">
        {step === 'start' && (
          <div className="start-button-container">
            <StartScreen onStart={handleStart} />
          </div>
        )}
        {step === 'select' && (
          <div className="select-program-container">
            <SelectProgram
              programs={programs}
              onSelectProgram={handleSelectProgram}
              onBack={handleBack}
            />
          </div>
        )}
        {step === 'search_files' && (
          <SearchFiles onBack={handleBack} />
        )}
      </div>
    </div>
  );
};

export default App;
