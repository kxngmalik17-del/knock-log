import React, { useState, useEffect } from 'react';
import { getLocalHistory, forceSyncHistoryDeltas, getTeamHistory } from '../../lib/historyService';
import SessionDetail from './SessionDetail';

const AVATAR_COLORS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#ef4444,#dc2626)',
  'linear-gradient(135deg,#3b82f6,#2563eb)',
  'linear-gradient(135deg,#ec4899,#db2777)',
];

function getInitials(name) {
  return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function HistoryTab({ user }) {
  const [subTab, setSubTab] = useState('my'); // 'my' | 'team'
  const [sessions, setSessions] = useState([]);
  const [teamSessions, setTeamSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);

  // 1. Fetch personal history (local OPFS SQLite)
  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const localData = await getLocalHistory();
      if (mounted) {
        setSessions(localData);
        setLoading(false);
      }

      const hasNewData = await forceSyncHistoryDeltas(user.id);
      
      if (hasNewData && mounted) {
        const mergedData = await getLocalHistory();
        setSessions(mergedData);
      }
    }

    loadData();

    const interval = setInterval(async () => {
      const liveData = await getLocalHistory();
      if (mounted) setSessions(liveData);
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user.id]);

  // 2. Fetch team history (Supabase)
  useEffect(() => {
    if (subTab !== 'team') return;
    let mounted = true;

    async function loadTeamData() {
      setTeamLoading(true);
      const teamData = await getTeamHistory();
      if (mounted) {
        setTeamSessions(teamData);
        setTeamLoading(false);
      }
    }

    loadTeamData();

    const interval = setInterval(async () => {
      const teamData = await getTeamHistory();
      if (mounted) setTeamSessions(teamData);
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [subTab]);

  // Bulk Export all visible team knocks to CSV
  function handleBulkExport() {
    if (teamSessions.length === 0) return;
    
    const rows = [
      ['Representative', 'Date', 'Time', 'Street', 'House Number', 'Outcome', 'Objection/Status', 'Callback Time', 'Notes']
    ];
    
    teamSessions.forEach(session => {
      const repName = session.rep_name || 'Teammate';
      session.events.forEach(e => {
        if (e.type === 'KNOCK') {
          const td = new Date(e.time);
          
          const hMatch = e.address.match(/^(\d+\w*)\s+(.*)/);
          let house = '';
          let street = e.address;
          if (hMatch) {
            house = hMatch[1];
            street = hMatch[2];
          }

          rows.push([
            repName,
            td.toLocaleDateString(),
            td.toLocaleTimeString(),
            street,
            house,
            e.outcome || '',
            e.objection || '',
            e.callback_time ? new Date(e.callback_time).toLocaleString() : '',
            e.notes || ''
          ]);
        }
      });
    });

    const csvContent = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `KnockLog_Team_History_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (selectedSession) {
    return <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} user={user} />;
  }

  const activeSessionsList = subTab === 'my' ? sessions : teamSessions;
  const isListLoading = subTab === 'my' ? loading : teamLoading;

  // Group by relative date (Today, This Week, Older)
  const grouped = {
    today: [],
    thisWeek: [],
    older: []
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  activeSessionsList.forEach(s => {
    if (s.session_date === todayStr) {
      grouped.today.push(s);
    } else if (new Date(s.started_at) > oneWeekAgo) {
      grouped.thisWeek.push(s);
    } else {
      grouped.older.push(s);
    }
  });

  const renderGroup = (title, items) => {
    if (items.length === 0) return null;
    return (
      <div className="date-group">
        <h3 className="date-group-header">{title}</h3>
        {items.map((s, idx) => {
          const d = new Date(s.started_at);
          let timeRange = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (s.ended_at) {
            timeRange += ' → ' + new Date(s.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }

          const convRate = s.total_doors > 0 ? ((s.total_sales / s.total_doors) * 100).toFixed(1) : 0;
          const avatarGrad = AVATAR_COLORS[idx % AVATAR_COLORS.length];

          return (
            <div className="session-card" key={s.session_id} onClick={() => setSelectedSession(s)}>
              <div className="session-card-header">
                {subTab === 'team' ? (
                  <div className="session-rep-info">
                    <div className="session-rep-avatar" style={{ background: avatarGrad }}>
                      {getInitials(s.rep_name)}
                    </div>
                    <div className="session-date-time">
                      <span className="s-rep-name">{s.rep_name}</span>
                      <span className="s-time">{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric'})} · {timeRange}</span>
                    </div>
                  </div>
                ) : (
                  <div className="session-date-time">
                    <span className="s-date">{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric'})}</span>
                    <span className="s-time">{timeRange}</span>
                  </div>
                )}
                <div className={`status-badge ${s.status === 'ACTIVE' ? 'status-active' : 'status-closed'}`}>
                  {s.status === 'ACTIVE' ? 'IN PROGRESS' : 'CLOSED'}
                </div>
              </div>
              
              <div className="session-stats-row">
                <div className="s-stat">
                  <span className="s-val">{s.total_doors}</span>
                  <span className="s-lbl">Doors</span>
                </div>
                <div className="s-stat">
                  <span className="s-val" style={{ color: '#3b82f6' }}>{s.total_convos}</span>
                  <span className="s-lbl">Convos</span>
                </div>
                <div className="s-stat">
                  <span className="s-val" style={{ color: '#10b981' }}>{s.total_sales}</span>
                  <span className="s-lbl">Sales</span>
                </div>
                <div className="s-stat">
                  <span className="s-val" style={{ color: '#f59e0b' }}>{convRate}%</span>
                  <span className="s-lbl">Close %</span>
                </div>
              </div>

              {s.territory.length > 0 && (
                <div className="session-territory">
                  {s.territory.slice(0, 3).map(str => <span key={str} className="terr-tag">{str}</span>)}
                  {s.territory.length > 3 && <span className="terr-tag">+{s.territory.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="history-container">
      <div className="history-header">
        <h2 className="history-title">History</h2>
        <p className="history-sub">Your derived field activity.</p>
        
        {/* Sub-tab Sliding Selector */}
        <div className="history-toggle-wrap">
          <button 
            className={`history-toggle-btn ${subTab === 'my' ? 'active' : ''}`}
            onClick={() => setSubTab('my')}
          >
            My History
          </button>
          <button 
            className={`history-toggle-btn ${subTab === 'team' ? 'active' : ''}`}
            onClick={() => setSubTab('team')}
          >
            Team History
          </button>
        </div>
      </div>

      {subTab === 'team' && teamSessions.length > 0 && (
        <button className="bulk-export-btn" onClick={handleBulkExport}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          BULK EXPORT TEAM CSV
        </button>
      )}

      {isListLoading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>Loading history...</p>
        </div>
      ) : activeSessionsList.length === 0 ? (
        <p style={{ color: '#9ca3af', marginTop: 32, textAlign: 'center' }}>
          {subTab === 'my' 
            ? 'No session history found on this device. Syncing...' 
            : 'No team history found in the last 30 days.'}
        </p>
      ) : (
        <>
          {renderGroup('Today', grouped.today)}
          {renderGroup('This Week', grouped.thisWeek)}
          {renderGroup('Older', grouped.older)}
        </>
      )}
    </div>
  );
}
