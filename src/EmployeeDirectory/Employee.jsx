import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom'; // Import useNavigate hook
import './Employee.css';
import getConfig from '../config';

const { apiUrl } = getConfig(); // Fetch the API URL from your configuration

const employeeOptions = [
  { 
    title: 'Employee Handbook', 
    description: 
      'Access detailed information on company policies, including attendance, dress code, and workplace conduct. Ensure you stay compliant by reviewing these essential guidelines.', 
    path: '/employee-guide/handbook', // Add the path for navigation
  },
  { 
    title: 'Unknown', 
    description: 
      'Learn about the benefits offered by the company, including health insurance, retirement plans, and other employee perks. Get all the details you need to make informed decisions.', 
  },
];

const bottomOptions = [
  { title: 'Upload', icon: 'fas fa-upload' },
  { title: 'Remove', icon: 'fas fa-trash-alt' },
];

const Employee = () => {
  const [filteredEmployeeOptions] = useState(employeeOptions);
  const [filteredBottomOptions] = useState(bottomOptions);
  const [setUploading] = useState(false);
  const navigate = useNavigate(); // Initialize the navigate function


  const handleFileUpload = (event) => {
    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < event.target.files.length; i++) {
      formData.append('files', event.target.files[i]);
    }

    axios.post(`${apiUrl}/employee-guide/upload-files`, formData) // Send the request to the backend
      .then(response => {
        alert('Files uploaded successfully');
        setUploading(false);
      })
      .catch(error => {
        console.error('Error uploading files:', error);
        setUploading(false);
      });
  };

  const openFileDialog = () => {
    document.getElementById('fileInput').click();
  };

  const handleOptionClick = (option) => {
    if (option.path) {
      navigate(option.path); // Navigate to the specified path if it exists
    }
  };

  return (
    <div className="employee-container">
      <div className="inner-borders">
        <div className="employee-sections">
          <div className='employee-text-container'>
            <h1 className="employee-title">Employee Handbook</h1>
            <p className='employee-description'>Please note that this software is currently under development. Some features may be incomplete or not functioning at their full capacity at this time.</p>
          </div>
          <div className='employee-mini-container'>
            <div className="employee-section">
              <div className="options-container">
                {filteredEmployeeOptions.map((option, index) => (
                  <div key={index} className="option-box" onClick={() => handleOptionClick(option)}>
                    <h2>{option.title}</h2>
                    <p>{option.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="file-actions-container">
              <div className="add-remove-container">
                {filteredBottomOptions.map((option, index) => (
                  <div key={index} className="add-remove-option-box" onClick={option.title === 'Upload' ? openFileDialog : null}>
                    <i className={option.icon}></i>
                    <p className='employee-remove-text'>{option.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <input
        id="fileInput"
        type="file"
        multiple
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />
    </div>
  );
};

export default Employee;
