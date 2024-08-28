// AppRoutes.js
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import Reports from '../ReportsDirectory/ReportsMain';
import EmployeeGuide from '../EmployeeDirectory/EmployeeMain';
import Admin from '../AdminDirectory/AdminMain';
import Login from '../ReportsDirectory/reportsComponents/Login';
import Register from '../ReportsDirectory/reportsComponents/Register';
import Relevancy from '../ReportsDirectory/reportsComponents/Query';
import WorkOrder from '../ReportsDirectory/reportsComponents/WorkOrder';

const AppRoutes = ({ isAuthenticated, setIsAuthenticated }) => (
  <Routes>
    {/* Main routes */}
    <Route path="/reports" element={<Reports />} />
    <Route path="/employee-guide" element={<EmployeeGuide />} />
    <Route path="/admin" element={<Admin />} />
    
    {/* Reports sub-routes */}
    <Route path="/reports/relevancy" element={<Relevancy />} />
    <Route path="/reports/work-order" element={<WorkOrder />} />
    
    {/* Other routes */}
    <Route path="/about" element={<div>About Page</div>} />
    <Route path="/contact" element={<div>Contact Page</div>} />
    <Route path="/register" element={<Register setIsAuthenticated={setIsAuthenticated} />} />
    <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
  </Routes>
);

export default AppRoutes;
