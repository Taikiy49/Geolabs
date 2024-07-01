import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link, useLocation } from 'react-router-dom';
import './App.css';
import SearchDatabase from './SearchDatabase';
import UpdateDatabase from './UpdateDatabase';

const App = () => {
  const location = useLocation();
  const isMainPage = location.pathname === '/';

  return (
    <div className="app-container">
      <div className='top-container'>
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

        {isMainPage && (
          <div className="second-container">
            <div className='title'>Geolabs, Inc.</div>
            <div className="main-links">
              <img src='./discord.png' className='discord-button' alt='Discord' />
              <img src='./microsoft.png' className='microsoft-button' alt='Microsoft' />
            </div>
          </div>
        )}

        {isMainPage && (
          <div className='main-menu-container'>
            <div className='main-text-container'>
              <div className='subtitle'>Private Software</div>
              <div className='description'>Please connect to the VPN to use our software.</div>
              <div className='description'>Use software at your own risk.</div>
              <button className='info-button'>More Info</button>
            </div>
          </div>
        )}
      </div>

      <Routes>
        <Route path="/" element={
          <div className="container">
            <div className="options-container">
              <Link to="/update-database" className="option-box remove-link">
                <h2>Update</h2>
                <p>Updates the database in the system</p>
              </Link>
              <Link to="/search-database" className="option-box remove-link">
                <h2>Search</h2>
                <p>Search through the database to find solutions</p>
              </Link>
              <div className="option-box">
                <h2>Resume</h2>
                <p>Build resume based on specific needs</p>
              </div>
              <div className="option-box">
                <h2>Section</h2>
                <p>What will happen in this section...</p>
              </div>
            </div>
          </div>
        } />
        <Route path="/update-database" element={<UpdateDatabase />} />
        <Route path="/search-database" element={<SearchDatabase />} />
      </Routes>

    <div className='bottom-container'>
    </div>
    </div>

   
  );
};

const AppWrapper = () => (
  <Router>
    <App />
  </Router>
);

export default AppWrapper;
