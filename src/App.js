import React from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import './App.css';
import SearchDatabase from './SearchDatabase';
import UpdateDatabase from './UpdateDatabase';
import ProgramSelection from './ProgramSelection';

const Main = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isMainPage = location.pathname === '/';

  return (
    <div className="app-container">
      <div className='stars'></div>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>Geolabs, Inc.</div>
        <nav className="nav-buttons">
          <button className="nav-button" onClick={() => navigate('/about')}>About</button>
          <button className="nav-button" onClick={() => navigate('/qa')}>Q&A</button>
          <button className="nav-button" onClick={() => navigate('/contact')}>Contact</button>
        </nav>
        <div className="auth-buttons">
          <button className="auth-button" onClick={() => navigate('/register')}>Register</button>
          <button className="auth-button" onClick={() => navigate('/login')}>Login</button>
        </div>
      </header>

      <main className="main-content">
        <div className="inner-borders"></div>
        {isMainPage && (
          <div className='hero-sections' data-before="Text for ::before" data-after="Text for ::after">
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
          <Route path="/program-selection" element={<ProgramSelection />} />
          <Route path="/program-selection/update-database" element={<UpdateDatabase />} />
          <Route path="/program-selection/search-database" element={<SearchDatabase />} />
          <Route path="/about" element={<div>About Page</div>} />
          <Route path="/qa" element={<div>Q&A Page</div>} />
          <Route path="/contact" element={<div>Contact Page</div>} />
          <Route path="/register" element={<div>Register Page</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <img src='./discord.png' className='footer-icon' alt='Discord' />
          <img src='./microsoft.png' className='footer-icon' alt='Microsoft' />
        </div>
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
