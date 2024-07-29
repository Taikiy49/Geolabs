import React from 'react';
import { useNavigate } from 'react-router-dom';

const Options = ({ isMainPage }) => {
  const navigate = useNavigate();

  return (
    <div className="inner-borders">
      {isMainPage && (
        <div className="hero-sections">
          <div className="hero-section">
            <h1 className="hero-title">Private Software</h1>
            <p className="hero-description">Please connect to the VPN to use our software. Use software at your own risk.</p>
            <button className="hero-button" onClick={() => navigate('/program-selection')}>Start</button>
          </div>

          <div className="hero-section">
            <h1 className="hero-title">Features</h1>
            <p className="hero-description">Our software offers a range of powerful features to enhance your productivity.</p>
            <button className="hero-button" onClick={() => navigate('/features')}>Learn More</button>
          </div>

          <div className="hero-section">
            <h1 className="hero-title">FAQs</h1>
            <p className="hero-description">Got questions? We might have answers to your questions! Check out our FAQs.</p>
            <button className="hero-button" onClick={() => navigate('/faq')}>View FAQs</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Options;
