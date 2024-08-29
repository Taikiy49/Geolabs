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
  { title: 'Add Files', icon: 'fas fa-upload', path: '/reports/add-files' },
  { title: 'Remove Files', icon: 'fas fa-trash-alt', path: '/reports/remove-files' },
];

const Options = ({ isMainPage }) => {
  const { apiUrl } = getConfig();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredSoftwareOptions, setFilteredSoftwareOptions] = useState(softwareOptions);
  const [filteredBottomOptions, setFilteredBottomOptions] = useState(bottomOptions);
  const [files, setFiles] = useState([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingAdd, setDraggingAdd] = useState(true);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await axios.get(`${apiUrl}/reports/list-files`);
        const sortedFiles = response.data.sort((a, b) => {
          const numA = a.filename.match(/\d+/);
          const numB = b.filename.match(/\d+/);
          return (numA ? parseInt(numA[0], 10) : 0) - (numB ? parseInt(numB[0], 10) : 0);
        });
        setFiles(sortedFiles);
        setFilteredFiles(sortedFiles);
        setTotalFiles(sortedFiles.length);
      } catch (error) {
        console.error('Error fetching files:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [apiUrl]);

  useEffect(() => {
    if (searchQuery) {
      setFilteredFiles(
        files.filter((file) =>
          file.filename.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredFiles(files);
    }
  }, [searchQuery, files]);

  const handleFileSelect = (filename, add) => {
    setSelectedFiles(prevSelected =>
      add
        ? [...prevSelected, filename]
        : prevSelected.filter(file => file !== filename)
    );
  };

  const handleMouseDown = (index) => {
    setIsDragging(true);
    const fileSelected = selectedFiles.includes(filteredFiles[index].filename);
    setDraggingAdd(!fileSelected); // If already selected, toggle to remove on drag

    handleFileSelect(filteredFiles[index].filename, !fileSelected);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseEnter = (index) => {
    if (isDragging) {
      handleFileSelect(filteredFiles[index].filename, draggingAdd);
    }
  };

  const handleDeleteFiles = () => {
    axios.post(`${apiUrl}/reports/remove-files`, { filenames: selectedFiles })
      .then(response => {
        setFiles(files.filter(file => !selectedFiles.includes(file.filename)));
        setSelectedFiles([]);
        setTotalFiles(totalFiles - selectedFiles.length);
      })
      .catch(error => {
        console.error('Error deleting files:', error);
      });
  };

  const handleFileUpload = (event) => {
    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < event.target.files.length; i++) {
      formData.append('files', event.target.files[i]);
    }

    axios.post(`${apiUrl}/reports/add-files`, formData)
      .then(response => {
        axios.get(`${apiUrl}/reports/list-files`)
          .then(response => {
            const sortedFiles = response.data.sort((a, b) => {
              const numA = a.filename.match(/\d+/);
              const numB = b.filename.match(/\d+/);
              return (numA ? parseInt(numA[0], 10) : 0) - (numB ? parseInt(numB[0], 10) : 0);
            });
            setFiles(sortedFiles);
            setFilteredFiles(sortedFiles);
            setTotalFiles(sortedFiles.length);
            setUploading(false);
          });
      })
      .catch(error => {
        console.error('Error uploading files:', error);
        setUploading(false);
      });
  };

  if (loading) {
    return <div>Loading files...</div>;
  }

  const isSelected = (filename) => selectedFiles.includes(filename);

  return (
    <div className="reports-container" onMouseUp={handleMouseUp}>
      <div className={`overlay ${uploading ? 'visible' : ''}`}>
        <div className="loading-message">Uploading files, please wait...</div>
      </div>
      <div className="inner-borders">
        {isMainPage && (
          <div className="software-sections">
            <div className='report-text-container'>
              <h1 className="software-title">Project Reports</h1>
              <p className='software-description'>Please note that this software is currently under development. Some features may be incomplete or not functioning at their full capacity at this time.</p>
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
                <div className='file-top-container'>
                  <div className="file-search-bar">
                    <input
                      type="text"
                      placeholder="Search files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <h2 className="file-list-title">File Count: {totalFiles}</h2>
                </div>
                <div className="file-list-container">
                  <div className="scrollable-file-list">
                    {filteredFiles.map((file, index) => (
                      <div
                        key={index}
                        className={`file-item ${isSelected(file.filename) ? 'selected' : ''}`}
                        onMouseDown={() => handleMouseDown(index)}
                        onMouseEnter={() => handleMouseEnter(index)}
                      >
                        {file.filename}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="add-remove-container">
                  <div
                    className="add-remove-option-box"
                    onClick={handleDeleteFiles}
                    disabled={selectedFiles.length === 0}
                  >
                    <i className="fas fa-trash-alt"></i> {/* Font Awesome Trash Icon */}
                    <p className='reports-remove-text'>Remove</p>
                  </div>
                  <label className="add-remove-option-box">
                    <i className="fas fa-upload"></i> {/* Font Awesome Upload Icon */}
                    <p className='reports-upload-text'>Upload</p>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      disabled={uploading}
                    />
                  </label>
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
