import React from 'react';
import { useNavigate } from 'react-router-dom';

const RightSidebar = ({ isAuthenticated, setIsAuthenticated }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setIsAuthenticated(false);
    navigate('/');
  };

  return (
    <header className="app-header">
      <div className="auth-buttons">
        {!isAuthenticated ? (
          <>
            <button className="auth-button" onClick={() => navigate('/register')}>Register</button>
            <button className="auth-button" onClick={() => navigate('/login')}>Login</button>
          </>
        ) : (
          <button className="auth-button" onClick={handleLogout}>Logout</button>
        )}
      </div>
    </header>
  );
};

export default RightSidebar;
