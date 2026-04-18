import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { sqlocal, insertLocalEvent, updateLocalEvent, softDeleteLocalEvent } from '../lib/db';
import { syncEngine } from '../lib/syncEngine';

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

export default function Logger({ user, repName, onLogout, isActive }) {
  const [dayState, setDayState] = useState('NOT_STARTED');
  const [session, setSession] = useState(null);
  const [street, setStreet] = useState('');
  const [streetInput, setStreetInput] = useState('');
  const [streetSuggestions, setStreetSuggestions] = useState([]);
  const [streetCoords, setStreetCoords] = useState(null);
  
  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

  const [houseNum, setHouseNum] = useState('');
  const [stepSize, setStepSize] = useState(2);

  const [events, setEvents] = useState([]);
  const [activeBreak, setActiveBreak] = useState(null);
  
  const [showObjections, setShowObjections] = useState(false);
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackTime, setCallbackTime] = useState('');

  const [logging, setLogging] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [flashOutcome, setFlashOutcome] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Edit / Notes State
  const [editingEvent, setEditingEvent] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [editOutcome, setEditOutcome] = useState('');
  const [editHouseNum, setEditHouseNum] = useState('');
  const longPressTimerRef = useRef(null);

  // Sync Observability
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  // Silent geolocation capture (zero friction)
  const geoRef = useRef({ lat: null, lng: null });
  const watchIdRef = useRef(null);

  useEffect(() => {
    syncEngine.setUserId(user.id);
    syncEngine.start();

    async function bootstrapLocal() {
      try {
        const rs = await sqlocal.sql`SELECT * FROM events ORDER BY created_at ASC`;
        let sess = null;
        let dState = 'NOT_STARTED';
        let aBreak = null;
        let evts = [];

        // Rebuild state entirely from local append-only event log
        for (let row of rs) {
          const payload = JSON.parse(row.payload);
          if (row.type === 'DAY_START') {
            const today = new Date().toISOString().split('T')[0];
            if (payload.session_date === today) {
              sess = payload;
              dState = 'ACTIVE';
              evts = [];
            }
          } else if (row.type === 'DAY_END' && sess && payload.session_id === sess.session_id) {
            sess.status = 'CLOSED';
            sess.export_status = payload.export_status;
            sess.export_url = payload.export_url;
            dState = 'CLOSED';
          } else if (row.type === 'KNOCK' && sess && payload.session_id === sess.session_id) {
            evts.push({ id: payload.event_id, type: 'KNOCK', ...payload });
          } else if (row.type === 'BREAK_START' && sess && payload.session_id === sess.session_id) {
            aBreak = payload;
            dState = 'ON_BREAK';
            evts.push({ id: payload.break_id, type: 'BREAK', timestamp: payload.break_start_time });
          } else if (row.type === 'BREAK_END' && sess && payload.session_id === sess.session_id) {
            if (aBreak && aBreak.break_id === payload.break_id) {
              aBreak = null;
              dState = 'ACTIVE';
              const idx = evts.findIndex(e => e.type === 'BREAK' && e.id === payload.break_id);
              if (idx > -1) evts[idx].duration = payload.duration;
            }
          }
        }

        setSession(sess);
        setDayState(dState);
        setActiveBreak(aBreak);
        setEvents(evts.reverse());
      } catch (e) {
        console.error("Local bootstrap failed:", e);
      } finally {
        setLoading(false);
      }
    }
    
    bootstrapLocal();

    const updateSyncStatus = async () => {
      try {
        const rs = await sqlocal.sql`SELECT COUNT(*) as count FROM events WHERE synced = 0`;
        if (rs && rs[0]) setUnsyncedCount(rs[0].count);
      } catch(e) {}
    };

    // Subscribe to sync engine events — no need for a separate polling interval
    const unsub = syncEngine.subscribe(updateSyncStatus);
    updateSyncStatus();

    return () => { 
      unsub(); 
      syncEngine.stop();
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [user.id]);

  // ── GPS lifecycle: only track location when tab is active & session is running ──
  useEffect(() => {
    const shouldTrack = isActive && (dayState === 'ACTIVE');

    if (shouldTrack && 'geolocation' in navigator && watchIdRef.current === null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          geoRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        },
        () => { /* silently ignore denied/timeout */ },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
      );
    } else if (!shouldTrack && watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isActive, dayState]);

  async function startDay() {
    setError('');
    const sessionId = crypto.randomUUID();
    const today = new Date().toISOString().split('T')[0];
    const payload = {
      session_id: sessionId,
      session_date: today,
      start_time: new Date().toISOString()
    };
    
    await insertLocalEvent(crypto.randomUUID(), 'DAY_START', payload);
    
    setSession(payload);
    setEvents([]);
    setStreet('');
    setStreetInput('');
    setStreetCoords(null);
    setHouseNum('');
    setDayState('ACTIVE');
  }

  async function endDay() {
    if (!session) return;
    setLogging(true);
    setError('');

    const rows = [
      ['Date', 'Time', 'Street', 'House Number', 'Outcome', 'Status/Objection', 'Callback Time']
    ];
    
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
    
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${user.id}/${session.session_id}_${dateStr}.csv`;
    
    let exportUrl = null;
    let exportStatus = 'FAILED';

    if (navigator.onLine) {
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('exports')
        .upload(fileName, blob, { upsert: true });
        
      if (!uploadErr && uploadData) {
        exportStatus = 'COMPLETE';
        exportUrl = fileName;
      }
    }

    const payload = {
      session_id: session.session_id,
      end_time: new Date().toISOString(),
      export_status: exportStatus,
      export_url: exportUrl
    };

    await insertLocalEvent(crypto.randomUUID(), 'DAY_END', payload);

    setSession({ ...session, status: 'CLOSED', export_status: exportStatus, export_url: exportUrl });
    setDayState('CLOSED');
    setLogging(false);
  }

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

  const handleStreetInputChange = async (e) => {
    const val = e.target.value;
    setStreetInput(val);
    
    if (val.trim().length > 2) {
      try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=4`);
        const data = await res.json();
        setStreetSuggestions(data.features || []);
      } catch (err) {
        setStreetSuggestions([]);
      }
    } else {
      setStreetSuggestions([]);
    }
  };

  const selectStreetSuggestion = (feature) => {
    const name = feature.text || feature.place_name?.split(',')[0] || ''; 
    setStreetInput(name);
    if (feature.center) {
      setStreetCoords({ lng: feature.center[0], lat: feature.center[1] });
    }
    setStreetSuggestions([]);
  };

  function commitStreet() {
    const s = streetInput.trim();
    if (!s) return;
    setStreet(s);
    setStreetSuggestions([]);
  }

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

    const eventId = crypto.randomUUID();
    const payload = {
      event_id: eventId,
      session_id: session.session_id,
      street_name: street,
      house_number: houseNum,
      timestamp: new Date().toISOString(),
      outcome_type: outcomeType,
      convo_status: cStatus,
      objection_type: oType,
      callback_time: cbFinal,
      lat: geoRef.current.lat || streetCoords?.lat,
      lng: geoRef.current.lng || streetCoords?.lng,
    };

    // LOCAL WRITE GUARANTEE (Appends instantly regardless of network)
    await insertLocalEvent(eventId, 'KNOCK', payload);

    // BACKGROUND ROOFTOP GEOCODING (Tags the specific house property perfectly on the map)
    if (navigator.onLine) {
      setTimeout(async () => {
        try {
          const query = `${houseNum} ${street}`;
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`);
          const data = await res.json();
          if (data.features?.length > 0) {
            const updatedPayload = { 
              ...payload, 
              lat: data.features[0].center[1], // new exact rooftop lat
              lng: data.features[0].center[0]  // new exact rooftop lng
            };
            await sqlocal.sql`UPDATE events SET payload = ${JSON.stringify(updatedPayload)} WHERE event_id = ${eventId}`;
          }
        } catch (e) {
          // Fail silently; local DB retains the GPS/St center fallback
        }
      }, 0);
    }

    // Apply safely to UI
    const numPart = houseNum.match(/\d+/);
    if (numPart) {
      const num = parseInt(numPart[0], 10);
      const nextNum = num + stepSize;
      setHouseNum(houseNum.replace(numPart[0], nextNum.toString()));
    }

    setFlashOutcome(outcomeType);
    setTimeout(() => setFlashOutcome(null), 600);
    
    setShowObjections(false);
    setShowCallbackPicker(false);
    setCallbackTime('');
    setLogging(false);
    
    // Unshift into events to maintain reverse chronology
    setEvents(prev => [{ id: eventId, type: 'KNOCK', ...payload }, ...prev]);
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

  const handleTouchStart = (e, evt) => {
    if (evt.type !== 'KNOCK') return;
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(50);
      setEditingEvent(evt);
      setEditNotes(evt.notes || '');
      setEditOutcome(evt.outcome_type || '');
      setEditHouseNum(evt.house_number || '');
    }, 500);
  };

  const handleTouchEndOrMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const saveEdit = async () => {
    if (!editingEvent) return;
    const updatedPayload = {
      ...editingEvent,
      notes: editNotes,
      outcome_type: editOutcome,
      house_number: editHouseNum
    };
    await updateLocalEvent(editingEvent.id, updatedPayload);
    setEvents(prev => prev.map(e => e.id === editingEvent.id ? { ...e, ...updatedPayload } : e));
    setEditingEvent(null);
  };

  const deleteEdit = async () => {
    if (!editingEvent) return;
    await softDeleteLocalEvent(editingEvent.id);
    setEvents(prev => prev.filter(e => e.id !== editingEvent.id));
    setEditingEvent(null);
  };

  async function startBreak() {
    if (!session) return;
    const breakId = crypto.randomUUID();
    const payload = {
      break_id: breakId,
      session_id: session.session_id,
      break_start_time: new Date().toISOString()
    };
    await insertLocalEvent(crypto.randomUUID(), 'BREAK_START', payload);
    setActiveBreak(payload);
    setDayState('ON_BREAK');
    setEvents(prev => [{ id: breakId, type: 'BREAK', timestamp: payload.break_start_time }, ...prev]);
  }

  async function endBreak() {
    if (!activeBreak) return;
    const now = new Date();
    const start = new Date(activeBreak.break_start_time);
    const durationSec = Math.round((now - start) / 1000);

    const payload = {
      break_id: activeBreak.break_id,
      session_id: session.session_id,
      break_end_time: now.toISOString(),
      duration: durationSec
    };

    await insertLocalEvent(crypto.randomUUID(), 'BREAK_END', payload);
    
    setActiveBreak(null);
    setDayState('ACTIVE');
    
    // Update local UI
    setEvents(prev => prev.map(e => {
      if (e.type === 'BREAK' && e.id === activeBreak.break_id) {
        return { ...e, duration: durationSec };
      }
      return e;
    }));
  }

  const propertyOutcomes = {};
  [...events].reverse().forEach(e => {
    if (e.type === 'KNOCK') {
      const address = `${e.house_number || ''} ${e.street_name || ''}`.trim();
      if (address) {
        propertyOutcomes[address] = {
          outcome: e.outcome_type,
          objection: e.objection_type
        };
      }
    }
  });

  const doorList = Object.values(propertyOutcomes);
  const totalDoors = doorList.length;
  const totalSales = doorList.filter(o => o.outcome === 'SALE').length;
  // Qualfied = Talked to decision maker. Filter out NO_ANSWER and NOT DECISION MAKER.
  const totalConvos = doorList.filter(o => o.outcome === 'CONVO' && o.objection !== 'NOT DECISION MAKER').length;
  
  const qualifiedDoors = totalSales + totalConvos;
  const conversionRate = qualifiedDoors > 0 ? ((totalSales / qualifiedDoors) * 100).toFixed(1) : '0.0';

  const isReknock = street && houseNum && events.some(e => 
    e.type === 'KNOCK' && 
    e.street_name === street && 
    e.house_number === houseNum
  );

  const feedItems = [];
  const feedAddressMap = new Map();
  events.forEach(e => {
    if (e.type === 'BREAK') {
      feedItems.push(e);
    } else if (e.type === 'KNOCK') {
      const addr = `${e.house_number || ''} ${e.street_name || ''}`.trim();
      if (feedAddressMap.has(addr)) {
        const existingIdx = feedAddressMap.get(addr);
        if (!feedItems[existingIdx].previousKnocks) feedItems[existingIdx].previousKnocks = [];
        feedItems[existingIdx].previousKnocks.push(e);
      } else {
        feedItems.push({ ...e, previousKnocks: [] });
        feedAddressMap.set(addr, feedItems.length - 1);
      }
    }
  });

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading session...</p>
      </div>
    );
  }

  const SyncIndicator = () => (
    <div style={{ position: 'fixed', bottom: 74, right: 10, background: '#1f2937', color: unsyncedCount > 0 ? '#f59e0b' : '#10b981', padding: '4px 8px', borderRadius: 4, fontSize: '10px', zIndex: 999 }}>
      {unsyncedCount > 0 ? `Syncing ${unsyncedCount} events...` : 'Synced'}
    </div>
  );

  if (dayState === 'NOT_STARTED') {
    return (
      <div className="logger-container">
        <SyncIndicator />
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
          <p className="start-day-sub">Your events are securely saved offline.</p>
          <button className="start-day-btn" onClick={startDay}>
            START DAY
          </button>
        </div>
      </div>
    );
  }

  if (dayState === 'ON_BREAK') {
    return (
      <div className="logger-container">
        <SyncIndicator />
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

  if (dayState === 'CLOSED') {
    const streetMap = {};
    // Use propertyOutcomes logic to avoid double-counting reknocks in street summary
    const uniquePropertyStats = {};
    [...events].reverse().forEach(e => {
      if (e.type === 'KNOCK') {
        const addr = `${e.house_number || ''} ${e.street_name || ''}`.trim();
        if (addr && !uniquePropertyStats[addr]) {
          uniquePropertyStats[addr] = e;
        }
      }
    });

    Object.values(uniquePropertyStats).forEach(e => {
      if (!streetMap[e.street_name]) streetMap[e.street_name] = { doors: 0, sales: 0, convos: 0 };
      streetMap[e.street_name].doors++;
      if (e.outcome_type === 'SALE') {
        streetMap[e.street_name].sales++;
      } else if (e.outcome_type === 'CONVO' && e.objection_type !== 'NOT DECISION MAKER') {
        streetMap[e.street_name].convos++;
      }
    });

    // Session Analytics Calculations
    const startT = session?.start_time ? new Date(session.start_time) : null;
    const endT = session?.end_time ? new Date(session.end_time) : new Date();
    const totalMs = startT ? (endT - startT) : 0;
    
    let totalBreakSec = 0;
    events.forEach(e => {
      if (e.type === 'BREAK' && e.duration) totalBreakSec += e.duration;
    });
    
    const activeMs = Math.max(0, totalMs - (totalBreakSec * 1000));
    const activeHours = Math.max(0.01, activeMs / (1000 * 60 * 60));
    
    const dph = (totalDoors / activeHours).toFixed(1);
    const pph = (qualifiedDoors / activeHours).toFixed(1);
    
    const objectionCounts = {};
    events.forEach(e => {
      const obj = e.objection_type;
      if (e.outcome_type === 'CONVO' && obj && obj !== 'CALLBACK' && obj !== 'NOT DECISION MAKER') {
        objectionCounts[obj] = (objectionCounts[obj] || 0) + 1;
      }
    });
    const maxObjectionCount = Math.max(...Object.values(objectionCounts), 1);

    let bestStreet = { name: 'N/A', sales: -1 };
    Object.entries(streetMap).forEach(([name, stats]) => {
      if (stats.sales > bestStreet.sales) {
        bestStreet = { name, sales: stats.sales };
      }
    });

    const formatDuration = (ms) => {
      const hours = Math.floor(ms / (1000 * 60 * 60));
      const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${mins}m`;
    };

    return (
      <div className="logger-container">
        <SyncIndicator />
        <header className="logger-header">
          <div className="header-left">
            <h1 className="app-title">KnockLog</h1>
            <span className="closed-indicator">DAY CLOSED</span>
          </div>
        </header>

        <div className="closed-summary">
          <div className="hero-metric">
            <span className="hero-count">{totalSales}</span>
            <span className="hero-label">TOTAL SALES</span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-card-label">Session Time</span>
              <span className="stat-card-value">{formatDuration(totalMs)}</span>
              <span className="stat-card-sub">{totalBreakSec > 0 ? `${Math.floor(totalBreakSec/60)}m break` : 'No breaks'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-label">Close Rate</span>
              <span className="stat-card-value" style={{ color: 'var(--success)' }}>{conversionRate}%</span>
              <span className="stat-card-sub">{totalSales} of {qualifiedDoors} pitches</span>
            </div>
          </div>

          <div className="efficiency-section">
            <h3 className="efficiency-title">Efficiency Analytics</h3>
            <div className="efficiency-row">
              <div className="efficiency-metric">
                <span className="efficiency-val">{dph}</span>
                <span className="efficiency-lab">Doors / Active Hr</span>
              </div>
              <div className="efficiency-metric" style={{ textAlign: 'right' }}>
                <span className="efficiency-val">{pph}</span>
                <span className="efficiency-lab">Pitches / Active Hr</span>
              </div>
            </div>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.04)' }}></div>
            <div className="efficiency-row">
              <div className="efficiency-metric">
                <span className="efficiency-val">{totalDoors}</span>
                <span className="efficiency-lab">Total Doors</span>
              </div>
              <div className="efficiency-metric" style={{ textAlign: 'right' }}>
                <span className="efficiency-val">{totalConvos}</span>
                <span className="efficiency-lab">Real Conversations</span>
              </div>
            </div>
          </div>

          {bestStreet.sales > 0 && (
            <div className="best-street-badge">
              <div className="best-street-info">
                <h4>Top Street</h4>
                <div className="best-street-name">{bestStreet.name}</div>
              </div>
              <div className="usage-count" style={{ color: 'var(--success)', fontSize: '18px' }}>{bestStreet.sales}S</div>
            </div>
          )}

          {Object.keys(objectionCounts).length > 0 && (
            <div className="objections-analytics">
              <h3 className="analytics-title">Objection Data</h3>
              <div className="objection-usage-bar">
                {Object.entries(objectionCounts).sort((a,b) => b[1] - a[1]).map(([label, count]) => (
                  <div className="usage-item" key={label}>
                    <div className="usage-label">{label}</div>
                    <div className="usage-track">
                      <div className="usage-fill" style={{ width: `${(count / maxObjectionCount) * 100}%` }}></div>
                    </div>
                    <div className="usage-count">{count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {session?.export_status === 'COMPLETE' && (
            <button className="download-btn" onClick={downloadCsv} style={{ marginTop: 12 }}>
              DOWNLOAD SESSION CSV
            </button>
          )}

          {Object.keys(streetMap).length > 0 && (
            <div className="street-breakdown" style={{ marginTop: 8 }}>
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

  return (
    <div className="logger-container">
      <SyncIndicator />
      {flashOutcome && (
        <div className="flash-overlay" key={flashOutcome + Date.now()}>
          <span>LOGGED</span>
        </div>
      )}

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

      <div className="location-panel">
        {street ? (
          <>
            <div className="active-street-container">
              <div className="active-street">
                {street}
                {isReknock && <span style={{ marginLeft: 8, fontSize: '0.65em', background: '#f59e0b', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>REKNOCK</span>}
              </div>
              <button className="end-street-btn" onClick={() => { setStreet(''); setStreetInput(''); setStreetCoords(null); }}>END STREET</button>
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
                <button 
                  className="step-btn active" 
                  onClick={() => setStepSize(prev => prev > 0 ? -Math.abs(prev) : Math.abs(prev))}
                >
                  {stepSize > 0 ? '+' : '-'}
                </button>
                <button 
                  className="step-btn active" 
                  onClick={() => setStepSize(prev => (prev > 0 ? 1 : -1) * (Math.abs(prev) === 1 ? 2 : 1))}
                >
                  {Math.abs(stepSize)}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="street-bar" style={{ position: 'relative' }}>
            <input
              type="text"
              className="street-input"
              placeholder="Enter street name..."
              value={streetInput}
              onChange={handleStreetInputChange}
              onKeyDown={e => { if (e.key === 'Enter') commitStreet(); }}
            />
            <button className="street-set-btn" onClick={commitStreet}>START</button>
            
            {streetSuggestions.length > 0 && (
              <div className="autocomplete-dropdown" style={{
                position: 'absolute', top: '100%', left: 0, right: '70px',
                background: 'var(--bg-card)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                zIndex: 100, marginTop: '4px', overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
              }}>
                {streetSuggestions.map(f => (
                  <div 
                    key={f.id} 
                    onClick={() => selectStreetSuggestion(f)}
                    style={{
                      padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)'
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{f.text}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{f.place_name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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

      <div className="recent-logs">
        <h2 className="recent-title">Recent</h2>
        {events.length === 0 ? (
          <p className="no-logs">No events logged yet. Set a street, house #, and start knocking.</p>
        ) : (
          <div className="log-list">
            {feedItems.slice(0, 30).map(e => (
              <div 
                className="log-item select-none" 
                key={e.id}
                onPointerDown={(ev) => handleTouchStart(ev, e)}
                onPointerUp={handleTouchEndOrMove}
                onPointerLeave={handleTouchEndOrMove}
                onPointerCancel={handleTouchEndOrMove}
              >
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
                      {e.previousKnocks?.length > 0 && (
                        <span style={{ color: '#6b7280', marginRight: '4px', fontSize: '0.85em' }}>
                          {e.previousKnocks[0].outcome_type.replace('_', ' ')} ➔ 
                        </span>
                      )}
                      {e.outcome_type.replace('_', ' ')}
                      {e.previousKnocks?.length > 0 && <span style={{fontSize: '10px', marginLeft: 4, opacity: 0.6}}>({e.previousKnocks.length + 1} visits)</span>}
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

      {editingEvent && (
        <div className="edit-modal-overlay">
          <div className="edit-modal-content">
            <div className="edit-modal-header">
              <h3>Edit Knock</h3>
              <button className="objection-cancel" onClick={() => { setEditingEvent(null); handleTouchEndOrMove(); }}>x</button>
            </div>
            
            <div className="edit-modal-body">
              <div className="edit-field">
                <label>House Number</label>
                <input 
                  type="text" 
                  className="auth-input edit-input" 
                  value={editHouseNum} 
                  onChange={e => setEditHouseNum(e.target.value)} 
                />
              </div>
              
              <div className="edit-field">
                <label>Outcome</label>
                <select 
                  className="auth-input edit-select" 
                  value={editOutcome} 
                  onChange={e => setEditOutcome(e.target.value)}
                >
                  <option value="NO_ANSWER">NO ANSWER</option>
                  <option value="CONVO">CONVO</option>
                  <option value="SALE">SALE</option>
                </select>
              </div>

              <div className="edit-field">
                <label>Notes</label>
                <textarea 
                  className="auth-input edit-textarea" 
                  placeholder="Additional context... e.g. Gate Code 1234" 
                  value={editNotes} 
                  onChange={e => setEditNotes(e.target.value)}
                />
              </div>
            </div>
            
            <div className="edit-modal-footer">
              <button className="delete-knock-btn" onClick={deleteEdit}>Delete Knock</button>
              <button className="save-knock-btn" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
