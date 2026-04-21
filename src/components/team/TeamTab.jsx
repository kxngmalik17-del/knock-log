import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  getTeamStats,
  getTeamCoverageGeoJSON,
  getTodayStreetClaims,
  claimStreet,
  releaseStreetClaim,
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
  CALLBACK:       '#f59e0b',
  THINKING:       '#60a5fa',
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
  const [segment, setSegment] = useState('LEADERBOARD'); // 'LEADERBOARD' | 'MAP' | 'CLAIMS'
  const [stats, setStats] = useState([]);
  const [claims, setClaims] = useState([]);
  const [coverageCount, setCoverageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Map refs
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const coverageLoaded = useRef(false);

  // ── Load non-map data ──
  const loadData = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const [s, c] = await Promise.all([getTeamStats(), getTodayStreetClaims()]);
      setStats(s);
      setClaims(c);
    } catch (err) {
      console.error('[TeamTab] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // ── Load coverage data once map is ready and MAP segment is viewed ──
  useEffect(() => {
    if (!mapReady || segment !== 'MAP' || coverageLoaded.current) return;
    coverageLoaded.current = true;

    (async () => {
      const geo = await getTeamCoverageGeoJSON();
      const source = mapRef.current?.getSource('team-coverage');
      if (source) {
        source.setData(geo);
        setCoverageCount(geo.features.length);
        // Fit map to coverage bounds
        if (geo.features.length > 0) {
          const lngs = geo.features.map(f => f.geometry.coordinates[0]);
          const lats = geo.features.map(f => f.geometry.coordinates[1]);
          mapRef.current?.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 48, maxZoom: 15, duration: 800 }
          );
        }
      }
    })();
  }, [mapReady, segment]);

  // ── Claim current street ──
  async function handleClaim() {
    try {
      const rsStart = await sqlocal.sql`SELECT payload FROM events WHERE type = 'DAY_START' ORDER BY created_at DESC LIMIT 1`;
      if (rsStart.length === 0) {
        showToast('Start a session first.', 'error');
        return;
      }
      const knocksRs = await sqlocal.sql`SELECT payload FROM events WHERE type = 'KNOCK' ORDER BY created_at DESC LIMIT 1`;
      if (knocksRs.length === 0) {
        showToast('Log a knock first to claim a street.', 'error');
        return;
      }
      const lastKnock = JSON.parse(knocksRs[0].payload);
      const result = await claimStreet({
        repId: user.id,
        repName: repName || '',
        streetName: lastKnock.street_name,
        lat: lastKnock.lat,
        lng: lastKnock.lng,
      });
      showToast(result.message, result.success ? 'success' : 'error');
      if (result.success) loadData();
    } catch (err) {
      showToast('Something went wrong.', 'error');
    }
  }

  async function handleRelease(claimId) {
    const ok = await releaseStreetClaim(claimId);
    showToast(ok ? 'Street released.' : 'Failed to release.', ok ? 'success' : 'error');
    if (ok) loadData();
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3100);
  }

  function getInitials(name) {
    return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  const myClaims = claims.filter(c => c.rep_id === user?.id);
  const teamClaims = claims.filter(c => c.rep_id !== user?.id);

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
          id="team-seg-claims"
          className={`team-seg-btn ${segment === 'CLAIMS' ? 'active' : ''}`}
          onClick={() => setSegment('CLAIMS')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          Streets
          {claims.length > 0 && (
            <span style={{ marginLeft: 4, background: '#6366f1', color: '#fff', borderRadius: 8, padding: '1px 5px', fontSize: 9, fontWeight: 900 }}>
              {claims.length}
            </span>
          )}
        </button>
      </nav>

      {/* ════════════════════════════════════
           SEGMENT: LEADERBOARD
         ════════════════════════════════════ */}
      {segment === 'LEADERBOARD' && (
        <div className="team-segment-content">
          <div className="team-section-header">
            <h2 className="team-section-title">Today's Board</h2>
            <button className="team-refresh-btn" onClick={loadData}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>

          <div className="leaderboard-list">
            {loading ? (
              // Skeleton loaders
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
                <p>No activity logged today yet.</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>Start knocking and watch the board fill up.</p>
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
          {coverageCount > 0 && (
            <span className="team-map-count">{coverageCount.toLocaleString()} properties</span>
          )}
        </div>
        <div className="team-map-canvas">
          <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
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
           SEGMENT: STREET CLAIMS
         ════════════════════════════════════ */}
      {segment === 'CLAIMS' && (
        <div className="team-segment-content">
          <div className="team-section-header">
            <h2 className="team-section-title">Street Claims</h2>
            <button className="team-refresh-btn" onClick={loadData}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>

          <div className="team-claims-wrapper">
            <div className="team-claim-action-row">
              <button id="team-claim-street-btn" className="team-claim-main-btn" onClick={handleClaim}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Claim Current Street
              </button>
              <div className="team-claims-count">
                <strong>{claims.length}</strong>
                Active
              </div>
            </div>

            {claims.length === 0 ? (
              <div className="team-claims-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginBottom: 12 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                <p>No streets claimed today.</p>
                <p style={{ fontSize: 12, color: '#55556a', marginTop: 4 }}>Claim your street to let the team know where you are.</p>
              </div>
            ) : (
              <>
                {myClaims.length > 0 && (
                  <>
                    <div className="team-claims-group-label">Your Claims</div>
                    <div className="team-claims-list">
                      {myClaims.map(claim => {
                        const claimCount = claims.filter(c => c.street_name === claim.street_name).length;
                        return (
                          <div className="team-claim-card is-mine" key={claim.id}>
                            <div className="team-claim-street-icon">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                              </svg>
                            </div>
                            <div className="team-claim-info">
                              <div className="team-claim-street-name">{claim.street_name}</div>
                              <div className="team-claim-rep-name">You</div>
                            </div>
                            <span className={`team-claim-badge ${claimCount >= 2 ? 'full' : 'open'}`}>
                              {claimCount}/2
                            </span>
                            <button className="team-claim-release" onClick={() => handleRelease(claim.id)}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {teamClaims.length > 0 && (
                  <>
                    <div className="team-claims-group-label" style={{ marginTop: myClaims.length > 0 ? 20 : 0 }}>Team</div>
                    <div className="team-claims-list">
                      {teamClaims.map(claim => {
                        const claimCount = claims.filter(c => c.street_name === claim.street_name).length;
                        return (
                          <div className="team-claim-card" key={claim.id}>
                            <div className="team-claim-street-icon">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                              </svg>
                            </div>
                            <div className="team-claim-info">
                              <div className="team-claim-street-name">{claim.street_name}</div>
                              <div className="team-claim-rep-name">{claim.rep_name || 'Teammate'}</div>
                            </div>
                            <span className={`team-claim-badge ${claimCount >= 2 ? 'full' : 'open'}`}>
                              {claimCount >= 2 ? 'Full' : `${claimCount}/2`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
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
