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
        <a href='https://www.geolabs.net/'><img src='geolabs.png' className='geolabs-img' alt='geolabs website'></img></a>
        <div className="logo" onClick={() => navigate('/')}>Geolabs, Inc.</div>


        <nav className="nav-buttons">
          <button className="nav-button" onClick={() => navigate('/')}>Home</button>
          <button className="nav-button" onClick={() => navigate('/reports')}>Reports</button>
          <button className="nav-button" onClick={() => navigate('/employee-guide')}>Employee Guide</button>
          <button className="nav-button" onClick={() => navigate('/admin')}>Admin</button>
        </nav>

        <div className="auth-buttons">
          {!isAuthenticated ? (
            <>
              <button className="auth-button header-login-button" onClick={() => navigate('/login')}>Login</button>
              <button className="auth-button header-register-button" onClick={() => navigate('/register')}>Register</button>
            </>
          ) : (
            <button className="auth-button" onClick={handleLogout}>Logout</button>
          )}
        </div>
      
      
      </header>
    </>
  );
};

export default Header;
