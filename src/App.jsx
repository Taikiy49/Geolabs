import React from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import AskAI from './components/AskAI';
import Reports from './components/Reports';
import ReportsBinder from './components/ReportsBinder';
import CoreBoxInventory from './components/CoreBoxInventory';
import OCRLookup from './components/OCRLookup';
import Contacts from './components/Contacts';
import ITTickets from './components/ITTickets';
import Admin from './components/Admin';
import DBAdmin from './components/DBAdmin';
import DBViewer from './components/DBViewer';
import S3Admin from './components/S3Admin';
import S3Viewer from './components/S3Viewer';
import RagCore from './components/RagCore';

function App() {
  return (
    <div className="App">
      <Header />
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/ask-ai" element={<AskAI />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/rag-core" element={<RagCore />} />
            <Route path="/reports-binder" element={<ReportsBinder />} />
            <Route path="/core-box-inventory" element={<CoreBoxInventory />} />
            <Route path="/ocr-lookup" element={<OCRLookup />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/it-tickets" element={<ITTickets />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/db-admin" element={<DBAdmin />} />
            <Route path="/db-viewer" element={<DBViewer />} />
            <Route path="/s3-admin" element={<S3Admin />} />
            <Route path="/s3-viewer" element={<S3Viewer />} />
            
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;