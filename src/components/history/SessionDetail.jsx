import React from 'react';

const OUTCOME_COLORS = {
  'NO_ANSWER': '#6b7280',
  'CONVO': '#3b82f6',
  'SALE': '#10b981'
};

export default function SessionDetail({ session, onBack, user }) {
  const d = new Date(session.started_at);
  const titleDate = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  let durationText = '';
  if (session.ended_at) {
    const diffMin = Math.round((new Date(session.ended_at) - d) / 60000);
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    if (hrs > 0) durationText = `${hrs}h ${mins}m`;
    else durationText = `${mins}m`;
  } else {
    durationText = 'In Progress';
  }

  // Re-generate Export logic tightly bound to local structured data
  function handleExport() {
    const rows = [
      ['Date', 'Time', 'Street', 'House Number', 'Outcome', 'Objection/Status', 'Callback Time']
    ];
    
    session.events.forEach(e => {
      if (e.type === 'KNOCK') {
        const td = new Date(e.time);
        
        // rudimentary parsing of address string back into street/house for export
        const hMatch = e.address.match(/^(\d+\w*)\s+(.*)/);
        let house = '';
        let street = e.address;
        if (hMatch) {
          house = hMatch[1];
          street = hMatch[2];
        }

        rows.push([
          td.toLocaleDateString(),
          td.toLocaleTimeString(),
          street,
          house,
          e.outcome || '',
          e.objection || '',
          e.callback_time ? new Date(e.callback_time).toLocaleString() : ''
        ]);
      } else if (e.type === 'BREAK') {
        const td = new Date(e.time);
        rows.push([
          td.toLocaleDateString(),
          td.toLocaleTimeString(),
          'BREAK',
          '',
          e.duration ? `${Math.floor(e.duration/60)} min` : 'Active',
          '',
          ''
        ]);
      }
    });

    const csvContent = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const dStr = new Date(session.session_date || session.started_at).toISOString().split('T')[0];
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `KnockLog_${user.id.substring(0,6)}_${dStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="detail-view">
      <div className="detail-nav">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div className="detail-title">{titleDate}</div>
      </div>

      <div className="detail-summary">
        <div className="detail-grid">
          <div className="d-stat">
            <span className="d-val">{session.total_doors}</span>
            <span className="d-lbl">Doors</span>
          </div>
          <div className="d-stat">
            <span className="d-val" style={{ color: '#3b82f6' }}>{session.total_convos}</span>
            <span className="d-lbl">Convos</span>
          </div>
          <div className="d-stat">
            <span className="d-val" style={{ color: '#10b981' }}>{session.total_sales}</span>
            <span className="d-lbl">Sales</span>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, color: '#9ca3af', fontSize: 13 }}>
          Duration: {durationText} {session.status === 'ACTIVE' && <span style={{ color: '#10b981' }}>•</span>}
        </div>
      </div>

      <div className="timeline">
        <h3 className="timeline-title">Activity Timeline</h3>
        
        {session.events.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>0 doors knocked.</p>
        ) : (
          session.events.map(e => {
            const timeStr = new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            if (e.type === 'BREAK') {
              return (
                <div className="timeline-item" key={e.id}>
                  <div className="t-time">{timeStr}</div>
                  <div className="t-content">
                    <div className="t-break">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                        <path d="M17 8h1a4 4 0 1 1 0 8h-1"></path>
                        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path>
                        <line x1="6" y1="2" x2="6" y2="4"></line>
                        <line x1="10" y1="2" x2="10" y2="4"></line>
                        <line x1="14" y1="2" x2="14" y2="4"></line>
                      </svg>
                      Break • {e.duration ? `${Math.floor(e.duration / 60)}m` : 'In Progress'}
                    </div>
                  </div>
                </div>
              );
            }

            // KNOCK Event
            const color = OUTCOME_COLORS[e.outcome] || '#fff';
            return (
              <div className="timeline-item" key={e.id}>
                <div className="t-time">{timeStr}</div>
                <div className="t-content" style={{ borderLeft: `3px solid ${color}` }}>
                  <div className="t-header">
                    <span className="t-outcome" style={{ color }}>{e.outcome.replace('_', ' ')}</span>
                    {!e.synced && <span style={{ fontSize: 10, color: '#f59e0b' }}>Syncing</span>}
                  </div>
                  <div className="t-address">{e.address}</div>
                  {e.objection && (
                    <div className="t-detail">
                      {e.objection === 'CALLBACK' && e.callback_time 
                        ? `CB: ${new Date(e.callback_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
                        : e.objection}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button className="export-btn" onClick={handleExport}>
        EXPORT TO CSV
      </button>

    </div>
  );
}
