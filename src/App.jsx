import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
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


import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';

function RequireMsalAuth({ children }) {
  const isAuthed = useIsAuthenticated();
  const { inProgress } = useMsal(); // login/handleRedirect/none
  const location = useLocation();

  // Don't redirect while MSAL is busy finishing the redirect
  if (inProgress !== InteractionStatus.None) {
    return <div style={{ padding: 24 }}>Finishing sign-in…</div>;
  }
  if (!isAuthed) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

function MsLogin() {
  const isAuthed = useIsAuthenticated();
  const { instance, inProgress } = useMsal();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  useEffect(() => {
    if (isAuthed) {
      navigate(from, { replace: true });
      return;
    }
    if (inProgress === 'none') {
      instance.loginRedirect({ scopes: ['User.Read'], prompt: 'select_account' });
    }
  }, [isAuthed, inProgress, instance, navigate, from]);

  const tryAgain = () =>
    instance.loginRedirect({ scopes: ['User.Read'], prompt: 'select_account' });

  const tryPopup = () =>
    instance.loginPopup({ scopes: ['User.Read'], prompt: 'select_account' });

  return (
    <div className="auth-redirect">
      <div className="auth-card">
        <img src="/geolabs.png" alt="Geolabs" className="auth-logo" />
        <h1 className="auth-title">Signing you in…</h1>
        <p className="auth-sub">Redirecting to Microsoft securely.</p>

        <div className="auth-spinner" aria-hidden="true" />
        <p className="auth-hint">If nothing happens in a few seconds:</p>

        <div className="auth-actions">
          <button className="hlite-btn" onClick={tryAgain}>Try redirect again</button>
          <button className="hlite-btn ghost" onClick={tryPopup}>Use popup instead</button>
        </div>

        <div className="auth-footnote">
          You’ll be sent back to <code>{from}</code> after sign-in.
        </div>
      </div>
    </div>
  );
}


function App() {
  return (
    <div className="App">
      <Header />
      <div className="app-container">
        <main className="main-content">
          <Routes>
            {/* Public: the only public page is the auto-login redirect */}
            <Route path="/login" element={<MsLogin />} />

            {/* Everything else requires Microsoft sign-in */}
            <Route
              path="/"
              element={
                <RequireMsalAuth>
                  <HomePage />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/ask-ai"
              element={
                <RequireMsalAuth>
                  <AskAI />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/reports"
              element={
                <RequireMsalAuth>
                  <Reports />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/reports-binder"
              element={
                <RequireMsalAuth>
                  <ReportsBinder />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/core-box-inventory"
              element={
                <RequireMsalAuth>
                  <CoreBoxInventory />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/ocr-lookup"
              element={
                <RequireMsalAuth>
                  <OCRLookup />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/contacts"
              element={
                <RequireMsalAuth>
                  <Contacts />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/it-operations"
              element={
                <RequireMsalAuth>
                  <ITOperations />
                </RequireMsalAuth>
              }
            />
            <Route
              path="/s3-bucket"
              element={
                <RequireMsalAuth>
                  <S3Bucket />
                </RequireMsalAuth>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
