import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const OUTCOMES = [
  { key: 'NO_ANSWER', label: 'NO ANSWER', color: '#6b7280' },
  { key: 'CONVO', label: 'CONVO', color: '#3b82f6' },
  { key: 'SALE', label: 'SALE', color: '#10b981' },
];

const CONVO_OPTIONS = [
  'CALLBACK',
  'NOT INTERESTED',
  'ALREADY HAVE / DIY',
  'BAD TIMING',
  'NEED TO THINK',
  'NOT DECISION MAKER',
  'PRICE',
  'NOT CONVINCED'
];

// States: NOT_STARTED | ACTIVE | ON_BREAK | CLOSED
export default function Logger({ user, repName, onLogout }) {
  const [dayState, setDayState] = useState('NOT_STARTED');
  const [session, setSession] = useState(null);
  const [street, setStreet] = useState('');
  const [streetInput, setStreetInput] = useState('');
  
  // House Cursor State
  const [houseNum, setHouseNum] = useState('');
  const [stepSize, setStepSize] = useState(2);

  const [events, setEvents] = useState([]);
  const [activeBreak, setActiveBreak] = useState(null);
  
  // UI Panels State
  const [showObjections, setShowObjections] = useState(false);
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackTime, setCallbackTime] = useState('');

  const [logging, setLogging] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [flashOutcome, setFlashOutcome] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // ─── Bootstrap: check for existing open session today ───
  useEffect(() => {
    async function bootstrap() {
      const today = new Date().toISOString().split('T')[0];
      const { data: sess } = await supabase
        .from('day_sessions')
        .select('*')
        .eq('rep_id', user.id)
        .eq('session_date', today)
        .order('start_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sess) {
        setSession(sess);
        if (sess.status === 'CLOSED') {
          setDayState('CLOSED');
        } else {
          setDayState('ACTIVE');
          // Check for active break
          const { data: brk } = await supabase
            .from('break_sessions')
            .select('*')
            .eq('session_id', sess.id)
            .is('break_end_time', null)
            .single();
          if (brk) {
            setActiveBreak(brk);
            setDayState('ON_BREAK');
          }
        }
        await fetchEvents(sess.id);
      }
      setLoading(false);
    }
    bootstrap();
  }, [user.id]);

  // ─── Fetch events for session ───
  const fetchEvents = useCallback(async (sessionId) => {
    const { data: knocks, error: errK } = await supabase
      .from('knock_events')
      .select('*')
      .eq('session_id', sessionId);
      
    const { data: breaks, error: errB } = await supabase
      .from('break_sessions')
      .select('*')
      .eq('session_id', sessionId);

    if (errK || errB) {
      setError('Failed to load events');
      return;
    }

    const combined = [];
    (knocks || []).forEach(k => combined.push({ ...k, type: 'KNOCK' }));
    (breaks || []).forEach(b => {
      combined.push({
        id: b.id,
        type: 'BREAK',
        timestamp: b.break_start_time,
        duration: b.duration
      });
    });

    combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setEvents(combined);
  }, []);

  // ─── START DAY ───
  async function startDay() {
    setError('');
    const today = new Date().toISOString().split('T')[0];
    const { data, error: err } = await supabase
      .from('day_sessions')
      .insert({ rep_id: user.id, session_date: today })
      .select()
      .single();
    if (err) {
      setError('Failed to start day: ' + err.message);
      return;
    }
    setSession(data);
    setEvents([]);
    setStreet('');
    setStreetInput('');
    setHouseNum('');
    setDayState('ACTIVE');
  }

  // ─── END DAY ───
  async function endDay() {
    if (!session) return;
    setLogging(true);
    setError('');

    // 1. Generate CSV
    const rows = [
      ['Date', 'Time', 'Street', 'House Number', 'Outcome', 'Status/Objection', 'Callback Time']
    ];
    
    // Sort events historically for export
    const historicalEvents = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    historicalEvents.forEach(e => {
      if (e.type === 'KNOCK') {
        const d = new Date(e.timestamp);
        rows.push([
          d.toLocaleDateString(),
          d.toLocaleTimeString(),
          e.street_name || '',
          e.house_number || '',
          e.outcome_type || '',
          e.convo_status || e.objection_type || '',
          e.callback_time ? new Date(e.callback_time).toLocaleString() : ''
        ]);
      } else if (e.type === 'BREAK') {
        const d = new Date(e.timestamp);
        rows.push([
          d.toLocaleDateString(),
          d.toLocaleTimeString(),
          'BREAK',
          '',
          `${e.duration ? Math.floor(e.duration/60) + ' min' : 'Started'}`,
          '',
          ''
        ]);
      }
    });

    const csvContent = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // 2. Upload to storage
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${user.id}/${session.id}_${dateStr}.csv`;
    
    let exportUrl = null;
    let exportStatus = 'FAILED';
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('exports')
      .upload(fileName, blob, { upsert: true });
      
    if (!uploadErr && uploadData) {
      exportStatus = 'COMPLETE';
      exportUrl = fileName;
    } else {
      console.error("Export upload failed. You may need to verify Bucket permissions.", uploadErr);
    }

    // 3. Close Session in DB
    const { error: err } = await supabase
      .from('day_sessions')
      .update({ 
        status: 'CLOSED', 
        end_time: new Date().toISOString(),
        export_status: exportStatus,
        export_url: exportUrl
      })
      .eq('id', session.id);

    if (err) {
      setError('Failed to end day: ' + err.message);
      setLogging(false);
      return;
    }
    
    // 4. Update local state
    setSession({ ...session, status: 'CLOSED', export_status: exportStatus, export_url: exportUrl });
    setDayState('CLOSED');
    setLogging(false);
  }

  // ─── DOWNLOAD CSV ───
  async function downloadCsv() {
    if (!session?.export_url) return;
    const { data, error: err } = await supabase.storage.from('exports').download(session.export_url);
    if (!err && data) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = session.export_url.split('/').pop() || 'export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      setError('Failed to download export');
    }
  }

  // ─── SET STREET ───
  function commitStreet() {
    const s = streetInput.trim();
    if (!s) return;
    setStreet(s);
  }

  // ─── LOG KNOCK EVENT ───
  async function logKnock(outcomeType, convoOpt = null, cbTime = null) {
    if (dayState !== 'ACTIVE') return;
    if (!street || !houseNum) {
      setError('Set street & house number first');
      return;
    }
    setLogging(true);
    setError('');

    let cStatus = null;
    let oType = null;
    let cbFinal = cbTime;

    if (convoOpt === 'CALLBACK') {
      cStatus = 'CALLBACK';
    } else if (convoOpt) {
      oType = convoOpt;
      cStatus = 'OBJECTION';
    }

    if (cbFinal && cbFinal.trim() !== '') {
      cbFinal = new Date(cbFinal).toISOString();
    } else {
      cbFinal = null;
    }

    const { error: err } = await supabase.from('knock_events').insert({
      rep_id: user.id,
      session_id: session.id,
      street_name: street,
      house_number: houseNum,
      outcome_type: outcomeType,
      convo_status: cStatus,
      objection_type: oType,
      callback_time: cbFinal,
    });

    if (err) {
      setError('Failed to log: ' + err.message);
      setLogging(false);
      return;
    }

    // Auto-increment house number safely
    const numPart = houseNum.match(/\d+/);
    if (numPart) {
      const num = parseInt(numPart[0], 10);
      const nextNum = num + stepSize;
      setHouseNum(houseNum.replace(numPart[0], nextNum.toString()));
    }

    setFlashOutcome(outcomeType);
    setTimeout(() => setFlashOutcome(null), 600);
    
    // Reset panels
    setShowObjections(false);
    setShowCallbackPicker(false);
    setCallbackTime('');
    setLogging(false);
    fetchEvents(session.id);
  }

  function handleOutcome(outcomeType) {
    if (outcomeType === 'CONVO') {
      setShowObjections(true);
    } else {
      logKnock(outcomeType);
    }
  }

  function handleConvoOption(opt) {
    if (opt === 'CALLBACK') {
      setShowCallbackPicker(true);
    } else {
      logKnock('CONVO', opt);
    }
  }

  // ─── BREAK TOGGLE ───
  async function startBreak() {
    if (!session) return;
    const { data, error: err } = await supabase
      .from('break_sessions')
      .insert({ rep_id: user.id, session_id: session.id })
      .select()
      .single();
    if (err) {
      setError('Failed to start break: ' + err.message);
      return;
    }
    setActiveBreak(data);
    setDayState('ON_BREAK');
    fetchEvents(session.id);
  }

  async function endBreak() {
    if (!activeBreak) return;
    const now = new Date();
    const start = new Date(activeBreak.break_start_time);
    const durationSec = Math.round((now - start) / 1000);

    const { error: err } = await supabase
      .from('break_sessions')
      .update({
        break_end_time: now.toISOString(),
        duration: durationSec,
      })
      .eq('id', activeBreak.id);
    if (err) {
      setError('Failed to end break: ' + err.message);
      return;
    }
    setActiveBreak(null);
    setDayState('ACTIVE');
    fetchEvents(activeBreak.session_id);
  }

  // ─── DERIVED METRICS ───
  const totalDoors = events.filter(e => e.type === 'KNOCK').length;
  const totalConvos = events.filter(e => e.outcome_type === 'CONVO').length;
  const totalSales = events.filter(e => e.outcome_type === 'SALE').length;
  const conversionRate = totalDoors > 0 ? ((totalSales / totalDoors) * 100).toFixed(1) : '0.0';

  // ─── LOADING ───
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading session...</p>
      </div>
    );
  }

  // ═══════════════════════════════════════
  //  STATE: NOT_STARTED
  // ═══════════════════════════════════════
  if (dayState === 'NOT_STARTED') {
    return (
      <div className="logger-container">
        <header className="logger-header">
          <div className="header-left">
            <h1 className="app-title">KnockLog</h1>
            <span className="rep-badge" onClick={() => setShowProfile(!showProfile)}>
              {repName}
            </span>
          </div>
        </header>

        {showProfile && (
          <div className="profile-dropdown">
            <p className="profile-email">{user.email}</p>
            <button id="logout-btn" className="logout-btn" onClick={onLogout}>
              Sign Out
            </button>
          </div>
        )}

        {error && (
          <div className="error-bar" onClick={() => setError('')}>
            {error} <span className="error-dismiss">x</span>
          </div>
        )}

        <div className="start-day-screen">
          <div className="start-day-icon">K</div>
          <h2 className="start-day-title">Ready to knock?</h2>
          <p className="start-day-sub">Start your day session to begin logging doors.</p>
          <button className="start-day-btn" onClick={startDay}>
            START DAY
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  //  STATE: ON_BREAK
  // ═══════════════════════════════════════
  if (dayState === 'ON_BREAK') {
    return (
      <div className="logger-container">
        <header className="logger-header">
          <div className="header-left">
            <h1 className="app-title">KnockLog</h1>
            <span className="break-indicator">ON BREAK</span>
          </div>
          <div className="header-right">
            <div className="total-badge">{totalDoors} doors</div>
          </div>
        </header>

        {error && (
          <div className="error-bar" onClick={() => setError('')}>
            {error} <span className="error-dismiss">x</span>
          </div>
        )}

        <div className="break-overlay">
          <div className="break-icon">II</div>
          <h2 className="break-title">Break Active</h2>
          <p className="break-sub">Knock logging is paused</p>
          <BreakTimer start={activeBreak?.break_start_time} />
          <button className="resume-btn" onClick={endBreak}>
            RESUME
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  //  STATE: CLOSED
  // ═══════════════════════════════════════
  if (dayState === 'CLOSED') {
    // Street breakdown
    const streetMap = {};
    events.filter(e => e.type === 'KNOCK').forEach(e => {
      if (!streetMap[e.street_name]) streetMap[e.street_name] = { doors: 0, sales: 0, convos: 0 };
      streetMap[e.street_name].doors++;
      if (e.outcome_type === 'SALE') streetMap[e.street_name].sales++;
      if (e.outcome_type === 'CONVO') streetMap[e.street_name].convos++;
    });

    return (
      <div className="logger-container">
        <header className="logger-header">
          <div className="header-left">
            <h1 className="app-title">KnockLog</h1>
            <span className="closed-indicator">DAY CLOSED</span>
          </div>
        </header>

        <div className="closed-summary">
          <div className="hero-metric">
            <span className="hero-count">{totalDoors}</span>
            <span className="hero-label">TOTAL DOORS</span>
          </div>

          <div className="closed-metrics-row">
            <div className="closed-metric">
              <span className="closed-metric-count" style={{ color: '#3b82f6' }}>{totalConvos}</span>
              <span className="closed-metric-label">CONVO</span>
            </div>
            <div className="closed-metric">
              <span className="closed-metric-count" style={{ color: '#10b981' }}>{totalSales}</span>
              <span className="closed-metric-label">SALE</span>
            </div>
            <div className="closed-metric">
              <span className="closed-metric-count" style={{ color: '#f59e0b' }}>{conversionRate}%</span>
              <span className="closed-metric-label">CLOSE %</span>
            </div>
          </div>

          {session?.export_status === 'COMPLETE' && (
            <button className="download-btn" onClick={downloadCsv}>
              DOWNLOAD EXPORT CSV
            </button>
          )}

          {Object.keys(streetMap).length > 0 && (
            <div className="street-breakdown">
              <h3 className="street-breakdown-title">BY STREET</h3>
              {Object.entries(streetMap).map(([name, stats]) => (
                <div className="street-row" key={name}>
                  <span className="street-name">{name}</span>
                  <span className="street-stat">{stats.doors}D / {stats.convos}C / {stats.sales}S</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="profile-dropdown" style={{ marginTop: 16 }}>
          <button 
            className="start-new-session-btn" 
            onClick={startDay} 
            style={{ marginBottom: 12, width: '100%', padding: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}
          >
            START ANOTHER SESSION
          </button>
          <p className="profile-email">{user.email}</p>
          <button id="logout-btn" className="logout-btn" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  //  STATE: ACTIVE (main logging screen)
  // ═══════════════════════════════════════
  return (
    <div className="logger-container">
      {/* Flash overlay */}
      {flashOutcome && (
        <div className="flash-overlay" key={flashOutcome + Date.now()}>
          <span>LOGGED</span>
        </div>
      )}

      {/* Header */}
      <header className="logger-header">
        <div className="header-left">
          <h1 className="app-title">KnockLog</h1>
          <span className="rep-badge" onClick={() => setShowProfile(!showProfile)}>
            {repName}
          </span>
        </div>
        <div className="header-right">
          <button className="break-btn" onClick={startBreak} disabled={logging}>BREAK</button>
          <button className="end-day-btn" onClick={endDay} disabled={logging}>
            {logging ? 'CLOSING...' : 'END'}
          </button>
        </div>
      </header>

      {/* Profile dropdown */}
      {showProfile && (
        <div className="profile-dropdown">
          <p className="profile-email">{user.email}</p>
          <button id="logout-btn" className="logout-btn" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div className="error-bar" onClick={() => setError('')}>
          {error} <span className="error-dismiss">x</span>
        </div>
      )}

      {/* Location / Cursor Box */}
      <div className="location-panel">
        {street ? (
          <>
            <div className="active-street-container">
              <div className="active-street">{street}</div>
              <button className="end-street-btn" onClick={() => { setStreet(''); setStreetInput(''); }}>END STREET</button>
            </div>
            
            <div className="house-cursor-bar">
              <input
                type="text"
                className="house-input"
                placeholder="House #"
                value={houseNum}
                onChange={e => setHouseNum(e.target.value)}
              />
              <div className="step-toggles">
                <button className={`step-btn ${stepSize === 1 ? 'active' : ''}`} onClick={() => setStepSize(1)}>+1</button>
                <button className={`step-btn ${stepSize === 2 ? 'active' : ''}`} onClick={() => setStepSize(2)}>+2</button>
              </div>
            </div>
          </>
        ) : (
          <div className="street-bar">
            <input
              type="text"
              className="street-input"
              placeholder="Enter street name..."
              value={streetInput}
              onChange={e => setStreetInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitStreet(); }}
            />
            <button className="street-set-btn" onClick={commitStreet}>START</button>
          </div>
        )}
      </div>

      {/* HERO: Total Doors */}
      <div className="hero-metric">
        <span className="hero-count">{totalDoors}</span>
        <span className="hero-label">TOTAL DOORS</span>
      </div>

      <div className="metrics-strip sub-metrics">
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#10b981' }}>{totalSales}</span>
          <span className="metric-label">SALE</span>
        </div>
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#3b82f6' }}>{totalConvos}</span>
          <span className="metric-label">CONVO</span>
        </div>
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#f59e0b' }}>{conversionRate}%</span>
          <span className="metric-label">CLOSE %</span>
        </div>
      </div>

      {/* Outcomes / Objections / Callback Panel */}
      {showCallbackPicker ? (
        <div className="objection-panel">
          <div className="objection-header">
            <span>Callback Time (Optional)</span>
            <button className="objection-cancel" onClick={() => setShowCallbackPicker(false)}>x</button>
          </div>
          <div className="callback-picker-container">
            <input 
              type="datetime-local" 
              className="callback-input"
              value={callbackTime}
              onChange={e => setCallbackTime(e.target.value)}
            />
            <button 
              className="callback-confirm-btn"
              disabled={logging}
              onClick={() => logKnock('CONVO', 'CALLBACK', callbackTime)}
            >
              LOG CALLBACK
            </button>
          </div>
        </div>
      ) : showObjections ? (
        <div className="objection-panel">
          <div className="objection-header">
            <span>Select Result</span>
            <button className="objection-cancel" onClick={() => setShowObjections(false)}>x</button>
          </div>
          <div className="objection-grid">
            {CONVO_OPTIONS.map(opt => (
              <button
                key={opt}
                className={`objection-btn ${opt === 'CALLBACK' ? 'cb-highlight' : ''}`}
                disabled={logging}
                onClick={() => handleConvoOption(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="outcome-grid outcome-grid-3">
          {OUTCOMES.map(o => (
            <button
              key={o.key}
              id={`btn-${o.key.toLowerCase()}`}
              className="outcome-btn"
              style={{ '--btn-color': o.color }}
              disabled={logging || !street || !houseNum}
              onClick={() => handleOutcome(o.key)}
            >
              <span className="outcome-label">{o.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Recent events */}
      <div className="recent-logs">
        <h2 className="recent-title">Recent</h2>
        {events.length === 0 ? (
          <p className="no-logs">No events logged yet. Set a street, house #, and start knocking.</p>
        ) : (
          <div className="log-list">
            {events.slice(0, 30).map(e => (
              <div className="log-item" key={e.id}>
                {e.type === 'BREAK' ? (
                  <>
                    <div className="log-outcome" style={{ color: '#f59e0b' }}>BREAK</div>
                    <div className="log-objection">{e.duration ? `${Math.floor(e.duration / 60)}m` : 'Active'}</div>
                    <div className="log-street"></div>
                  </>
                ) : (
                  <>
                    <div className="log-outcome" style={{
                      color: OUTCOMES.find(o => o.key === e.outcome_type)?.color || '#fff'
                    }}>
                      {e.outcome_type.replace('_', ' ')}
                    </div>
                    {(e.objection_type || e.convo_status) && (
                      <div className="log-objection">
                        {e.convo_status === 'CALLBACK' && e.callback_time ? 
                          `CB: ${new Date(e.callback_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 
                          (e.objection_type || e.convo_status)}
                      </div>
                    )}
                    <div className="log-street">{e.house_number ? `${e.house_number} ` : ''}{e.street_name}</div>
                  </>
                )}
                <div className="log-time">
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Break Timer Component ───
function BreakTimer({ start }) {
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (!start) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(start).getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [start]);

  return <div className="break-timer">{elapsed}</div>;
}
