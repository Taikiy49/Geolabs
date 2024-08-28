import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import '../App.css';
import './Reports.css';
import Options from './Options'
import AppRoutes from '../-MainDirectory/AppRoutes';

const Reports = () => {
  const location = useLocation();
  const isMainPage = location.pathname === '/reports';
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  return (
    <div>
      <div className="reports-container">
        <main className="main-content">
          <Options isMainPage={isMainPage} />
          <AppRoutes isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
        </main>
      </div>
    </div>
  );
};

export default Reports;
