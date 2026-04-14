import { useState } from 'react';
import Logger from './Logger';
import HistoryTab from './history/HistoryTab';
import MapTab from './map/MapTab';
import './historyStyles.css';

export default function MainLayout({ user, repName, onLogout }) {
  const [activeTab, setActiveTab] = useState('KNOCK');

  return (
    <div className="app-layout">
      <div className="app-content" style={{ paddingBottom: activeTab === 'MAP' ? '64px' : '70px', minHeight: '100vh', boxSizing: 'border-box' }}>
        <div style={{ display: activeTab === 'KNOCK' ? 'block' : 'none', height: '100%' }}>
          <Logger user={user} repName={repName} onLogout={onLogout} />
        </div>
        <div style={{ display: activeTab === 'HISTORY' ? 'block' : 'none', height: '100%' }}>
          <HistoryTab user={user} repName={repName} />
        </div>
        <div style={{ display: activeTab === 'MAP' ? 'block' : 'none', height: '100%', width: '100%' }}>
          <MapTab user={user} repName={repName} isActive={activeTab === 'MAP'} />
        </div>
      </div>

      <nav className="bottom-nav">
        <button 
          className={`nav-btn ${activeTab === 'KNOCK' ? 'active' : ''}`}
          onClick={() => setActiveTab('KNOCK')}
        >
          <div className="nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </div>
          <span>Knock</span>
        </button>
        <button 
          className={`nav-btn ${activeTab === 'MAP' ? 'active' : ''}`}
          onClick={() => setActiveTab('MAP')}
        >
          <div className="nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
              <line x1="8" y1="2" x2="8" y2="18"></line>
              <line x1="16" y1="6" x2="16" y2="22"></line>
            </svg>
          </div>
          <span>Map</span>
        </button>
        <button 
          className={`nav-btn ${activeTab === 'HISTORY' ? 'active' : ''}`}
          onClick={() => setActiveTab('HISTORY')}
        >
          <div className="nav-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              <path d="M12 11h4"></path>
              <path d="M12 16h4"></path>
              <path d="M8 11h.01"></path>
              <path d="M8 16h.01"></path>
            </svg>
          </div>
          <span>History</span>
        </button>
      </nav>
    </div>
  );
}

