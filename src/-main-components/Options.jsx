import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Options = ({ isMainPage }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredSoftwareOptions, setFilteredSoftwareOptions] = useState([]);
  const [filteredBottomOptions, setFilteredBottomOptions] = useState([]);
  const [files, setFiles] = useState([]);
  const [totalFiles, setTotalFiles] = useState(0);

  const softwareOptions = [
    { title: 'Search', description: 'Search through the database to find solutions', path: '/program-selection/search-database' },
    { title: 'Resume', description: 'Build resume based on specific needs', path: '/program-selection/build-resume' },
    { title: 'Relevancy', description: 'Write a word and find relevant files', path: '/program-selection/relevancy' },
    { title: 'Work Order', description: 'Enter work order number and gather information', path: '/program-selection/section-info' },
    { title: 'Section', description: 'What will happen in this section...', path: '/program-selection/section-info' },
    { title: 'Section', description: 'What will happen in this section...', path: '/program-selection/section-info' },
  ];

  const bottomOptions = [
    { title: 'Add Files', description: '', path: '/program-selection/add-files' },
    { title: 'Remove Files', description: '', path: '/program-selection/remove-files' },
    { title: 'FAQs', description: 'Got questions? We might have answers to your questions! Check out our FAQs.', path: '/faq' },
  ];

  useEffect(() => {
    if (searchQuery) {
      setFilteredSoftwareOptions(
        softwareOptions.filter(
          option =>
            option.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            option.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
      setFilteredBottomOptions(
        bottomOptions.filter(
          option =>
            option.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            option.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredSoftwareOptions(softwareOptions);
      setFilteredBottomOptions(bottomOptions);
    }
  }, [searchQuery]);

  useEffect(() => {
    // Fetch the list of files from the backend
    axios.get('/program-selection/list-files')
      .then(response => {
        setFiles(response.data.files);
        setTotalFiles(response.data.total);
      })
      .catch(error => {
        console.error('There was an error fetching the files!', error);
      });
  }, []);

  return (
    <div className="app-container">
      <div>
        <div className="inner-borders">
          {isMainPage && (
            <div className="software-sections">
              <div className='main-search'>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
              <div className="software-section">
                <h1 className="software-title">Private Software</h1>
                <p className="software-description">Please connect to the VPN to use our software. Use software at your own risk.</p>
                <div className="options-container">
                  {filteredSoftwareOptions.map((option, index) => (
                    <div
                      key={index}
                      className="option-box"
                      onClick={() => navigate(option.path)}
                    >
                      <h2>{option.title}</h2>
                      <p>{option.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className='bottom-section'>
                <div className="database-section">
                  <h1 className="database-title">Features</h1>
                  <p className="database-description">Our software offers a range of powerful features to enhance your productivity.</p>

                  {/* Scrollable list of files */}
                  <div className="file-list-container">
                    <h2>Total Files: {totalFiles}</h2>
                    <div className="scrollable-file-list">
                      {files.map((file, index) => (
                        <div key={index} className="file-item">
                          {file.filename}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className='add-remove-container'>
                    {filteredBottomOptions
                      .filter(option => option.title === 'Add Files' || option.title === 'Remove Files')
                      .map((option, index) => (
                        <div
                          key={index}
                          className="add-remove-option-box"
                          onClick={() => navigate(option.path)}
                        >
                          <h2>{option.title}</h2>
                        </div>
                      ))}
                    <div className='add-remove-text'>
                      Please be cautious when using this method, as it affects the shared database accessed by all users. Ensure to seek authorization before proceeding, as only authorized personnel are permitted to use these options.
                    </div>
                  </div>
                </div>

                <div className="another-section">
                  {filteredBottomOptions
                    .filter(option => option.title === 'FAQs')
                    .map((option, index) => (
                      <div key={index}>
                        <h1 className="another-title">{option.title}</h1>
                        <p className="another-description">{option.description}</p>
                        <button className="another-button" onClick={() => navigate(option.path)}>View FAQs</button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Options;
