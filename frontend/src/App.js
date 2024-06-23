import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import './App.css';
import SearchFiles from './SearchFiles';

const App = () => {
  return (
    <Router>
      <div className="app-container">
        <header>
          <div className='header-buttons'>
            <button className='header-button'>About</button>
            <button className='header-button'>Q&A</button>
            <button className='header-button'>Contact</button>
          </div>

          <div className='auth-buttons'>
            <button className='auth-button'>Register</button>
            <button className='auth-button'>Login</button>
          </div>
        </header>

        <div className="second-container">
          <div className='title'>Geolabs, Inc.</div>
          <div className="main-links">
            <button className='geolabs-link'></button> 
            <button className='geolabs-link'></button>
            <button className='geolabs-link'></button>
          </div>
        </div>

        <div className='subtitle'>Private Software</div>
        <div className='description'>Please connect to the VPN to use our software.</div>
        <div className='description'>Use software at your own risk.</div>
        <button className='info-button'>More Info</button>

        <Routes>
          <Route path="/" element={
            <div className="container">
              <div className="options-container">
                <Link to="/search-files" className="option-box remove-link">
                  <h2>Search</h2><p>Read PDFs to find specific information</p>
                </Link>
                <div className="option-box remove-link">
                  <h2>Resume</h2><p>Build resume based on specific needs</p>
                </div>
                <div className="option-box remove-link">
                  <h2>Section</h2><p>What will happen in this section...</p>
                </div>
                <div className="option-box remove-link">
                  <h2>Section</h2><p>What will happen in this section...</p>
                </div>
                <div className="option-box remove-link">
                  <h2>Section</h2><p>What will happen in this section...</p>
                </div>
                <div className="option-box remove-link">
                  <h2>Section</h2><p>What will happen in this section...</p>
                </div>
              </div>
              <div className='main-menu-img-container'>
                <img src='./construction1.png' className='main-menu-img1' alt='Before Construction'></img>
                <img src='./construction2.png' className='main-menu-img2' alt='After Construction'></img>
              </div>
            </div>
          } />
          <Route path="/search-files" element={<SearchFiles />} />
        </Routes>

        <footer><p>&copy; 2024 Geolabs, Inc. All rights reserved.</p></footer>
      </div>
    </Router>
  );
};

export default App;
