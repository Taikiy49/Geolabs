import React from 'react';
import { useNavigate } from 'react-router-dom';

const LeftSidebar = ({ isAuthenticated, setIsAuthenticated }) => {
  const navigate = useNavigate();

  return (
    <header className="app-header">
      <nav className="nav-buttons">
        <button className="nav-button" onClick={() => navigate('/about')}>About</button>
        <button className="nav-button" onClick={() => navigate('/contact')}>Contact</button>
      </nav>
    </header>
  );
};

export default LeftSidebar;
