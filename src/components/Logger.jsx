import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { sqlocal, insertLocalEvent, updateLocalEvent, softDeleteLocalEvent } from '../lib/db';
import { syncEngine } from '../lib/syncEngine';
import { calculateCommission, getCommercialFollowUps } from '../lib/teamService';
import {
  MODES,
  RESIDENTIAL_OUTCOMES,
  RESIDENTIAL_CONVO_OPTIONS,
  COMMERCIAL_STATUS_COLORS,
  buildCommercialTargetKey,
  COMMERCIAL_SERVICES,
  COMMERCIAL_FREQUENCIES,
  COMMERCIAL_EST_VALUE_CHIPS,
} from '../config/modes';

// ── Residential constants (identical to v1) ─────────────────────────────────
const OUTCOMES = RESIDENTIAL_OUTCOMES;
const CONVO_OPTIONS = RESIDENTIAL_CONVO_OPTIONS;

// ── Commercial outcome button definitions ────────────────────────────────────
const COMMERCIAL_OUTCOMES = [
  { key: 'NO_ANSWER',          label: 'NO ANSWER',     color: COMMERCIAL_STATUS_COLORS.NO_ANSWER },
  { key: 'GATEKEEPER',         label: 'GATEKEEPER',    color: COMMERCIAL_STATUS_COLORS.GATEKEEPER },
  { key: 'DECISION_MAKER',     label: 'DECISION MAKER',color: COMMERCIAL_STATUS_COLORS.DECISION_MAKER },
  { key: 'WALKTHROUGH_BOOKED', label: 'WALKTHROUGH',   color: COMMERCIAL_STATUS_COLORS.WALKTHROUGH_BOOKED },
];

const COMMERCIAL_DM_OPTIONS = [
  'INTERESTED',
  'HAS VENDOR',
  'LANDLORD OR HEAD OFFICE',
  'NOT NOW',
  'NOT INTERESTED',
  'NO SOLICITING',
];


