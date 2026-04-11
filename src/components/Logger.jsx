import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const OUTCOMES = [
  { key: 'NO_ANSWER', label: 'NO ANSWER', color: '#6b7280' },
  { key: 'CONVO', label: 'CONVO', color: '#3b82f6' },
  { key: 'SALE', label: 'SALE', color: '#10b981' },
];

const OBJECTIONS = [
  'NOT INTERESTED',
  'ALREADY HAVE / DIY',
  'BAD TIMING',
  'NEED TO THINK',
  'NOT DECISION MAKER',
  'NOT QUALIFIED',
];

// States: NOT_STARTED | ACTIVE | ON_BREAK | CLOSED
export default function Logger({ user, repName, onLogout }) {
  const [dayState, setDayState] = useState('NOT_STARTED');
  const [session, setSession] = useState(null);
  const [street, setStreet] = useState('');
  const [streetInput, setStreetInput] = useState('');
  const [events, setEvents] = useState([]);
  const [activeBreak, setActiveBreak] = useState(null);
  const [showObjections, setShowObjections] = useState(false);
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
        .single();

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
    const { data, error: err } = await supabase
      .from('knock_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false });
    if (err) {
      setError('Failed to load events');
      return;
    }
    setEvents(data || []);
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
    setDayState('ACTIVE');
  }

  // ─── END DAY ───
  async function endDay() {
    if (!session) return;
    const { error: err } = await supabase
      .from('day_sessions')
      .update({ status: 'CLOSED', end_time: new Date().toISOString() })
      .eq('id', session.id);
    if (err) {
      setError('Failed to end day: ' + err.message);
      return;
    }
    setSession({ ...session, status: 'CLOSED' });
    setDayState('CLOSED');
  }

  // ─── SET STREET ───
  function commitStreet() {
    const s = streetInput.trim();
    if (!s) return;
    setStreet(s);
  }

  // ─── LOG KNOCK EVENT ───
  async function logKnock(outcomeType, objection = null) {
    if (dayState !== 'ACTIVE') return;
    if (!street) {
      setError('Set a street name first');
      return;
    }
    setLogging(true);
    setError('');

    const { error: err } = await supabase.from('knock_events').insert({
      rep_id: user.id,
      session_id: session.id,
      street_name: street,
      outcome_type: outcomeType,
      objection_type: objection,
    });

    if (err) {
      setError('Failed to log: ' + err.message);
      setLogging(false);
      return;
    }

    setFlashOutcome(outcomeType);
    setTimeout(() => setFlashOutcome(null), 600);
    setShowObjections(false);
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
  }

  // ─── DERIVED METRICS ───
  const totalDoors = events.length;
  const totalConvos = events.filter(e => e.outcome_type === 'CONVO').length;
  const totalSales = events.filter(e => e.outcome_type === 'SALE').length;
  const totalNA = events.filter(e => e.outcome_type === 'NO_ANSWER').length;
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
    events.forEach(e => {
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
              <span className="closed-metric-count" style={{ color: '#6b7280' }}>{totalNA}</span>
              <span className="closed-metric-label">N/A</span>
            </div>
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
          <button className="break-btn" onClick={startBreak}>BREAK</button>
          <button className="end-day-btn" onClick={endDay}>END</button>
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

      {/* Street input */}
      <div className="street-bar">
        <input
          type="text"
          className="street-input"
          placeholder="Enter street name..."
          value={streetInput}
          onChange={e => setStreetInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitStreet(); }}
        />
        <button className="street-set-btn" onClick={commitStreet}>SET</button>
      </div>
      {street && (
        <div className="active-street">
          {street}
        </div>
      )}

      {/* HERO: Total Doors */}
      <div className="hero-metric">
        <span className="hero-count">{totalDoors}</span>
        <span className="hero-label">TOTAL DOORS</span>
      </div>

      {/* Secondary metrics */}
      <div className="metrics-strip">
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#6b7280' }}>{totalNA}</span>
          <span className="metric-label">N/A</span>
        </div>
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#3b82f6' }}>{totalConvos}</span>
          <span className="metric-label">CONVO</span>
        </div>
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#10b981' }}>{totalSales}</span>
          <span className="metric-label">SALE</span>
        </div>
        <div className="metric-item">
          <span className="metric-count" style={{ color: '#f59e0b' }}>{conversionRate}%</span>
          <span className="metric-label">CLOSE %</span>
        </div>
      </div>

      {/* Outcome buttons or Objection picker */}
      {showObjections ? (
        <div className="objection-panel">
          <div className="objection-header">
            <span>Select objection</span>
            <button className="objection-cancel" onClick={() => setShowObjections(false)}>x</button>
          </div>
          <div className="objection-grid">
            {OBJECTIONS.map(obj => (
              <button
                key={obj}
                className="objection-btn"
                disabled={logging}
                onClick={() => logKnock('CONVO', obj)}
              >
                {obj}
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
              disabled={logging || !street}
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
          <p className="no-logs">No events logged yet. Set a street and start knocking.</p>
        ) : (
          <div className="log-list">
            {events.slice(0, 25).map(e => (
              <div className="log-item" key={e.id}>
                <div className="log-outcome" style={{
                  color: OUTCOMES.find(o => o.key === e.outcome_type)?.color || '#fff'
                }}>
                  {e.outcome_type.replace('_', ' ')}
                </div>
                {e.objection_type && <div className="log-objection">{e.objection_type}</div>}
                <div className="log-street">{e.street_name}</div>
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
