import React from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import HomePage from './components/HomePage';
import AskAI from './components/AskAI';
import Reports from './components/S3/Reports';
import ReportsBinder from './components/ReportsBinder';
import CoreBoxInventory from './components/CoreBoxInventory';
import OCRLookup from './components/OCRLookup';
import Contacts from './components/Contacts';
import ITOperations from './components/ITOperations/ITOperations';
import S3Bucket from './components/S3/S3Bucket';

function App() {
  return (
    <div className="App">
      <Header />
      <div className="app-container">
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/ask-ai" element={<AskAI />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports-binder" element={<ReportsBinder />} />
            <Route path="/core-box-inventory" element={<CoreBoxInventory />} />
            <Route path="/ocr-lookup" element={<OCRLookup />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/it-operations" element={<ITOperations />} />
            <Route path="/s3-bucket" element={<S3Bucket />} />
            
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;