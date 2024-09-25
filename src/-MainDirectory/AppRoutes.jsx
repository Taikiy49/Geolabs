import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import Reports from '../ReportsDirectory/ReportsMain';
import Employee from '../EmployeeDirectory/Employee';
import Admin from '../AdminDirectory/AdminMain';
import Login from '../ReportsDirectory/reportsComponents/Login';
import Register from '../ReportsDirectory/reportsComponents/Register';
import Relevancy from '../ReportsDirectory/reportsComponents/Query';
import WorkOrder from '../ReportsDirectory/reportsComponents/WorkOrder';
import Handbook from '../EmployeeDirectory/employeeComponent/Handbook';
import PrivateRoute from './PrivateRoute';

const AppRoutes = ({ isAuthenticated, setIsAuthenticated }) => (
  <Routes>
    {/* Public routes: Redirect to /reports if already logged in */}
    {!isAuthenticated ? (
      <>
        <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
        <Route path="/register" element={<Register setIsAuthenticated={setIsAuthenticated} />} />
      </>
    ) : (
      // If the user is authenticated, redirect /login and /register to /reports or another default authenticated page
      <>
        <Route path="/login" element={<Navigate to="/reports" />} />
        <Route path="/register" element={<Navigate to="/reports" />} />
      </>
    )}

    {/* Protected routes */}
    <Route
      path="/reports"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <Reports />
        </PrivateRoute>
      }
    />
    <Route
      path="/employee-guide"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <Employee />
        </PrivateRoute>
      }
    />
    <Route
      path="/admin"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <Admin />
        </PrivateRoute>
      }
    />

    {/* Reports sub-routes */}
    <Route
      path="/reports/relevancy"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <Relevancy />
        </PrivateRoute>
      }
    />
    <Route
      path="/reports/work-order"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <WorkOrder />
        </PrivateRoute>
      }
    />
    <Route
      path="/employee-guide/handbook"
      element={
        <PrivateRoute isAuthenticated={isAuthenticated}>
          <Handbook />
        </PrivateRoute>
      }
    />
  </Routes>
);

export default AppRoutes;
