import React, { useState } from 'react';
import './App.css';
import StartScreen from './StartScreen';
import SearchFiles from './SearchFiles';
import SideMenu from './SideMenu';

const App = () => {
  const [step, setStep] = useState('start');
  const [selectedProgram, setSelectedProgram] = useState('');
  const [isMenuOpen, setMenuOpen] = useState(false);

  const handleSelectProgram = (program) => {
    setSelectedProgram(program);
    if (program === 'Search Files') {
      setStep('search_files');
    }
  };

  const handleBack = () => {
    setStep('start');
  };

  const toggleMenu = () => {
    setMenuOpen(!isMenuOpen);
  };

  return (
    <div className="background">
      <div className="top-container">
        <SideMenu isMenuOpen={isMenuOpen} toggleMenu={toggleMenu} />
      </div>

      <div className="container">
        <div className={`app_container ${isMenuOpen ? 'menu-open' : ''}`}>
          {step === 'start' && (
            <StartScreen onSelectProgram={handleSelectProgram} />
          )}
          {step === 'search_files' && (
            <SearchFiles onBack={handleBack} />
          )}
        </div>
        
      </div>
    </div>
  );
};

export default App;
