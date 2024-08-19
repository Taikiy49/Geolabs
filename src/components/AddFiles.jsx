import React, { useState } from 'react';
import axios from 'axios';
import '../styles/AddFiles.css'

const AddFiles = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);
    document.getElementById('file-input').value = '';
  };

  const handleUpload = async () => {
    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('files', file);
    });

    setIsUploading(true);
    try {
      const response = await axios.post('http://13.56.252.100:8000/program-selection/add-files', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      console.log('Files uploaded successfully', response.data);
    } catch (error) {
      console.error('There was an error uploading the files!', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="file-upload-container">
      <div className="upload-section">
        <input type="file" id="file-input" onChange={handleFileChange} multiple className="file-input" />
        <button className="upload-button" onClick={() => document.getElementById('file-input').click()}>
          <img src='../upload.png' alt="Upload" className="upload-icon" />
        </button>
      </div>
      {selectedFiles.length > 0 && (
        <>
          <div className="file-list-container">
            {selectedFiles.map((file, index) => (
              <div key={index} className="file-item">
                <p>{file.name}</p>
              </div>
            ))}
          </div>
          <button className="confirm-button" onClick={handleUpload}>
            Confirm
          </button>
        </>
      )}
      {isUploading && (
        <div className="loading-screen">
          <p>Uploading files, please wait...</p>
        </div>
      )}
    </div>
  );
};

export default AddFiles;
