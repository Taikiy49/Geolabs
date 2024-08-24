import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Options = ({ isMainPage }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (event) => {
    event.preventDefault();
    // Implement the search functionality here
    console.log('Search Query:', searchQuery);
    // Navigate to a search results page or handle the search query
  };

  return (
    <div className="app-container">
      <div className='split-containers'>
        <div className='main-search'>
          <form onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="search-button">Search</button>
          </form>
        </div>
      </div>
      <div className="inner-borders">
        {isMainPage && (
          <div className="software-sections">
            <div className="software-section">
              <h1 className="software-title">Private Software</h1>
              <p className="software-description">Please connect to the VPN to use our software. Use software at your own risk.</p>
              <div className="options-container">
                <div className="option-box" onClick={() => navigate('/program-selection/search-database')}>
                  <h2>Search</h2>
                  <p>Search through the database to find solutions</p>
                </div>
                <div className="option-box" onClick={() => navigate('/program-selection/build-resume')}>
                  <h2>Resume</h2>
                  <p>Build resume based on specific needs</p>
                </div>
                <div className="option-box" onClick={() => navigate('/program-selection/relevancy')}>
                  <h2>Relevancy</h2>
                  <p>Write a word and find relevant files</p>
                </div>
                <div className="option-box" onClick={() => navigate('/program-selection/section-info')}>
                  <h2>Work Order</h2>
                  <p>Enter work order number and gather information</p>
                </div>
              </div>
            </div>

            <div className='bottom-section'>
              <div className="database-section">
                <h1 className="database-title">Features</h1>
                <p className="database-description">Our software offers a range of powerful features to enhance your productivity.</p>
                <div className='add-remove-container'>
                  <div className="add-remove-option-box" onClick={() => navigate('/program-selection/add-files')}>
                    <h2>Add Files</h2>
                  </div>
                  <div className="add-remove-option-box" onClick={() => navigate('/program-selection/remove-files')}>
                    <h2>Remove Files</h2>
                  </div>
                  <div className='add-remove-text'>Please be cautious when using this method, as it affects the shared database accessed by all users. Ensure to seek authorization before proceeding, as only authorized personnel are permitted to use these options</div>
                </div>
              </div>

              <div className="another-section">
                <h1 className="another-title">FAQs</h1>
                <p className="another-description">Got questions? We might have answers to your questions! Check out our FAQs.</p>
                <button className="another-button" onClick={() => navigate('/faq')}>View FAQs</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Options;
