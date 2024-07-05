import React, { useState } from 'react';
import axios from 'axios';
import './UpdateDatabase.css'; 

const UpdateDatabase = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await axios.post('http://localhost:5000/update-database', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      console.log('Files uploaded successfully', response.data);
    } catch (error) {
      console.error('There was an error uploading the files!', error);
    }
  };

  return (
    <div className="file-upload-container">
      <div className="upload-section">
        <input type="file" onChange={handleFileChange} multiple className="file-input" />
        <div className="upload-button-container">
          <button className="upload-button">Upload Files</button>
        </div>
      </div>
      {selectedFiles.length > 0 && (
        <div className="file-list-container">
          {selectedFiles.map((file, index) => (
            <div key={index} className="file-item">
              <p>{file.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UpdateDatabase;
