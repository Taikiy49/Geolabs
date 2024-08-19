import React from 'react';
import { Route, Routes } from 'react-router-dom';
import SearchDatabase from '../components/SearchDatabase';
import AddFiles from '../components/AddFiles'
import ProgramSelection from '../components/ProgramSelection';
import Login from '../components/Login';
import Register from '../components/Register';
import PrivateRoute from '../components/PrivateRoute';
import RemoveFiles from '../components/RemoveFiles';
import Relevancy from '../components/Relevancy';

const AppRoutes = ({ isAuthenticated, setIsAuthenticated }) => (
  <Routes>
    <Route path="/" element={<div className="container" />} />
    <Route path="/program-selection" element={<PrivateRoute isAuthenticated={isAuthenticated}><ProgramSelection /></PrivateRoute>} />
    <Route path="/program-selection/add-files" element={<AddFiles />} />
    <Route path="/program-selection/search-database" element={<SearchDatabase />} />
    <Route path="/program-selection/remove-files" element={<RemoveFiles />} />
    <Route path="/program-selection/relevancy" element ={<Relevancy />} />
    <Route path="/about" element={<div>About Page</div>} />
    <Route path="/contact" element={<div>Contact Page</div>} />
    <Route path="/register" element={<Register setIsAuthenticated={setIsAuthenticated} />} />
    <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
  </Routes>
);

export default AppRoutes;
