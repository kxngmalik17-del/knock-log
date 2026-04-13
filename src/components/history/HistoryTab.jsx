import React, { useState, useEffect } from 'react';
import { getLocalHistory, forceSyncHistoryDeltas } from '../../lib/historyService';
import SessionDetail from './SessionDetail';

export default function HistoryTab({ user }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      // 1. Instant local read
      const localData = await getLocalHistory();
      if (mounted) {
        setSessions(localData);
        setLoading(false);
      }

      // 2. Fetch server deltas & merge into local OPFS
      const hasNewData = await forceSyncHistoryDeltas(user.id);
      
      // 3. Re-read local OPFS to render identical state
      if (hasNewData && mounted) {
        const mergedData = await getLocalHistory();
        setSessions(mergedData);
      }
    }

    loadData();

    // Re-pull local data every 5 seconds to catch active logging
    const interval = setInterval(async () => {
      const liveData = await getLocalHistory();
      if (mounted) setSessions(liveData);
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user.id]);

  if (selectedSession) {
    return <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} user={user} />;
  }

  if (loading) {
    return (
      <div className="history-container" style={{ textAlign: 'center', padding: '40px' }}>
        <p>Loading your history...</p>
      </div>
    );
  }

  // Group by relative date (Today, This Week, Older)
  const grouped = {
    today: [],
    thisWeek: [],
    older: []
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  sessions.forEach(s => {
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
        {items.map(s => {
          const d = new Date(s.started_at);
          let timeRange = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (s.ended_at) {
            timeRange += ' → ' + new Date(s.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }

          const convRate = s.total_doors > 0 ? ((s.total_sales / s.total_doors) * 100).toFixed(1) : 0;

          return (
            <div className="session-card" key={s.session_id} onClick={() => setSelectedSession(s)}>
              <div className="session-card-header">
                <div className="session-date-time">
                  <span className="s-date">{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric'})}</span>
                  <span className="s-time">{timeRange}</span>
                </div>
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
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: '#9ca3af', marginTop: 32 }}>No session history found on this device. Syncing...</p>
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
