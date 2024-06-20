import React, { useState } from 'react';
import './SearchFiles.css'; 

const FileUpload = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files);
    setSelectedFiles((prevFiles) => [...prevFiles, ...files]);
  };

  const handleUpload = () => {
    selectedFiles.forEach(file => {
      console.log('File selected:', file);
    });
  };

  return (
    <>
    
      <input type="file" onChange={handleFileChange} multiple/>
      {selectedFiles.length > 0 && (
        <div>
          <div className="search-files-container">
          {selectedFiles.map((file, index) => (
            <div key={index}>
              <p>{file.name}</p>
            </div>
          ))}
          </div>

      
          <button onClick={handleUpload}>Upload</button>
        </div>
      )}

    </>
  );
};

export default FileUpload;
