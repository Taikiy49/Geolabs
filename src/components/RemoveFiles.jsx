import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/RemoveFiles.css';

const RemoveFiles = () => {
    const [files, setFiles] = useState([]);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch the list of files from the server
        const fetchFiles = async () => {
            try {
                const response = await axios.get(`http://13.56.252.100:8000/program-selection/list-files`);
                const sortedFiles = response.data.sort((a, b) => {
                    const numA = a.filename.match(/\d+/);
                    const numB = b.filename.match(/\d+/);
                    return (numA ? parseInt(numA[0], 10) : 0) - (numB ? parseInt(numB[0], 10) : 0);
                });
                setFiles(sortedFiles);
            } catch (error) {
                console.error('Error fetching files:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchFiles();
    }, []);

    const handleSelectFile = (filename) => {
        setSelectedFiles((prevSelected) => {
            if (prevSelected.includes(filename)) {
                return prevSelected.filter((file) => file !== filename);
            } else {
                return [...prevSelected, filename];
            }
        });
    };

    const handleRemoveFiles = async () => {
        try {
            const response = await axios.post(`http://13.56.252.100:8000/program-selection/remove-files`, {
                filenames: selectedFiles
            });
            alert(response.data.message);
            // Update the list of files after deletion
            setFiles((prevFiles) => prevFiles.filter((file) => !selectedFiles.includes(file.filename)));
            setSelectedFiles([]);
        } catch (error) {
            console.error('Error removing files:', error);
        }
    };

    if (loading) {
        return <div>Loading files...</div>;
    }

    return (
        <div className='remove-container'>
            <div className='remove-title'>Remove Files</div>
            <div className='remove-files-list'>
                {files.map((file, index) => (
                    <div key={index} className='remove-file-item'>
                        <input
                            type='checkbox'
                            checked={selectedFiles.includes(file.filename)}
                            onChange={() => handleSelectFile(file.filename)}
                        />
                        {`${index + 1}. ${file.filename}`}
                    </div>
                ))}
            </div>
            <button className='remove-button' onClick={handleRemoveFiles} disabled={selectedFiles.length === 0}>
                Remove Selected Files
            </button>
        </div>
    );
};

export default RemoveFiles;
