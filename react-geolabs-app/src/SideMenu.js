import React from 'react';


const SideMenu = ({ isMenuOpen, toggleMenu }) => (
    <div className={`side-menu ${isMenuOpen ? 'open' : ''}`}>
        <div className="hamburger-background">
            <img 
                src="/hamburger-icon.png" 
                className={`hamburger ${isMenuOpen ? 'no-background' : ''}`}
                onClick={toggleMenu}
                alt="Hamburger Icon"
            />
        </div>

        <div className={`menu-container ${isMenuOpen ? 'open' : ''}`}>
            <div className="menu"><p>About</p></div>
            <div className="menu"><p>Help</p></div>
            <div className="menu"><p>Contact</p></div>
            <div className="menu"><p>TODO</p></div>
            <div className="menu"><p>TODO</p></div>
            <div className="menu"><p>TODO</p></div>
            <div className="menu"><p>TODO</p></div>
            <div className="menu"><p>TODO</p></div>
            <div className="menu"><p>TODO</p></div>
        </div>
    </div>
);

export default SideMenu;
