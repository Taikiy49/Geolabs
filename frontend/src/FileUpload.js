import React, { useState } from 'react';

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
          {selectedFiles.map((file, index) => (
            <div key={index}>
              <p>Selected file: {file.name}</p>
            </div>
          ))}

      
          <button onClick={handleUpload}>Upload All</button>
        </div>
      )}

    </>
  );
};

export default FileUpload;
