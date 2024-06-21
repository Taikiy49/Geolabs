import React, { useState } from 'react';
import axios from 'axios';
import './SearchFiles.css'; 

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles(files);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await axios.post('http://localhost:5000/upload', formData, {
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
      <input type="file" onChange={handleFileChange} multiple />
      {selectedFiles.length > 0 && (
        <div className="file-list-container">
          {selectedFiles.map((file, index) => (
            <div key={index}>
              <p>{file.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
