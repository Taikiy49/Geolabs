// Main.js
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../-MainDirectory/mainStyles/Header.css';
import Header from './Header';
import Footer from './Footer';
import AppRoutes from './AppRoutes';

const Main = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  const navigateTo = (path) => {
    navigate(path);
  };

  return (
    <div className="app-container">
      <Header isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      <div className="main-content">
        {location.pathname === '/' ? (
          <div className="options-container">
            <h2>Select an Option</h2>
            <div className="options-buttons">
              <button onClick={() => navigateTo('/reports')}>Reports</button>
              <button onClick={() => navigateTo('/employee-guide')}>Employee Guide</button>
              <button onClick={() => navigateTo('/admin')}>Admin</button>
            </div>
          </div>
        ) : (
          <AppRoutes isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
        )}
      </div>
      {/* <Footer /> */}
    </div>
  );
};

export default Main;
