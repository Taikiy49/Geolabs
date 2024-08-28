import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import getConfig from '../config';

const softwareOptions = [
  { 
    title: 'Query', 
    description: 
      'Use the AI model to ask questions about reports in the private database. Customize your search by selecting up to 10 specific files to ask the chatbot, ensuring you get the most relevant answers. Perfect for deep dives into specific project details or general inquiries.', 
    path: '/reports/relevancy', 
    logo: '/query.png' 
  },
  { 
    title: 'Work Order', 
    description: 
      'Enter a work order number to receive a summary of the project. Enhance your search by selecting specific details you want to learn more about. This feature allows for a focused exploration of project information, with customizable selections to meet your needs.', 
    path: '/reports/work-order', 
    logo: '/number.png' 
  },
];


const bottomOptions = [
  { title: '+', description: '', path: '/reports/add-files' },
  { title: '-', description: '', path: '/reports/remove-files' },
];

const Options = ({ isMainPage }) => {
  const { apiUrl } = getConfig();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredSoftwareOptions, setFilteredSoftwareOptions] = useState(softwareOptions);
  const [filteredBottomOptions, setFilteredBottomOptions] = useState(bottomOptions);
  const [files, setFiles] = useState([]);
  const [totalFiles, setTotalFiles] = useState(0);

  useEffect(() => {
    if (searchQuery) {
      const lowerCaseQuery = searchQuery.toLowerCase();
      setFilteredSoftwareOptions(
        softwareOptions.filter(
          option =>
            option.title.toLowerCase().includes(lowerCaseQuery) ||
            option.description.toLowerCase().includes(lowerCaseQuery)
        )
      );
      setFilteredBottomOptions(
        bottomOptions.filter(
          option =>
            option.title.toLowerCase().includes(lowerCaseQuery) ||
            option.description.toLowerCase().includes(lowerCaseQuery)
        )
      );
    } else {
      setFilteredSoftwareOptions(softwareOptions);
      setFilteredBottomOptions(bottomOptions);
    }
  }, [searchQuery]);

  useEffect(() => {
    axios.get(`${apiUrl}/reports/list-files`)
      .then(response => {
        setFiles(response.data);
        setTotalFiles(response.data.length);
      })
      .catch(error => {
        console.error('There was an error fetching the files!', error);
      });
  }, [apiUrl]);

  return (
    <div className="reports-container">
      <div className="inner-borders">
        {isMainPage && (
          <div className="software-sections">
            <div className="title-search-container">
              <h1 className="software-title">Project Reports</h1>
              <div className="main-search">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
            </div>

            <div className='reports-mini-container'> 
              <div className="software-section">
                <div className="options-container">
                  {filteredSoftwareOptions.map((option, index) => (
                    <div
                      key={index}
                      className="option-box"
                      onClick={() => navigate(option.path)}
                    >
                      <img src={option.logo} alt={`${option.title} logo`} className="option-logo" />
                      <h2>{option.title}</h2>
                      <p>{option.description}</p>
                    </div>
                  ))}
                </div>

              </div>
              <div className="file-actions-container">
              <h2 className="file-list-title">Total Files: {totalFiles}</h2>
                <div className="file-list-container">
                  <div className="scrollable-file-list">
                    {files.map((file, index) => (
                      <div key={index} className="file-item">
                        {file.filename}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="add-remove-container">
                  {filteredBottomOptions.map((option, index) => (
                    <div
                      key={index}
                      className="add-remove-option-box"
                      onClick={() => navigate(option.path)}
                    >
                      <h2>{option.title}</h2>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Options;
