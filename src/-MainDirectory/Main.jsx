import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../-MainDirectory/mainStyles/Header.css';
import Header from './Header';
import Footer from './Footer';
import AppRoutes from './AppRoutes';
import '../-MainDirectory/mainStyles/Main.css';

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
    <div className="main-app-container">
      <Header isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      <div className="main-main-content">
        {location.pathname === '/' ? (
          <>
            <div className='main-software-intro-container'>
              <div className='main-software-intro-text-container'>
                <h1 className="main-software-title">SOFTWARE</h1>
                <p className="main-software-description">
                  Explore a range of tools designed to streamline your workflow, improve efficiency, and provide tailored insights. Select an option to get started and make the most out of our AI-driven solutions.
                </p>
              </div>
            </div>
            <div className="main-options-container">
              <div className="main-options">
                <div className='main-reports-container'>
                  <img src='reports-img.png' className='main-reports-img' />
                  <img src='arrow.png' className='main-reports-arrow'/>
                  <div className="main-button-container">
                    <div onClick={() => navigateTo('/reports')} className='main-button-style'>
                      Reports
                      <p className='main-button-description-style'>
                        Manage and analyze various reports with ease. Search, select, and interact with specific files to obtain tailored insights and answers from our AI model.
                      </p>
                    </div>
                  </div>
                </div>

                <div className='main-employee-guide-container'>
                  <div className="main-button-container">
                    <div onClick={() => navigateTo('/employee-guide')} className='main-button-style'>
                      Employee Guide
                      <p className='main-button-description-style'>
                        Get instant answers to any questions about the employee handbook. Simply type your query and let the AI assist you in navigating through the guide.
                      </p>
                    </div>
                  </div>
                  <img src='arrow.png' className='main-employee-arrow'/>
                  <img src='employee-guide-img.png' className='main-employee-guide-img' />
                  
                </div>
              </div>
            </div>
          </>
        ) : (
          <AppRoutes isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
        )}
      </div>
      {/* <Footer /> */}
    </div>
  );
};

export default Main;
