import React from 'react';
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
            <div className="menu">Contact</div>
        </div>
        </div>
        
  );
};

export default SideMenu;
