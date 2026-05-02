import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  getTeamStats,
  getTeamCoverageGeoJSON,
  getTeamActivity,
  getAllSales,
} from '../../lib/teamService';
import { sqlocal } from '../../lib/db';
import './teamStyles.css';
import '../mapStyles.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_STYLE = 'mapbox://styles/xmalikjc/cmnwoppdm00ck01s76r6ccva7';

const STATUS_COLORS = {
  NO_ANSWER:      '#6b7280',
  CONVO:          '#3b82f6',
  SALE:           '#10b981',
  NOT_INTERESTED: '#ef4444',
  CALLBACK:       '#a855f7',
  THINKING:       '#60a5fa',
  NO_SOLICITING:  '#dc2626',
  CONSTRUCTION:   '#f59e0b',
};

const AVATAR_COLORS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#ef4444,#dc2626)',
  'linear-gradient(135deg,#3b82f6,#2563eb)',
  'linear-gradient(135deg,#ec4899,#db2777)',
];

// ── Close-Rate Ring Component ──
function CloseRing({ pct, size = 44 }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const stroke = (parseFloat(pct) / 100) * circ;
  const color = parseFloat(pct) >= 10 ? '#10b981' : parseFloat(pct) >= 5 ? '#f59e0b' : '#6b7280';

  return (
    <div className="lb-close-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth={3}
          strokeDasharray={`${stroke} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="lb-close-pct">{pct}%</div>
    </div>
  );
}

export default function TeamTab({ user, repName, isActive }) {
  const [segment, setSegment] = useState('LEADERBOARD'); // 'LEADERBOARD' | 'MAP' | 'ACTIVITY'
  const [stats, setStats] = useState([]);
  const [activityData, setActivityData] = useState({ feed: [], radar: [] });
  const [allSales, setAllSales] = useState([]);
  const [coverageCount, setCoverageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [boardDate, setBoardDate] = useState('TODAY');

  // Map refs
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const coverageLoaded = useRef(false);

  // ── Load non-map data ──
  const loadData = useCallback(async (dateOverride) => {
    if (!navigator.onLine) return;
    const dateToUse = dateOverride !== undefined ? dateOverride : boardDate;
    try {
      const [s, a, sales] = await Promise.all([
        getTeamStats(dateToUse),
        getTeamActivity(),
        getAllSales()
      ]);
      setStats(s);
      setActivityData(a);
      setAllSales(sales);
    } catch (err) {
      console.error('[TeamTab] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, [boardDate]);

  useEffect(() => {
    if (!isActive) return;
    loadData();
    const id = setInterval(loadData, 30000); // refresh every 30s when active
    return () => clearInterval(id);
  }, [isActive, loadData]);

  // ── Initialize Mapbox for Coverage Map ──
  useEffect(() => {
    if (mapRef.current) return; // already initialized

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [-79.38, 43.65],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource('team-coverage', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Glow ring (wider, faded outer circle)
      map.addLayer({
        id: 'coverage-glow',
        type: 'circle',
        source: 'team-coverage',
        paint: {
          'circle-radius': 13,
          'circle-color': 'transparent',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': [
            'match', ['get', 'last_status'],
            'SALE', STATUS_COLORS.SALE,
            'CONVO', STATUS_COLORS.CONVO,
            'NOT_INTERESTED', STATUS_COLORS.NOT_INTERESTED,
            'CALLBACK', STATUS_COLORS.CALLBACK,
            'THINKING', STATUS_COLORS.THINKING,
            STATUS_COLORS.NO_ANSWER,
          ],
          'circle-stroke-opacity': 0.25,
        },
      });

      // Core pin
      map.addLayer({
        id: 'coverage-point',
        type: 'circle',
        source: 'team-coverage',
        paint: {
          'circle-color': [
            'match', ['get', 'last_status'],
            'SALE', STATUS_COLORS.SALE,
            'CONVO', STATUS_COLORS.CONVO,
            'NOT_INTERESTED', STATUS_COLORS.NOT_INTERESTED,
            'CALLBACK', STATUS_COLORS.CALLBACK,
            'THINKING', STATUS_COLORS.THINKING,
            STATUS_COLORS.NO_ANSWER,
          ],
          'circle-radius': 7,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
          'circle-opacity': 0.85,
        },
      });

      // Click popup
      map.on('click', 'coverage-point', (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const timeStr = props.last_knocked_at
          ? new Date(props.last_knocked_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        const statusLabel = (props.last_status || '').replace(/_/g, ' ');

        new mapboxgl.Popup({ offset: 12, closeButton: false })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-address">${props.address || 'Unknown Address'}</div>
            <span class="popup-status ${props.last_status || ''}">${statusLabel}</span>
            <div class="popup-time">${timeStr}</div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'coverage-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'coverage-point', () => { map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      coverageLoaded.current = false;
    };
  }, []);

  // ── Resize map when segment switches to MAP ──
  useEffect(() => {
    if (segment === 'MAP' && mapRef.current) {
      setTimeout(() => mapRef.current?.resize(), 80);
    }
  }, [segment]);

  // ── Load coverage data ──
  const loadCoverage = useCallback(async (shouldFit = false) => {
    if (!mapRef.current || !mapReady) return;
    try {
      const geo = await getTeamCoverageGeoJSON();
      const source = mapRef.current.getSource('team-coverage');
      if (source) {
        source.setData(geo);
        setCoverageCount(geo.features.length);
        
        if (shouldFit && geo.features.length > 0) {
          const lngs = geo.features.map(f => f.geometry.coordinates[0]);
          const lats = geo.features.map(f => f.geometry.coordinates[1]);
          mapRef.current.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 48, maxZoom: 15, duration: 800 }
          );
        }
      }
    } catch (err) {
      console.error('[TeamTab] loadCoverage error:', err);
    }
  }, [mapReady]);

  // ── Initial load coverage ──
  useEffect(() => {
    if (!mapReady || segment !== 'MAP' || coverageLoaded.current) return;
    coverageLoaded.current = true;
    loadCoverage(true);
  }, [mapReady, segment, loadCoverage]);

  // ── Poll coverage data ──
  useEffect(() => {
    if (!mapReady || segment !== 'MAP') return;
    const id = setInterval(() => loadCoverage(false), 60000); // Silent refresh every 60s
    return () => clearInterval(id);
  }, [mapReady, segment, loadCoverage]);

  function handleRecenterCoverage() {
    loadCoverage(true);
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3100);
  }

  function getInitials(name) {
    return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function getTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diffMs = new Date() - new Date(dateStr);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    return `${diffHrs}h ago`;
  }

  // ── Date strip helpers ──
  function getDateStrip() {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short' });
      const dateLabel = i <= 1 ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days.push({ iso, dayName, dateLabel, value: i === 0 ? 'TODAY' : iso });
    }
    return days;
  }

  function handleDateChange(value) {
    setBoardDate(value);
    setLoading(true);
    loadData(value);
  }

  // Team totals
  const teamTotals = stats.reduce((acc, r) => {
    acc.doors += r.doors;
    acc.convos += r.convos;
    acc.sales += r.sales;
    acc.revenue += r.revenue || 0;
    return acc;
  }, { doors: 0, convos: 0, sales: 0, revenue: 0 });
  teamTotals.close_rate = teamTotals.doors > 0 ? ((teamTotals.sales / teamTotals.doors) * 100).toFixed(1) : '0.0';

  return (
    <div className="team-container">

      {/* ── Segment Nav ── */}
      <nav className="team-segment-nav">
        <button
          id="team-seg-leaderboard"
          className={`team-seg-btn ${segment === 'LEADERBOARD' ? 'active' : ''}`}
          onClick={() => setSegment('LEADERBOARD')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          Board
        </button>
        <button
          id="team-seg-map"
          className={`team-seg-btn ${segment === 'MAP' ? 'active' : ''}`}
          onClick={() => setSegment('MAP')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
          </svg>
          Coverage
        </button>
        <button
          id="team-seg-activity"
          className={`team-seg-btn ${segment === 'ACTIVITY' ? 'active' : ''}`}
          onClick={() => setSegment('ACTIVITY')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
          Activity
        </button>
        <button
          id="team-seg-sales"
          className={`team-seg-btn ${segment === 'SALES' ? 'active' : ''}`}
          onClick={() => setSegment('SALES')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          Sales
        </button>
      </nav>

      {/* ════════════════════════════════════
           SEGMENT: LEADERBOARD
         ════════════════════════════════════ */}
      {segment === 'LEADERBOARD' && (
        <div className="team-segment-content">
          {/* Date Strip */}
          <div className="board-date-strip">
            <button
              className={`board-date-pill ${boardDate === 'WEEK' ? 'active' : ''}`}
              onClick={() => handleDateChange('WEEK')}
            >This Week</button>
            {getDateStrip().map(d => (
              <button
                key={d.value}
                className={`board-date-pill ${boardDate === d.value ? 'active' : ''}`}
                onClick={() => handleDateChange(d.value)}
              >
                <span className="date-pill-day">{d.dayName}</span>
                {d.dateLabel && <span className="date-pill-date">{d.dateLabel}</span>}
              </button>
            ))}
          </div>

          {/* Team Totals */}
          {!loading && stats.length > 0 && (
            <div className="board-team-totals">
              <div className="team-total-item">
                <span className="team-total-val">{teamTotals.doors}</span>
                <span className="team-total-lbl">Doors</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#3b82f6' }}>{teamTotals.convos}</span>
                <span className="team-total-lbl">Convos</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#10b981' }}>{teamTotals.sales}</span>
                <span className="team-total-lbl">Sales</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#f59e0b' }}>{teamTotals.close_rate}%</span>
                <span className="team-total-lbl">Close</span>
              </div>
              {teamTotals.revenue > 0 && (
                <div className="team-total-item">
                  <span className="team-total-val" style={{ color: '#a78bfa' }}>${teamTotals.revenue.toLocaleString()}</span>
                  <span className="team-total-lbl">Revenue</span>
                </div>
              )}
            </div>
          )}

          <div className="team-section-header">
            <h2 className="team-section-title">
              {boardDate === 'TODAY' ? "Today's Board" : boardDate === 'WEEK' ? 'This Week' : new Date(boardDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </h2>
            <button className="team-refresh-btn" onClick={() => loadData()}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>

          <div className="leaderboard-list">
            {loading ? (
              [0,1,2].map(i => (
                <div className="lb-skeleton" key={i}>
                  <div className="skel skel-circle" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="skel skel-line" />
                    <div className="skel skel-line-sm" />
                  </div>
                </div>
              ))
            ) : stats.length === 0 ? (
              <div className="leaderboard-empty">
                <div className="leaderboard-empty-icon">📊</div>
                <p>No activity logged{boardDate === 'TODAY' ? ' today yet' : ' on this day'}.</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>{boardDate === 'TODAY' ? 'Start knocking and watch the board fill up.' : 'Try selecting a different date.'}</p>
              </div>
            ) : (
              stats.map((rep, idx) => {
                const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';
                const avatarGrad = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                const isMe = rep.rep_id === user?.id;
                return (
                  <div className={`leaderboard-card ${rankClass}`} key={rep.rep_id}>
                    <span className="lb-rank">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </span>
                    <div className="lb-avatar" style={{ background: avatarGrad }}>
                      {getInitials(rep.rep_name)}
                    </div>
                    <div className="lb-info">
                      <div className="lb-name">
                        {rep.rep_name}{isMe && <span style={{ marginLeft: 6, fontSize: 10, color: '#818cf8', fontWeight: 900 }}>YOU</span>}
                      </div>
                      <div className="lb-stats-row">
                        <div className="lb-stat">
                          <span className="lb-stat-val">{rep.doors}</span>
                          <span className="lb-stat-lbl">Doors</span>
                        </div>
                        <div className="lb-stat">
                          <span className="lb-stat-val" style={{ color: '#3b82f6' }}>{rep.convos}</span>
                          <span className="lb-stat-lbl">Convos</span>
                        </div>
                        <div className="lb-stat">
                          <span className="lb-stat-val" style={{ color: '#10b981' }}>{rep.sales}</span>
                          <span className="lb-stat-lbl">Sales</span>
                        </div>
                        {rep.revenue > 0 && (
                          <div className="lb-stat">
                            <span className="lb-stat-val" style={{ color: '#a78bfa' }}>${rep.revenue.toLocaleString()}</span>
                            <span className="lb-stat-lbl">Rev</span>
                          </div>
                        )}
                        {rep.dph && (
                          <div className="lb-stat">
                            <span className="lb-stat-val" style={{ color: '#f59e0b' }}>{rep.dph}</span>
                            <span className="lb-stat-lbl">DPH</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="lb-close-rate">
                      <CloseRing pct={rep.close_rate} />
                      <span className="lb-close-lbl">Close</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════
           SEGMENT: COVERAGE MAP
         ════════════════════════════════════ */}
      <div style={{ display: segment === 'MAP' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="team-map-header">
          <h2 className="team-map-title">All-Time Coverage</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {coverageCount > 0 && (
              <span className="team-map-count">{coverageCount.toLocaleString()} properties</span>
            )}
            <button className="team-refresh-btn" onClick={() => loadCoverage(false)} title="Refresh Coverage">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
        </div>
        <div className="team-map-canvas">
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
          <button className="map-recenter-btn team-map-recenter" onClick={handleRecenterCoverage} title="Fit to Team Footprint">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
              <line x1="12" y1="2" x2="12" y2="6"></line>
              <line x1="12" y1="18" x2="12" y2="22"></line>
              <line x1="2" y1="12" x2="6" y2="12"></line>
              <line x1="18" y1="12" x2="22" y2="12"></line>
            </svg>
          </button>
        </div>
        <div className="team-map-legend">
          {Object.entries(STATUS_COLORS).map(([key, color]) => (
            <div className="legend-item" key={key}>
              <div className="legend-dot" style={{ background: color }} />
              {key.replace(/_/g, ' ')}
            </div>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════
           SEGMENT: ACTIVITY (Feed & Radar)
         ════════════════════════════════════ */}
      {segment === 'ACTIVITY' && (
        <div className="team-segment-content" style={{ paddingBottom: 24 }}>
          {/* Team Radar */}
          <div className="team-section-header">
            <h2 className="team-section-title">Team Radar</h2>
            <button className="team-refresh-btn" onClick={loadData}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
          <div className="activity-radar-list">
            {activityData.radar.length === 0 ? (
              <div className="activity-empty">No active reps today yet.</div>
            ) : (
              activityData.radar.map((rep, idx) => (
                <div className="radar-card" key={rep.rep_id}>
                  <div className="radar-avatar" style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}>
                    {getInitials(rep.rep_name)}
                  </div>
                  <div className="radar-info">
                    <div className="radar-name">{rep.rep_name}{rep.rep_id === user?.id && <span style={{ marginLeft: 6, fontSize: 10, color: '#818cf8', fontWeight: 900 }}>YOU</span>}</div>
                    <div className="radar-loc">{rep.street_name}</div>
                  </div>
                  <div className="radar-time">{getTimeAgo(rep.timestamp)}</div>
                </div>
              ))
            )}
          </div>

          {/* Live Feed */}
          <div className="team-section-header" style={{ marginTop: 12 }}>
            <h2 className="team-section-title">Live Feed</h2>
          </div>
          <div className="activity-feed-list">
            {activityData.feed.length === 0 ? (
              <div className="activity-empty" style={{ marginTop: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔥</div>
                <p>No wins logged yet today.</p>
              </div>
            ) : (
              activityData.feed.map((event) => {
                const isSale = event.status === 'SALE';
                const isCallback = event.status === 'CALLBACK';
                const color = isSale ? STATUS_COLORS.SALE : isCallback ? STATUS_COLORS.CALLBACK : STATUS_COLORS.CONVO;
                const sd = event.sale_details;
                return (
                  <div className="feed-card" key={event.id}>
                    <div className="feed-icon" style={{ background: `${color}1A`, color: color }}>
                      {isSale ? '💰' : isCallback ? '📅' : '💬'}
                    </div>
                    <div className="feed-content">
                      <div className="feed-text">
                        {isSale && sd ? (
                          <><strong>{event.rep_name}</strong> closed <span style={{ color: '#10b981', fontWeight: 800 }}>{sd.homeowner_name}</span>{sd.job_total ? <span style={{ color: '#a78bfa', fontWeight: 700 }}> · {sd.job_total}</span> : ''}{sd.payment_method ? <span style={{ color: '#8888a0', fontWeight: 500 }}> ({sd.payment_method})</span> : ''}</>
                        ) : (
                          <><strong>{event.rep_name}</strong> got a <span style={{ color, fontWeight: 800 }}>{event.status}</span></>
                        )}
                      </div>
                      <div className="feed-street">
                        {event.street_name}
                        {isSale && sd?.phone && <span style={{ marginLeft: 8, color: '#818cf8', fontSize: 11 }}>{sd.phone}</span>}
                        {isSale && sd?.service_date && <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 11 }}>{new Date(sd.service_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                      </div>
                    </div>
                    <div className="feed-time">{getTimeAgo(event.timestamp)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════
           SEGMENT: SALES BOOK (Persistent)
         ════════════════════════════════════ */}
      {segment === 'SALES' && (
        <div className="team-segment-content">
          <div className="team-section-header">
            <h2 className="team-section-title">Sales Book</h2>
            <div className="team-total-revenue-pill">
               ${allSales.reduce((sum, s) => {
                 const val = parseFloat(String(s.details?.job_total || '0').replace(/[^0-9.]/g, ''));
                 return sum + (isNaN(val) ? 0 : val);
               }, 0).toLocaleString()}
            </div>
          </div>

          <div className="sales-book-list">
            {allSales.length === 0 ? (
              <div className="activity-empty">No sales history found.</div>
            ) : (
              allSales.map((sale) => (
                <div className="sale-book-card" key={sale.id}>
                  <div className="sale-book-header">
                    <div className="sale-book-main">
                      <div className="sale-homeowner">{sale.details.homeowner_name || 'Anonymous Customer'}</div>
                      <div className="sale-address">{sale.address}</div>
                    </div>
                    <div className="sale-amount-badge">
                      {sale.details.job_total ? `$${sale.details.job_total}` : 'SALE'}
                    </div>
                  </div>

                  <div className="sale-details-grid">
                    <div className="sale-detail-item">
                      <span className="sale-detail-lbl">Rep</span>
                      <span className="sale-detail-val">{sale.rep_name}</span>
                    </div>
                    <div className="sale-detail-item">
                      <span className="sale-detail-lbl">Date</span>
                      <span className="sale-detail-val">{new Date(sale.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                    </div>
                    {sale.details.phone && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Phone</span>
                        <span className="sale-detail-val" style={{ color: '#818cf8' }}>{sale.details.phone}</span>
                      </div>
                    )}
                    {sale.details.email && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Email</span>
                        <span className="sale-detail-val" style={{ color: '#818cf8', fontSize: '10px' }}>{sale.details.email}</span>
                      </div>
                    )}
                    {sale.details.service_date && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Service</span>
                        <span className="sale-detail-val" style={{ color: '#f59e0b' }}>{new Date(sale.details.service_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                    {sale.details.payment_method && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Pay</span>
                        <span className="sale-detail-val">{sale.details.payment_method}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`team-toast ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
