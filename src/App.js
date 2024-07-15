import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import './App.css';
import SearchDatabase from './SearchDatabase';
import UpdateDatabase from './UpdateDatabase';
import ProgramSelection from './ProgramSelection';
import Login from './Login';
import Register from './Register';
import PrivateRoute from './PrivateRoute'; 

const Main = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isMainPage = location.pathname === '/';
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>Geolabs, Inc.</div>
        <nav className="nav-buttons">
          <button className="nav-button" onClick={() => navigate('/about')}>About</button>
          <button className="nav-button" onClick={() => navigate('/contact')}>Contact</button>
        </nav>
        <div className="auth-buttons">
          {!isAuthenticated && (
            <>
              <button className="auth-button" onClick={() => navigate('/register')}>Register</button>
              <button className="auth-button" onClick={() => navigate('/login')}>Login</button>
            </>
          )}
        
        </div>
      </header>

      <main className="main-content">
        <div className='stars'></div>
        <div className="inner-borders"></div>
        {isMainPage && (
          <div className='hero-sections'>
            <div className="hero-section">
              <h1 className="hero-title">Private Software</h1>
              <p className="hero-description">Please connect to the VPN to use our software. Use software at your own risk.</p>
              <button className="hero-button" onClick={() => navigate('/program-selection')}>Start</button>
            </div>
          
            <div className="hero-section">
              <h1 className="hero-title">Features</h1>
              <p className="hero-description">Our software offers a range of powerful features to enhance your productivity.</p>
              <button className="hero-button" onClick={() => navigate('/features')}>Learn More</button>
            </div>
          
            <div className="hero-section">
              <h1 className="hero-title">FAQs</h1>
              <p className="hero-description">Got questions? We might have answers to your question! Check out our FAQs.</p>
              <button className="hero-button" onClick={() => navigate('/faq')}>View FAQs</button>
            </div>
          </div>
        )}

        <Routes>
          <Route path="/" element={<div className="container" />} />
          <Route path="/program-selection" element={<PrivateRoute isAuthenticated={isAuthenticated}><ProgramSelection /></PrivateRoute>} />
          <Route path="/program-selection/update-database" element={<PrivateRoute isAuthenticated={isAuthenticated}><UpdateDatabase /></PrivateRoute>} />
          <Route path="/program-selection/search-database" element={<PrivateRoute isAuthenticated={isAuthenticated}><SearchDatabase /></PrivateRoute>} />
          <Route path="/about" element={<div>About Page</div>} />
          <Route path="/contact" element={<div>Contact Page</div>} />
          <Route path="/register" element={<Register setIsAuthenticated={setIsAuthenticated} />} />
          <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
        </Routes>
      </main>

      <footer className="app-footer">
          <p>© 2024 Geolabs, Inc. All Rights Reserved.</p>
          <p>Designed by Taiki Owen Yamashita</p>
          <p>(808) 450-5767</p>
      </footer>
    </div>
  );
};

const App = () => (
  <Router>
    <Main />
  </Router>
);

export default App;
