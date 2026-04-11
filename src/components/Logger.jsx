import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const OUTCOMES = [
  { key: 'NO ANSWER', color: '#6b7280', emoji: '🚫' },
  { key: 'CONVO', color: '#3b82f6', emoji: '💬' },
  { key: 'QUOTE', color: '#f59e0b', emoji: '📋' },
  { key: 'SALE', color: '#10b981', emoji: '🎉' },
];

const OBJECTIONS = [
  'NOT INTERESTED',
  'ALREADY HAVE / DIY',
  'BAD TIMING',
  'NEED TO THINK',
  'NOT DECISION MAKER',
  'NOT QUALIFIED',
];

export default function Logger({ user, repName, onLogout }) {
  const [todayKnocks, setTodayKnocks] = useState([]);
  const [showObjections, setShowObjections] = useState(false);
  const [logging, setLogging] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [flashOutcome, setFlashOutcome] = useState(null);
  const [error, setError] = useState('');

  // Get start of today in UTC
  function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  const fetchToday = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from('knocks')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', todayStart())
      .order('created_at', { ascending: false });

    if (fetchErr) {
      setError('Failed to load today\'s knocks');
      return;
    }
    setTodayKnocks(data || []);
  }, [user.id]);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  async function logKnock(outcome, objection = null) {
    setLogging(true);
    setError('');

    const { error: insertErr } = await supabase.from('knocks').insert({
      user_id: user.id,
      rep_name: repName,
      outcome,
      objection,
    });

    if (insertErr) {
      setError('Failed to log: ' + insertErr.message);
      setLogging(false);
      return;
    }

    // Flash feedback
    setFlashOutcome(outcome);
    setTimeout(() => setFlashOutcome(null), 600);

    setShowObjections(false);
    setLogging(false);
    fetchToday();
  }

  function handleOutcome(outcome) {
    if (outcome === 'CONVO') {
      setShowObjections(true);
    } else {
      logKnock(outcome);
    }
  }

  // Metrics
  const total = todayKnocks.length;
  const counts = {};
  OUTCOMES.forEach(o => { counts[o.key] = 0; });
  todayKnocks.forEach(k => {
    if (counts[k.outcome] !== undefined) counts[k.outcome]++;
  });

  return (
    <div className="logger-container">
      {/* Flash overlay */}
      {flashOutcome && (
        <div className="flash-overlay" key={flashOutcome + Date.now()}>
          <span>✓ {flashOutcome}</span>
        </div>
      )}

      {/* Header */}
      <header className="logger-header">
        <div className="header-left">
          <h1 className="app-title">KnockLog</h1>
          <span className="version-tag">v1.0.1</span>
          <span className="rep-badge" onClick={() => setShowProfile(!showProfile)}>
            {repName}
          </span>
        </div>
        <div className="header-right">
          <div className="total-badge">{total} today</div>
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
          {error} <span className="error-dismiss">✕</span>
        </div>
      )}

      {/* Metrics strip */}
      <div className="metrics-strip">
        {OUTCOMES.map(o => (
          <div className="metric-item" key={o.key}>
            <span className="metric-count" style={{ color: o.color }}>{counts[o.key]}</span>
            <span className="metric-label">{o.key === 'NO ANSWER' ? 'N/A' : o.key}</span>
          </div>
        ))}
      </div>

      {/* Main buttons or objection buttons */}
      {showObjections ? (
        <div className="objection-panel">
          <div className="objection-header">
            <span>Select objection</span>
            <button className="objection-cancel" onClick={() => setShowObjections(false)}>✕</button>
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
        <div className="outcome-grid">
          {OUTCOMES.map(o => (
            <button
              key={o.key}
              id={`btn-${o.key.replace(/\s/g, '-').toLowerCase()}`}
              className="outcome-btn"
              style={{ '--btn-color': o.color }}
              disabled={logging}
              onClick={() => handleOutcome(o.key)}
            >
              <span className="outcome-emoji">{o.emoji}</span>
              <span className="outcome-label">{o.key}</span>
            </button>
          ))}
        </div>
      )}

      {/* Recent logs */}
      <div className="recent-logs">
        <h2 className="recent-title">Recent</h2>
        {todayKnocks.length === 0 ? (
          <p className="no-logs">No knocks logged today. Start tapping!</p>
        ) : (
          <div className="log-list">
            {todayKnocks.slice(0, 20).map(k => (
              <div className="log-item" key={k.id}>
                <div className="log-outcome" style={{
                  color: OUTCOMES.find(o => o.key === k.outcome)?.color || '#fff'
                }}>
                  {OUTCOMES.find(o => o.key === k.outcome)?.emoji} {k.outcome}
                </div>
                {k.objection && <div className="log-objection">{k.objection}</div>}
                <div className="log-time">
                  {new Date(k.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
