// Main.js
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../App.css';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
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
      <LeftSidebar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
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
      <RightSidebar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
    </div>
  );
};

export default Main;
