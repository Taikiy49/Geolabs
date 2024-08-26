import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, useLocation } from 'react-router-dom';
import './App.css';
import Options from './-main-components/Options';
import LeftSidebar from './-main-components/LeftSidebar';
import RightSidebar from './-main-components/RightSidebar';
import AppRoutes from './-main-components/AppRoutes';

const Main = () => {
  const location = useLocation();
  const isMainPage = location.pathname === '/';
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  return (
    <div>
      <div className="app-container">
        <LeftSidebar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
        <main className="main-content">
          <Options isMainPage={isMainPage} />
          <AppRoutes isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
        </main>
        <RightSidebar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      </div>
    </div>
  );
};

const App = () => (
  <Router>
    <Main />
  </Router>
);

export default App;
