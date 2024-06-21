import React, { useState } from 'react';
import './SideMenu.css';

const SideMenu = ({ isMenuOpen, toggleMenu }) => {
  return (
    <div className={`side-menu ${isMenuOpen ? 'open' : ''}`}>
      <div className="hamburger-background" onClick={toggleMenu}>
        <img src="./hamburger-icon.png" alt="Menu" className="hamburger" />
      </div>
      <div className={`menu-container ${isMenuOpen ? 'open' : ''}`}>
        <div className="menu">Services</div>
        <div className="menu">About</div>
        <div className="menu">Website</div>
        <div className="menu">Contact</div>
      </div>
    </div>
  );
};

const App = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <>
      <header className={isMenuOpen ? 'menu-open' : ''}>
        <div className="logo">GeoLabs</div>
        <nav className="nav-links">
          <a href="#services">Services</a>
          <a href="#about">About</a>
          <a href="#website">Website</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>
      <SideMenu isMenuOpen={isMenuOpen} toggleMenu={toggleMenu} />

      <main className={isMenuOpen ? 'menu-open' : ''}>
        <section id="services">
          <h2>Services</h2>
          <p>Information about services.</p>
        </section>
        <section id="about">
          <h2>About</h2>
          <p>Information about the company.</p>
        </section>
        <section id="website">
          <h2>Website</h2>
          <p>Information about the website.</p>
        </section>
        <section id="contact">
          <h2>Contact</h2>
          <p>Information on how to contact us.</p>
        </section>
      </main>
    </>
  );
};

export default App;
