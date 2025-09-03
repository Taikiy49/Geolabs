import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from './authConfig';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import AskAI from './components/AskAI';
import DBAdmin from './components/DBAdmin';
import DBViewer from './components/DBViewer';
import S3Admin from './components/S3Admin';
import S3Viewer from './components/S3Viewer';
import Reports from './components/Reports';
import ReportsBinder from './components/ReportsBinder';
import CoreBoxInventory from './components/CoreBoxInventory';
import OCRLookup from './components/OCRLookup';
import Contacts from './components/Contacts';
import Admin from './components/Admin';
import ITTickets from './components/ITTickets';
import './App.css';

const msalInstance = new PublicClientApplication(msalConfig);

function AuthenticatedApp() {
  return (
    <Router>
      <div className="app">
        <Header />
        <div className="app-layout">
          <Sidebar />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/ask-ai" element={<AskAI />} />
              <Route path="/db-admin" element={<DBAdmin />} />
              <Route path="/db-viewer" element={<DBViewer />} />
              <Route path="/s3-admin" element={<S3Admin />} />
              <Route path="/s3-viewer" element={<S3Viewer />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports-binder" element={<ReportsBinder />} />
              <Route path="/core-box-inventory" element={<CoreBoxInventory />} />
              <Route path="/ocr-lookup" element={<OCRLookup />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/it-tickets" element={<ITTickets />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}

function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <AuthenticatedApp />
    </MsalProvider>
  );
}

export default App;