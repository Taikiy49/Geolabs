import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import getConfig from '../config';
import '../styles/Login.css';

const Login = ({ setIsAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const { apiUrl } = getConfig();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${apiUrl}/login`, { email, password });
      if (response.status === 200) {
        // Store the authentication token in localStorage
        localStorage.setItem('authToken', response.data.token);
        setIsAuthenticated(true);
        navigate('/program-selection');
      }
    } catch (error) {
      alert('Invalid credentials');
    }
  };

  return (
    <div className="login-box">
      <h2 className="login-title">Login</h2>
      <form onSubmit={handleSubmit} className="login-form">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login-input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="login-input"
        />
        <button type="submit" className="login-button">Submit</button>
      </form>
    </div>
  );
};

export default Login;
