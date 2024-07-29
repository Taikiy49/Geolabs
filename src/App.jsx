import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, useLocation } from 'react-router-dom';
import './App.css';
import Options from './-main-components/Options';
import Header from './-main-components/Header';
import AppRoutes from './-main-components/AppRoutes';
import Footer from './-main-components/Footer';

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
    <div className="app-container">
      <Header isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      <main className="main-content">
        <Options isMainPage={isMainPage} />
        <AppRoutes isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
      </main>
      <Footer />
    </div>
  );
};

const App = () => (
  <Router>
    <Main />
  </Router>
);

export default App;
