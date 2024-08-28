import React from 'react';
import { useNavigate } from 'react-router-dom';

const Header = ({ isAuthenticated, setIsAuthenticated }) => {
  const navigate = useNavigate();
  
  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setIsAuthenticated(false);
    navigate('/reports');
  };

  return (
    <>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>Geolabs, Inc.</div>
        <img src='geolabs.png' className='geolabs-img'></img>
      </header>
      
      <div className="navbar">
        <nav className="nav-buttons">
          <button className="nav-button" onClick={() => navigate('/about')}>About</button>
          <button className="nav-button" onClick={() => navigate('/contact')}>Contact</button>
        </nav>

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
      </div>
    </>
  );
};

export default Header;