export default function Logger({ user, repName, onLogout, isActive, mode = MODES.RESIDENTIAL, onModeChange }) {
  const [dayState, setDayState] = useState('NOT_STARTED');
  const [session, setSession] = useState(null);
  const [street, setStreet] = useState('');
  const [streetInput, setStreetInput] = useState('');
  const [streetSuggestions, setStreetSuggestions] = useState([]);
  const [streetCoords, setStreetCoords] = useState(null);
  
  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

  const [houseNum, setHouseNum] = useState('');
  const [stepSize, setStepSize] = useState(2);

  // ── Commercial-specific target state ──
  const [businessName, setBusinessName] = useState('');
  const [suiteNum, setSuiteNum] = useState('');

  // ── Commercial panel state ──
  const [showDMOptions, setShowDMOptions] = useState(false);
  const [showWalkthroughForm, setShowWalkthroughForm] = useState(false);
  const [walkthroughContactName, setWalkthroughContactName] = useState('');
  const [walkthroughPhone, setWalkthroughPhone] = useState('');
  const [walkthroughDate, setWalkthroughDate] = useState('');
  const [walkthroughNotes, setWalkthroughNotes] = useState('');
  const [walkthroughServices, setWalkthroughServices] = useState([]);
  const [walkthroughFrequency, setWalkthroughFrequency] = useState('');
  const [walkthroughEstValue, setWalkthroughEstValue] = useState('');
  const [walkthroughVendor, setWalkthroughVendor] = useState('');
  const [walkthroughContractEnd, setWalkthroughContractEnd] = useState('');
  const [commercialFollowUps, setCommercialFollowUps] = useState([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);

  const [events, setEvents] = useState([]);
  const [activeBreak, setActiveBreak] = useState(null);
  
  const [showObjections, setShowObjections] = useState(false);
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackTime, setCallbackTime] = useState('');

  // Sale form state
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleHomeownerName, setSaleHomeownerName] = useState('');
  const [salePhone, setSalePhone] = useState('');
  const [saleEmail, setSaleEmail] = useState('');
  const [saleJobTotal, setSaleJobTotal] = useState('');
  const [salePayment, setSalePayment] = useState('');
  const [saleServiceDate, setSaleServiceDate] = useState('');
  const SALE_QUICK_TOTALS = ['$150', '$200', '$300', '$400', '$500', '$600'];
  const PAYMENT_METHODS = ['Cash', 'E-Transfer', 'Credit', 'Invoice'];

  const [logging, setLogging] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [flashOutcome, setFlashOutcome] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [repStats, setRepStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

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

    // Load personal stats for the pre-session dashboard
    async function loadRepStats() {
      if (!navigator.onLine) { setStatsLoading(false); return; }
      try {
        const { data: events } = await supabase
          .from('events')
          .select('payload, created_at')
          .eq('type', 'KNOCK')
          .eq('rep_id', user.id)
          .order('created_at', { ascending: false });

        if (!events) { setStatsLoading(false); return; }

        const todayStr = new Date().toISOString().split('T')[0];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yestStr = yesterday.toISOString().split('T')[0];
        const yestStart = yestStr + 'T00:00:00.000Z';
        const yestEnd   = todayStr + 'T00:00:00.000Z';

        const allSeenAddr = {};
        const yestSeenAddr = {};
        let allDoors = 0, allSales = 0, allCommission = 0;
        let yestDoors = 0, yestSales = 0;

        for (const row of events) {
          const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          const addr = `${p.house_number || ''} ${p.street_name || ''}`.trim().toLowerCase();
          if (!addr) continue;
          const isYest = row.created_at >= yestStart && row.created_at < yestEnd;

          // All-time unique doors
          if (!allSeenAddr[addr]) {
            allSeenAddr[addr] = p.outcome_type;
            allDoors++;
            if (p.outcome_type === 'SALE') {
              allSales++;
              const num = parseFloat(String(p.sale_details?.job_total || '0').replace(/[^0-9.]/g, ''));
              if (!isNaN(num) && num > 0) {
                allCommission += calculateCommission(num);
              }
            }
          }

          // Yesterday unique doors
          if (isYest && !yestSeenAddr[addr]) {
            yestSeenAddr[addr] = p.outcome_type;
            yestDoors++;
            if (p.outcome_type === 'SALE') yestSales++;
          }
        }

        setRepStats({
          allDoors, allSales, allCommission,
          allCloseRate: allDoors > 0 ? ((allSales / allDoors) * 100).toFixed(1) : '0.0',
          yestDoors, yestSales,
          yestCloseRate: yestDoors > 0 ? ((yestSales / yestDoors) * 100).toFixed(1) : '0.0',
        });
      } catch (e) {
        console.error('[Logger] loadRepStats error:', e);
      } finally {
        setStatsLoading(false);
      }
    }

    async function loadFollowUps() {
      if (mode === MODES.COMMERCIAL) {
        setLoadingFollowUps(true);
        try {
          const list = await getCommercialFollowUps();
          setCommercialFollowUps(list || []);
        } catch (e) {
          console.error('[Logger] loadFollowUps error:', e);
        } finally {
          setLoadingFollowUps(false);
        }
      }
    }

    loadRepStats();
    loadFollowUps();

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

        const reversedEvts = evts.reverse();
        setEvents(reversedEvts);

        // Restore active street / plaza so reps don't lose their target on refresh
        if (dState === 'ACTIVE' && typeof window !== 'undefined') {
          const saved = localStorage.getItem('knocklog_active_street');
          if (saved) {
            setStreet(saved);
            setStreetInput(saved);
          } else if (reversedEvts.length > 0 && reversedEvts[0].street_name) {
            setStreet(reversedEvts[0].street_name);
            setStreetInput(reversedEvts[0].street_name);
          }
        }
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

    const handleSyncLocalEvents = () => {
      loadRepStats();
      bootstrapLocal();
    };
    window.addEventListener('sync-local-events', handleSyncLocalEvents);

    return () => { 
      unsub(); 
      syncEngine.stop();
      window.removeEventListener('sync-local-events', handleSyncLocalEvents);
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
      start_time: new Date().toISOString(),
      mode,  // include mode in DAY_START payload
    };
    
    await insertLocalEvent(crypto.randomUUID(), 'DAY_START', payload);
    
    // Propagate mode to parent (MainLayout) so map/team/history stay in sync
    if (onModeChange) onModeChange(mode);

    setSession(payload);
    setEvents([]);
    setStreet('');
    setStreetInput('');
    setStreetCoords(null);
    setHouseNum('');
    setBusinessName('');
    setSuiteNum('');
    setDayState('ACTIVE');
  }

  async function startDayWithFollowUp(lead) {
    setError('');
    const sessionId = crypto.randomUUID();
    const today = new Date().toISOString().split('T')[0];
    const payload = {
      session_id: sessionId,
      session_date: today,
      start_time: new Date().toISOString(),
      mode: MODES.COMMERCIAL,
    };

    await insertLocalEvent(crypto.randomUUID(), 'DAY_START', payload);

    if (onModeChange) onModeChange(MODES.COMMERCIAL);

    setSession(payload);
    setEvents([]);
    setStreet(lead.address || '');
    setStreetInput(lead.address || '');
    setStreetCoords(lead.lat && lead.lng ? { lat: lead.lat, lng: lead.lng } : null);
    setHouseNum('');
    setBusinessName(lead.business_name || '');
    setSuiteNum(lead.suite || '');
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

  const searchSessionTokenRef = useRef('kl-' + Math.random().toString(36).substring(2, 9));

  const handleStreetInputChange = async (e) => {
    const val = e.target.value;
    setStreetInput(val);
    
    if (val.trim().length > 1) {
      try {
        const prox = geoRef.current.lat
          ? `${geoRef.current.lng},${geoRef.current.lat}`
          : '-79.3832,43.6532';
        
        let results = [];

        // 1. In Commercial mode, use Mapbox SearchBox API (specialized for businesses, plazas, POIs)
        if (mode === MODES.COMMERCIAL && MAPBOX_TOKEN) {
          try {
            const sbUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(val)}&access_token=${MAPBOX_TOKEN}&session_token=${searchSessionTokenRef.current}&language=en&country=ca&proximity=${prox}&limit=6`;
            const sbRes = await fetch(sbUrl);
            if (sbRes.ok) {
              const sbData = await sbRes.json();
              results = (sbData.suggestions || []).map(s => ({
                id: s.mapbox_id || s.name,
                mapbox_id: s.mapbox_id,
                name: s.name,
                text: s.name,
                place_name: s.full_address || s.place_formatted || s.name,
                address: s.full_address || s.place_formatted || s.name,
                feature_type: s.feature_type || 'poi',
                is_poi: s.feature_type === 'poi' || !!s.poi_category || s.place_formatted?.includes('Brand') || false,
              }));
            }
          } catch (e) {
            // fallback
          }
        }

        // 2. If results empty or in residential mode, fallback to Geocoding v5
        if (results.length === 0 && MAPBOX_TOKEN) {
          const types = mode === MODES.COMMERCIAL ? 'poi,poi.landmark,address,neighborhood' : 'address,street';
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5&country=ca&types=${types}&proximity=${prox}`);
          if (res.ok) {
            const data = await res.json();
            results = (data.features || []).map(f => ({
              id: f.id,
              name: f.text,
              text: f.text,
              place_name: f.place_name,
              address: f.place_name,
              center: f.center,
              lat: f.center?.[1],
              lng: f.center?.[0],
              is_poi: f.place_type?.includes('poi') || false,
            }));
          }
        }

        // 3. In commercial mode, append a "Use with GPS" fallback option
        if (mode === MODES.COMMERCIAL && val.trim().length > 1) {
          results.push({
            id: '__gps_fallback__',
            name: val.trim(),
            text: val.trim(),
            place_name: geoRef.current.lat ? 'Use this name with current GPS location' : 'Use this custom name',
            center: [geoRef.current.lng || -79.3832, geoRef.current.lat || 43.6532],
            lat: geoRef.current.lat,
            lng: geoRef.current.lng,
            _isGpsFallback: true,
          });
        }
        setStreetSuggestions(results);
      } catch (err) {
        setStreetSuggestions([]);
      }
    } else {
      setStreetSuggestions([]);
    }
  };

  const selectStreetSuggestion = async (feature) => {
    if (mode === MODES.COMMERCIAL && (feature.is_poi || feature.place_type?.includes('poi') || feature._isGpsFallback)) {
      const poiName = feature.name || feature.text || '';
      setBusinessName(poiName);
      if (feature._isGpsFallback) {
        setStreetInput(poiName);
        if (geoRef.current.lat) {
          setStreetCoords({ lng: geoRef.current.lng, lat: geoRef.current.lat });
        }
      } else {
        const fullAddr = feature.address || feature.place_name || poiName;
        setStreetInput(fullAddr);

        if (feature.lat && feature.lng) {
          setStreetCoords({ lng: feature.lng, lat: feature.lat });
        } else if (feature.center) {
          setStreetCoords({ lng: feature.center[0], lat: feature.center[1] });
        } else if (feature.mapbox_id && MAPBOX_TOKEN) {
          try {
            const rUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(feature.mapbox_id)}?access_token=${MAPBOX_TOKEN}&session_token=${searchSessionTokenRef.current}`;
            const rRes = await fetch(rUrl);
            if (rRes.ok) {
              const rData = await rRes.json();
              const f = rData.features?.[0];
              if (f?.geometry?.coordinates) {
                setStreetCoords({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
              }
            }
          } catch {}
        }
      }
    } else {
      const name = feature.name || feature.text || feature.place_name?.split(',')[0] || ''; 
      setStreetInput(name);
      if (feature.center) {
        setStreetCoords({ lng: feature.center[0], lat: feature.center[1] });
      }
    }
    setStreetSuggestions([]);
  };

  function commitStreet() {
    const s = streetInput.trim();
    if (!s) return;
    setStreet(s);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('knocklog_active_street', s); } catch (e) {}
    }
    setStreetSuggestions([]);
  }

  // ── Shared knock logger (works for both modes) ───────────────────────────
  async function logKnock(outcomeType, convoOpt = null, cbTime = null, extraDetails = null) {
    if (dayState !== 'ACTIVE') return;
    const isCommercial = mode === MODES.COMMERCIAL;

    if (!street) {
      setError(isCommercial ? 'Set plaza / building address first' : 'Set street & house number first');
      return;
    }
    if (!isCommercial && !houseNum) {
      setError('Set house number first');
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

    let payload;
    if (isCommercial) {
      const targetKey = buildCommercialTargetKey(businessName, houseNum, street, suiteNum);
      payload = {
        event_id: eventId,
        session_id: session.session_id,
        mode: MODES.COMMERCIAL,
        target_type: 'BUSINESS',
        target_key: targetKey,
        business_name: businessName.trim() || null,
        suite: suiteNum.trim() || null,
        // street_name and house_number are required by the DB trigger (NOT NULL)
        street_name: street,
        house_number: houseNum || null,
        timestamp: new Date().toISOString(),
        outcome_type: outcomeType,
        convo_status: cStatus,
        objection_type: oType,
        callback_time: cbFinal,
        lat: geoRef.current.lat || streetCoords?.lat,
        lng: geoRef.current.lng || streetCoords?.lng,
        ...(extraDetails ? extraDetails : {}),
      };
    } else {
      payload = {
        event_id: eventId,
        session_id: session.session_id,
        mode: MODES.RESIDENTIAL,
        street_name: street,
        house_number: houseNum,
        timestamp: new Date().toISOString(),
        outcome_type: outcomeType,
        convo_status: cStatus,
        objection_type: oType,
        callback_time: cbFinal,
        lat: geoRef.current.lat || streetCoords?.lat,
        lng: geoRef.current.lng || streetCoords?.lng,
        ...(extraDetails?.sale_details ? { sale_details: extraDetails.sale_details } : {}),
      };
    }

    // LOCAL WRITE GUARANTEE (Appends instantly regardless of network)
    await insertLocalEvent(eventId, 'KNOCK', payload);

    // BACKGROUND ROOFTOP GEOCODING
    if (navigator.onLine) {
      setTimeout(async () => {
        try {
          const query = `${houseNum || ''} ${street}`;
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1&country=ca&proximity=-79.3832,43.6532&bbox=-80.8,42.9,-78.5,44.4`);
          const data = await res.json();
          if (data.features?.length > 0) {
            const updatedPayload = {
              ...payload,
              lat: data.features[0].center[1],
              lng: data.features[0].center[0]
            };
            await sqlocal.sql`UPDATE events SET payload = ${JSON.stringify(updatedPayload)} WHERE event_id = ${eventId}`;
          }
        } catch (e) {
          // Fail silently; GPS / street center fallback remains in local DB
        }
      }, 0);
    }

    // Auto-increment house number (residential only)
    if (!isCommercial) {
      const numPart = houseNum.match(/\d+/);
      if (numPart) {
        const num = parseInt(numPart[0], 10);
        const nextNum = num + stepSize;
        setHouseNum(houseNum.replace(numPart[0], nextNum.toString()));
      }
    }

    setFlashOutcome(outcomeType);
    setTimeout(() => setFlashOutcome(null), 600);

    // Reset panels
    setShowObjections(false);
    setShowCallbackPicker(false);
    setCallbackTime('');
    setShowSaleForm(false);
    setSaleHomeownerName('');
    setSalePhone('');
    setSaleEmail('');
    setSaleJobTotal('');
    setSalePayment('');
    setSaleServiceDate('');
    resetCommercialPanels();
    setLogging(false);

    // Prepend to events feed
    setEvents(prev => [{ id: eventId, type: 'KNOCK', ...payload }, ...prev]);
  }

  function resetCommercialPanels() {
    setShowDMOptions(false);
    setShowWalkthroughForm(false);
    setWalkthroughContactName('');
    setWalkthroughPhone('');
    setWalkthroughDate('');
    setWalkthroughNotes('');
    setWalkthroughServices([]);
    setWalkthroughFrequency('');
    setWalkthroughEstValue('');
    setWalkthroughVendor('');
    setWalkthroughContractEnd('');
    // Clear business name and suite so rep is immediately ready for next target
    setBusinessName('');
    setSuiteNum('');
  }

  function handleOutcome(outcomeType) {
    if (mode === MODES.COMMERCIAL) {
      if (outcomeType === 'DECISION_MAKER') {
        setShowDMOptions(true);
      } else if (outcomeType === 'WALKTHROUGH_BOOKED') {
        setShowWalkthroughForm(true);
      } else {
        logKnock(outcomeType);
      }
    } else {
      // Residential (unchanged)
      if (outcomeType === 'CONVO') {
        setShowObjections(true);
      } else if (outcomeType === 'SALE') {
        setShowSaleForm(true);
      } else {
        logKnock(outcomeType);
      }
    }
  }

  function handleCommercialDMOption(opt) {
    if (opt === 'NOT NOW') {
      // Reuse callback picker for follow-up date
      setShowCallbackPicker(true);
      setShowDMOptions(false);
    } else {
      logKnock('DECISION_MAKER', null, null, { objection_type: opt });
    }
  }

  async function submitWalkthroughForm() {
    if (!walkthroughContactName.trim() || !walkthroughPhone.trim()) return;
    const targetCompanyName = businessName.trim() || street || 'Commercial Account';
    const currentSuite = suiteNum.trim();
    const currentStreet = street;

    const leadDetails = {
      contact_name: walkthroughContactName.trim(),
      phone: walkthroughPhone.trim(),
      walkthrough_at: walkthroughDate || null,
      notes: walkthroughNotes.trim() || null,
      services: walkthroughServices.length > 0 ? walkthroughServices : null,
      frequency: walkthroughFrequency || null,
      est_monthly_value: walkthroughEstValue ? parseFloat(walkthroughEstValue) : null,
      current_vendor: walkthroughVendor.trim() || null,
      contract_end: walkthroughContractEnd.trim() || null,
    };
    logKnock('WALKTHROUGH_BOOKED', null, null, { lead_details: leadDetails });

    // ── Auto-create D2D lead in SOB Admin leads table ──────────────────────
    try {
      const noteParts = [
        currentStreet ? `Plaza/Address: ${currentStreet}` : null,
        currentSuite ? `Suite: ${currentSuite}` : null,
        walkthroughServices.length > 0 ? `Services: ${walkthroughServices.join(', ')}` : null,
        walkthroughFrequency ? `Frequency: ${walkthroughFrequency}` : null,
        walkthroughVendor.trim() ? `Current Vendor: ${walkthroughVendor.trim()}` : null,
        walkthroughContractEnd.trim() ? `Contract End: ${walkthroughContractEnd.trim()}` : null,
        repName ? `Rep: ${repName}` : null,
        walkthroughNotes.trim() ? `Notes: ${walkthroughNotes.trim()}` : null,
      ].filter(Boolean).join(' | ');

      await supabase.from('leads').insert({
        source: 'd2d',
        company_name: targetCompanyName,
        customer_name: walkthroughContactName.trim(),
        customer_phone: walkthroughPhone.trim(),
        service_type: 'commercial_cleaning',
        preferred_date: walkthroughDate || null,
        quoted_price: walkthroughEstValue ? parseFloat(walkthroughEstValue) : null,
        notes: noteParts || null,
        status: 'new',
      });
    } catch (e) {
      console.warn('[Lead creation] Failed to auto-create D2D lead:', e);
    }
  }

  function submitSaleForm() {
    if (!saleHomeownerName.trim() || !salePhone.trim()) return;
    const saleDetails = {
      homeowner_name: saleHomeownerName.trim(),
      phone: salePhone.trim(),
      email: saleEmail.trim() || null,
      job_total: saleJobTotal || null,
      payment_method: salePayment || null,
      service_date: saleServiceDate || null,
      job_status: 'PREBOOKED',
    };
    logKnock('SALE', null, null, { sale_details: saleDetails });
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
      const isComm = e.mode === MODES.COMMERCIAL;
      const key = isComm
        ? (e.target_key || `${e.business_name || ''}_${e.suite || ''}_${e.street_name || ''}`.trim().toLowerCase() || `${e.house_number || ''} ${e.street_name || ''}`.trim())
        : `${e.house_number || ''} ${e.street_name || ''}`.trim();
      if (key) {
        propertyOutcomes[key] = {
          outcome: e.outcome_type,
          objection: e.objection_type,
          business_name: e.business_name,
          suite: e.suite,
          mode: e.mode,
        };
      }
    }
  });

  const doorList = Object.values(propertyOutcomes);
  const totalDoors = doorList.length;
  // In commercial mode: WALKTHROUGH_BOOKED is the primary win metric; in residential: SALE
  const totalSales = doorList.filter(o => o.outcome === 'SALE' || o.outcome === 'WALKTHROUGH_BOOKED').length;
  // Qualified = Talked to decision maker
  const totalConvos = doorList.filter(o => 
    (o.outcome === 'CONVO' && o.objection !== 'NOT DECISION MAKER') ||
    o.outcome === 'DECISION_MAKER' ||
    o.outcome === 'WALKTHROUGH_BOOKED'
  ).length;
  
  const qualifiedDoors = totalSales + totalConvos;
  const conversionRate = qualifiedDoors > 0 ? ((totalSales / qualifiedDoors) * 100).toFixed(1) : '0.0';

  const isReknock = mode === MODES.COMMERCIAL
    ? (street && businessName.trim() && events.some(e => 
        e.type === 'KNOCK' && 
        e.street_name === street && 
        e.business_name && 
        e.business_name.toLowerCase() === businessName.trim().toLowerCase()
      ))
    : (street && houseNum && events.some(e => 
        e.type === 'KNOCK' && 
        e.street_name === street && 
        e.house_number === houseNum
      ));

  const feedItems = [];
  const feedAddressMap = new Map();
  events.forEach(e => {
    if (e.type === 'BREAK') {
      feedItems.push(e);
    } else if (e.type === 'KNOCK') {
      const isComm = e.mode === MODES.COMMERCIAL;
      const addr = isComm
        ? (e.target_key || `${e.business_name || ''}_${e.suite || ''}_${e.street_name || ''}`.trim().toLowerCase() || `${e.house_number || ''} ${e.street_name || ''}`.trim())
        : `${e.house_number || ''} ${e.street_name || ''}`.trim();
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
            <img src="/knocklog-logo.png" alt="KnockLog" className="app-logo" />
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

        <div className="pre-session-screen">
          {/* Rep greeting */}
          <div className="pre-session-greeting">
            <span className="pre-session-name">{repName}</span>
            <span className="pre-session-ready">Ready to knock?</span>
          </div>

          {/* Mode picker — appears on pre-session only */}
          <div className="mode-picker">
            <button
              className={`mode-pick-btn ${mode === MODES.RESIDENTIAL ? 'active' : ''}`}
              onClick={() => onModeChange && onModeChange(MODES.RESIDENTIAL)}
            >
              Residential
            </button>
            <button
              className={`mode-pick-btn ${mode === MODES.COMMERCIAL ? 'active' : ''}`}
              onClick={() => onModeChange && onModeChange(MODES.COMMERCIAL)}
            >
              Commercial
            </button>
          </div>

          {/* Yesterday card — mirrors closed session stat-card style */}
          <div className="closed-summary pre-session-animated">
            <div className="pre-session-section-title">Yesterday</div>
            {statsLoading ? (
              <div className="stats-grid">
                {[0,1].map(i => <div key={i} className="pre-stat-skel" style={{ height: 90 }} />)}
              </div>
            ) : (
              <>
                <div className="stats-grid">
                  <div className="stat-card pre-card-delay-1">
                    <span className="stat-card-label">Doors</span>
                    <span className="stat-card-value">{repStats?.yestDoors ?? '—'}</span>
                    <span className="stat-card-sub">{repStats?.yestSales ?? 0} sales</span>
                  </div>
                  <div className="stat-card pre-card-delay-2">
                    <span className="stat-card-label">Close Rate</span>
                    <span className="stat-card-value" style={{ color: 'var(--success)' }}>{repStats?.yestCloseRate ?? '—'}%</span>
                    <span className="stat-card-sub">{repStats?.yestSales ?? 0} of {repStats?.yestDoors ?? 0} doors</span>
                  </div>
                </div>
              </>
            )}

            {/* Commercial Follow-Up Radar */}
            {mode === MODES.COMMERCIAL && commercialFollowUps.length > 0 && (
              <div className="closed-summary pre-session-animated" style={{ marginTop: 12 }}>
                <div className="pre-session-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Follow-Up Radar</span>
                  <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>{commercialFollowUps.length} DUE</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {commercialFollowUps.map(lead => (
                    <div
                      key={lead.id}
                      onClick={() => startDayWithFollowUp(lead)}
                      style={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                          {lead.business_name || 'Business'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {lead.suite ? `Unit ${lead.suite}, ` : ''}{lead.address}
                        </div>
                        {lead.contacts?.[0]?.name && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Contact: {lead.contacts[0].name} {lead.contacts[0].phone ? `• ${lead.contacts[0].phone}` : ''}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>
                          {lead.next_follow_up_at
                            ? new Date(lead.next_follow_up_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            : 'Due'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>
                          Tap to Knock →
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All-Time efficiency row */}
            <div className="efficiency-section pre-card-delay-3">
              <h3 className="efficiency-title">All-Time</h3>
              <div className="efficiency-row">
                <div className="efficiency-metric">
                  <span className="efficiency-val">{statsLoading ? '—' : (repStats?.allDoors ?? '—')}</span>
                  <span className="efficiency-lab">Total Doors</span>
                </div>
                <div className="efficiency-metric" style={{ textAlign: 'right' }}>
                  <span className="efficiency-val" style={{ color: 'var(--success)' }}>{statsLoading ? '—' : (repStats?.allSales ?? '—')}</span>
                  <span className="efficiency-lab">Total Sales</span>
                </div>
              </div>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.04)' }} />
              <div className="efficiency-row">
                <div className="efficiency-metric">
                  <span className="efficiency-val" style={{ color: '#f59e0b' }}>{statsLoading ? '—' : `${repStats?.allCloseRate ?? '—'}%`}</span>
                  <span className="efficiency-lab">All-Time Close %</span>
                </div>
                <div className="efficiency-metric" style={{ textAlign: 'right' }}>
                  <span className="efficiency-val" style={{ color: '#a78bfa' }}>{statsLoading ? '—' : `$${repStats?.allCommission ? repStats.allCommission.toFixed(0) : '—'}`}</span>
                  <span className="efficiency-lab">Total Commission</span>
                </div>
              </div>
            </div>
          </div>

          <button className="start-day-btn pre-card-delay-4" onClick={startDay}>
            START SESSION
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
            <img src="/knocklog-logo.png" alt="KnockLog" className="app-logo" />
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
            <img src="/knocklog-logo.png" alt="KnockLog" className="app-logo" />
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
          <img src="/knocklog-logo.png" alt="KnockLog" className="app-logo" />
          <span className="rep-badge" onClick={() => setShowProfile(!showProfile)}>
            {repName}
          </span>
          {mode === MODES.COMMERCIAL && (
            <span className="mode-badge-commercial">COMMERCIAL</span>
          )}
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
              <button
                className="end-street-btn"
                onClick={() => {
                  setStreet('');
                  setStreetInput('');
                  setStreetCoords(null);
                  setBusinessName('');
                  setSuiteNum('');
                  if (typeof window !== 'undefined') {
                    try { localStorage.removeItem('knocklog_active_street'); } catch (e) {}
                  }
                }}
              >
                {mode === MODES.COMMERCIAL ? 'END BLOCK' : 'END STREET'}
              </button>
            </div>

            {mode === MODES.COMMERCIAL ? (
              /* ── Commercial target fields ── */
              <div className="comm-target-fields">
                <div className="comm-field-row">
                  <input
                    type="text"
                    className="house-input"
                    placeholder="Unit / Suite #"
                    value={suiteNum}
                    onChange={e => setSuiteNum(e.target.value)}
                  />
                  <input
                    type="text"
                    className="house-input"
                    placeholder="Street # (optional)"
                    value={houseNum}
                    onChange={e => setHouseNum(e.target.value)}
                    style={{ maxWidth: 110 }}
                  />
                </div>
                <input
                  type="text"
                  className="sale-form-input"
                  placeholder="Business / Tenant Name (optional)"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  style={{ marginTop: 6 }}
                />
              </div>
            ) : (
              /* ── Residential house cursor bar (unchanged) ── */
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
            )}
          </>
        ) : (
          <div className="street-bar" style={{ position: 'relative' }}>
            <input
              type="text"
              className="street-input"
              placeholder={mode === MODES.COMMERCIAL ? 'Search plaza, business, or street...' : 'Enter street name...'}
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
                      fontSize: '13px', cursor: 'pointer', color: 'var(--text-primary)',
                      ...(f._isGpsFallback ? { borderTop: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.08)' } : {})
                    }}
                  >
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {f._isGpsFallback && <span style={{ fontSize: 14 }}>📍</span>}
                      {(f.is_poi || f.place_type?.includes('poi') || f.feature_type === 'poi') && !f._isGpsFallback && <span style={{ fontSize: 14 }}>🏢</span>}
                      {f.name || f.text}
                    </div>
                    <div style={{ fontSize: '11px', color: f._isGpsFallback ? '#3b82f6' : 'var(--text-muted)', marginTop: '2px' }}>
                      {f._isGpsFallback ? 'Use this name with your current GPS location' : (f.address || f.place_name)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hero metric — mode-aware */}
      <div className="hero-metric">
        <span className="hero-count">{totalDoors}</span>
        <span className="hero-label">{mode === MODES.COMMERCIAL ? 'TOTAL TARGETS' : 'TOTAL DOORS'}</span>
      </div>

      {/* Metrics strip — mode-aware */}
      {mode === MODES.COMMERCIAL ? (
        <div className="metrics-strip sub-metrics">
          <div className="metric-item">
            <span className="metric-count" style={{ color: '#10b981' }}>{totalSales}</span>
            <span className="metric-label">WALKTHROUGH</span>
          </div>
          <div className="metric-item">
            <span className="metric-count" style={{ color: '#3b82f6' }}>{totalConvos}</span>
            <span className="metric-label">DM REACHED</span>
          </div>
          <div className="metric-item">
            <span className="metric-count" style={{ color: '#f59e0b' }}>{conversionRate}%</span>
            <span className="metric-label">REACH %</span>
          </div>
        </div>
      ) : (
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
      )}

      {/* ── Shared: callback picker (used by both residential CALLBACK and commercial NOT NOW) ── */}
      {showCallbackPicker ? (
        <div className="objection-panel">
          <div className="objection-header">
            <span>{mode === MODES.COMMERCIAL ? 'Follow-up Date' : 'Callback Time (Optional)'}</span>
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
              onClick={() => mode === MODES.COMMERCIAL
                ? logKnock('DECISION_MAKER', null, callbackTime, { objection_type: 'NOT NOW' })
                : logKnock('CONVO', 'CALLBACK', callbackTime)
              }
            >
              {mode === MODES.COMMERCIAL ? 'LOG NOT NOW' : 'LOG CALLBACK'}
            </button>
          </div>
        </div>

      ) : mode === MODES.COMMERCIAL && showWalkthroughForm ? (
        /* ── Commercial: walkthrough booking form ── */
        <div className="sale-form-panel">
          <div className="objection-header">
            <span>Walkthrough Details</span>
            <button className="objection-cancel" onClick={() => setShowWalkthroughForm(false)}>x</button>
          </div>

          <div className="sale-form-section-label">Contact</div>
          <input
            className="sale-form-input"
            type="text"
            placeholder="Contact Name *"
            value={walkthroughContactName}
            onChange={e => setWalkthroughContactName(e.target.value)}
          />
          <input
            className="sale-form-input"
            type="tel"
            placeholder="Phone Number *"
            value={walkthroughPhone}
            onChange={e => setWalkthroughPhone(e.target.value)}
          />

          <div className="sale-form-section-label">Walkthrough Date / Time</div>
          <input
            className="sale-form-input"
            type="datetime-local"
            value={walkthroughDate}
            onChange={e => setWalkthroughDate(e.target.value)}
          />

          <div className="sale-form-section-label">Services of Interest</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {COMMERCIAL_SERVICES.map(srv => {
              const active = walkthroughServices.includes(srv.key);
              return (
                <button
                  key={srv.key}
                  type="button"
                  className={`sale-quick-btn ${active ? 'active' : ''}`}
                  style={{ fontSize: 11, padding: '6px 10px', height: 'auto' }}
                  onClick={() => {
                    setWalkthroughServices(prev =>
                      prev.includes(srv.key) ? prev.filter(k => k !== srv.key) : [...prev, srv.key]
                    );
                  }}
                >
                  {srv.label}
                </button>
              );
            })}
          </div>

          <div className="sale-form-section-label">Cleaning Frequency</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {COMMERCIAL_FREQUENCIES.map(freq => (
              <button
                key={freq.key}
                type="button"
                className={`sale-quick-btn ${walkthroughFrequency === freq.key ? 'active' : ''}`}
                style={{ fontSize: 11, padding: '6px 10px', height: 'auto' }}
                onClick={() => setWalkthroughFrequency(walkthroughFrequency === freq.key ? '' : freq.key)}
              >
                {freq.label}
              </button>
            ))}
          </div>

          <div className="sale-form-section-label">Est. Monthly Value ($/mo)</div>
          <div className="sale-quick-totals" style={{ marginBottom: 8 }}>
            {COMMERCIAL_EST_VALUE_CHIPS.map(val => (
              <button
                key={val}
                type="button"
                className={`sale-quick-btn ${walkthroughEstValue === String(val) ? 'active' : ''}`}
                onClick={() => setWalkthroughEstValue(walkthroughEstValue === String(val) ? '' : String(val))}
              >
                ${val.toLocaleString()}
              </button>
            ))}
          </div>
          <input
            className="sale-form-input"
            type="text"
            inputMode="decimal"
            placeholder="Custom monthly value (e.g. 1750)"
            value={walkthroughEstValue}
            onChange={e => setWalkthroughEstValue(e.target.value)}
          />

          <div className="sale-form-section-label">Current Vendor / Contract (optional)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              className="sale-form-input"
              type="text"
              placeholder="Vendor name"
              value={walkthroughVendor}
              onChange={e => setWalkthroughVendor(e.target.value)}
            />
            <input
              className="sale-form-input"
              type="text"
              placeholder="Contract end (e.g. 2026-11)"
              value={walkthroughContractEnd}
              onChange={e => setWalkthroughContractEnd(e.target.value)}
            />
          </div>

          <div className="sale-form-section-label">Notes (optional)</div>
          <input
            className="sale-form-input"
            type="text"
            placeholder="e.g. Ask for Maria, back entrance"
            value={walkthroughNotes}
            onChange={e => setWalkthroughNotes(e.target.value)}
          />

          <button
            className="sale-form-submit"
            disabled={logging || !walkthroughContactName.trim() || !walkthroughPhone.trim()}
            onClick={submitWalkthroughForm}
          >
            {logging ? 'LOGGING...' : 'LOG WALKTHROUGH'}
          </button>
        </div>

      ) : mode === MODES.COMMERCIAL && showDMOptions ? (
        /* ── Commercial: decision-maker sub-result picker ── */
        <div className="objection-panel">
          <div className="objection-header">
            <span>DM Result</span>
            <button className="objection-cancel" onClick={() => setShowDMOptions(false)}>x</button>
          </div>
          <div className="objection-grid">
            {COMMERCIAL_DM_OPTIONS.map(opt => (
              <button
                key={opt}
                className="objection-btn"
                disabled={logging}
                onClick={() => handleCommercialDMOption(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

      ) : showSaleForm ? (
        /* ── Residential: sale form (unchanged) ── */
        <div className="sale-form-panel">
          <div className="objection-header">
            <span>Sale Details</span>
            <button className="objection-cancel" onClick={() => setShowSaleForm(false)}>x</button>
          </div>

          <div className="sale-form-section-label">Homeowner</div>
          <input
            className="sale-form-input"
            type="text"
            placeholder="Full Name *"
            value={saleHomeownerName}
            onChange={e => setSaleHomeownerName(e.target.value)}
          />
          <input
            className="sale-form-input"
            type="tel"
            placeholder="Phone Number *"
            value={salePhone}
            onChange={e => setSalePhone(e.target.value)}
          />
          <input
            className="sale-form-input"
            type="email"
            placeholder="Email (optional)"
            value={saleEmail}
            onChange={e => setSaleEmail(e.target.value)}
          />

          <div className="sale-form-section-label">Job Total</div>
          <div className="sale-quick-totals">
            {SALE_QUICK_TOTALS.map(t => (
              <button
                key={t}
                className={`sale-quick-btn ${saleJobTotal === t ? 'active' : ''}`}
                onClick={() => setSaleJobTotal(saleJobTotal === t ? '' : t)}
              >{t}</button>
            ))}
          </div>
          <input
            className="sale-form-input"
            type="text"
            placeholder="Custom amount (e.g. $275)"
            value={SALE_QUICK_TOTALS.includes(saleJobTotal) ? '' : saleJobTotal}
            onChange={e => setSaleJobTotal(e.target.value)}
          />

          <div className="sale-form-section-label">Payment Method</div>
          <div className="sale-quick-totals">
            {PAYMENT_METHODS.map(m => (
              <button
                key={m}
                className={`sale-quick-btn ${salePayment === m ? 'active' : ''}`}
                onClick={() => setSalePayment(salePayment === m ? '' : m)}
              >{m}</button>
            ))}
          </div>

          <div className="sale-form-section-label">Service Date</div>
          <div className="sale-quick-totals">
            {[
              { label: 'Today', days: 0 },
              { label: 'Tomorrow', days: 1 },
              { label: '+2 Days', days: 2 },
              { label: '+3 Days', days: 3 },
              { label: '+1 Week', days: 7 },
            ].map(({ label, days }) => {
              const d = new Date();
              d.setDate(d.getDate() + days);
              const iso = d.toISOString().split('T')[0];
              return (
                <button
                  key={label}
                  className={`sale-quick-btn ${saleServiceDate === iso ? 'active' : ''}`}
                  onClick={() => setSaleServiceDate(saleServiceDate === iso ? '' : iso)}
                >{label}</button>
              );
            })}
          </div>
          <input
            className="sale-form-input"
            type="date"
            value={saleServiceDate}
            onChange={e => setSaleServiceDate(e.target.value)}
            placeholder="Or pick a specific date"
          />

          <button
            className="sale-form-submit"
            disabled={logging || !saleHomeownerName.trim() || !salePhone.trim()}
            onClick={submitSaleForm}
          >
            {logging ? 'LOGGING...' : 'LOG SALE'}
          </button>
        </div>

      ) : showObjections ? (
        /* ── Residential: CONVO objection picker (unchanged) ── */
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

      ) : mode === MODES.COMMERCIAL ? (
        /* ── Commercial: 4-button outcome grid ── */
        <div className="outcome-grid outcome-grid-4">
          {COMMERCIAL_OUTCOMES.map(o => (
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

      ) : (
        /* ── Residential: 3-button outcome grid (unchanged) ── */
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
                      color: e.mode === MODES.COMMERCIAL
                        ? (COMMERCIAL_STATUS_COLORS[e.outcome_type] || '#fff')
                        : (OUTCOMES.find(o => o.key === e.outcome_type)?.color || '#fff')
                    }}>
                      {e.previousKnocks?.length > 0 && (
                        <span style={{ color: '#6b7280', marginRight: '4px', fontSize: '0.85em' }}>
                          {e.previousKnocks[0].outcome_type.replace(/_/g, ' ')} ➔ 
                        </span>
                      )}
                      {e.outcome_type.replace(/_/g, ' ')}
                      {e.previousKnocks?.length > 0 && <span style={{fontSize: '10px', marginLeft: 4, opacity: 0.6}}>({e.previousKnocks.length + 1} visits)</span>}
                    </div>
                    {(e.objection_type || e.convo_status) && (
                      <div className="log-objection">
                        {e.convo_status === 'CALLBACK' && e.callback_time ?
                          `CB: ${new Date(e.callback_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` :
                          (e.objection_type || e.convo_status)}
                      </div>
                    )}
                    <div className="log-street">
                      {e.mode === MODES.COMMERCIAL
                        ? `${e.suite ? `UNIT ${e.suite} ` : ''}${e.business_name ? `${e.business_name} · ` : ''}${e.house_number ? `${e.house_number} ` : ''}${e.street_name || ''}`
                        : `${e.house_number ? `${e.house_number} ` : ''}${e.street_name || ''}`
                      }
                    </div>
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
