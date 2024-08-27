import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// Define options outside the component
const softwareOptions = [
  { title: 'Search', description: 'Search through the database to find solutions', path: '/reports/search-database' },
  { title: 'Resume', description: 'Build resume based on specific needs', path: '/reports/build-resume' },
  { title: 'Relevancy', description: 'Write a word and find relevant files', path: '/reports/relevancy' },
  { title: 'Work Order', description: 'Enter work order number and gather information', path: '/reports/work-order' },
  { title: 'Section', description: 'What will happen in this section...', path: '/reports/section-info' },
  { title: 'Section', description: 'What will happen in this section...', path: '/reports/section-info' },
];

const bottomOptions = [
  { title: 'Add Files', description: '', path: '/reports/add-files' },
  { title: 'Remove Files', description: '', path: '/reports/remove-files' },
  { title: 'FAQs', description: 'Got questions? We might have answers to your questions! Check out our FAQs.', path: '/faq' },
];

const Options = ({ isMainPage }) => {
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
  }, [searchQuery, softwareOptions, bottomOptions]);

  useEffect(() => {
    // Fetch the list of files from the backend
    axios.get('/reports/list-files')
      .then(response => {
        setFiles(response.data.files);
        setTotalFiles(response.data.total);
      })
      .catch(error => {
        console.error('There was an error fetching the files!', error);
      });
  }, []);

  const goBack = () => {
    navigate(-1); // Navigate to the previous page
  };

  const goForward = () => {
    navigate(1); // Navigate to the next page
  };

  return (
    <div className="app-container">
      <div>
        <div className="inner-borders">
          {isMainPage && (
            <div className="software-sections">
              <div className="main-search">
                <button className="nav-button" onClick={goBack}>Back</button>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                <button className="nav-button" onClick={goForward}>Forward</button>
              </div>
              <div className="software-section">
                <h1 className="software-title">Private Software</h1>
                <p className="software-description">
                  Please connect to the VPN to use our software. Use software at your own risk.
                </p>
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

              <div className="bottom-section">
                <div className="database-section">
                  <h1 className="database-title">Database</h1>
                  <p className="database-description">
                    View, add, and remove files from the private database.
                  </p>
                  <div className="add-remove-container">
                    {filteredBottomOptions
                      .filter(option => ['Add Files', 'Remove Files'].includes(option.title))
                      .map((option, index) => (
                        <div
                          key={index}
                          className="add-remove-option-box"
                          onClick={() => navigate(option.path)}
                        >
                          <h2>{option.title}</h2>
                        </div>
                      ))}
                    <div className="add-remove-text">
                      Please be cautious when using this method, as it affects the shared database accessed by all users. Ensure to seek authorization before proceeding, as only authorized personnel are permitted to use these options.
                    </div>
                  </div>
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
                </div>

                <div className="another-section">
                  {filteredBottomOptions
                    .filter(option => option.title === 'FAQs')
                    .map((option, index) => (
                      <div key={index}>
                        <h1 className="another-title">{option.title}</h1>
                        <p className="another-description">{option.description}</p>
                        <button className="another-button" onClick={() => navigate(option.path)}>
                          View FAQs
                        </button>
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
