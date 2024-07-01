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
            <button className='geolabs-link'></button>
            <button className='geolabs-link'></button>
            <button className='geolabs-link'></button>
          </div>
        </div>
      )}

      {isMainPage && (
        <>
        <div className='main-text-container'>
          <div className='subtitle'>Private Software</div>
          <div className='description'>Please connect to the VPN to use our software.</div>
          <div className='description'>Use software at your own risk.</div>
          <button className='info-button'>More Info</button>
          <img src='./construction1.png' className='main-menu-img1' alt='Before Construction'></img>
        </div>
        </>
      )}

      <Routes>
        <Route path="/" element={
          <div className="container">
            <div className="options-container">
              <Link to="/update-database" className="option-box remove-link">
                <h2>Update</h2>
              </Link>
              <p>Updates the database in the system</p>
              <Link to="/search-database" className="option-box remove-link clip-right">
                <h2>Search</h2>
              </Link>
              <p className='clip-right'>Search through the database to find solutions</p>
      
              <div className="option-box remove-link">
                <h2>Resume</h2>
              </div>
              <p>Build resume based on specific needs</p>

              <div className="option-box remove-link clip-right">
                <h2>Section</h2>
              </div>
              <p className='clip-right'>What will happen in this section...</p>
              <div className="option-box remove-link">
                <h2>Section</h2>
              </div>
              <p>What will happen in this section...</p>
              <div className="option-box remove-link clip-right">
                <h2>Section</h2>
              </div>
              <p className='clip-right'>What will happen in this section...</p>
            </div>

            <div className='main-menu-img-container'>
              <img src='./construction2.png' className='main-menu-img2' alt='After Construction'></img>
              <img src='./construction1.png' className='main-menu-img1' alt='Before Construction'></img>
            </div>vb
          </div>
        } />
        <Route path="/update-database" element={<UpdateDatabase />} />
        <Route path="/search-database" element={<SearchDatabase />} />
      </Routes>
    </div>
  );
};

const AppWrapper = () => (
  <Router>
    <App />
  </Router>
);

export default AppWrapper;
