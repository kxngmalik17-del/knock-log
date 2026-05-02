import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { getActiveSessionGeoJSON } from '../../lib/propertyService';
import { getTeamGeoJSON, getTeamCoverageGeoJSON } from '../../lib/teamService';
import { sqlocal } from '../../lib/db';
import '../mapStyles.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_STYLE = 'mapbox://styles/xmalikjc/cmnwoppdm00ck01s76r6ccva7';

const STATUS_COLORS = {
  'NO_ANSWER':      '#6b7280',
  'CONVO':          '#3b82f6',
  'SALE':           '#10b981',
  'NOT_INTERESTED': '#ef4444',
  'CALLBACK':       '#a855f7',
  'THINKING':       '#60a5fa',
  'NO_SOLICITING':  '#dc2626',
  'CONSTRUCTION':   '#f59e0b',
};

export default function MapTab({ user, repName, isActive }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [pinCount, setPinCount] = useState(0);
  const [teamPinCount, setTeamPinCount] = useState(0);
  const [coverageCount, setCoverageCount] = useState(0);
  const [totalKnocks, setTotalKnocks] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [geoStatus, setGeoStatus] = useState('checking');
  const [selectedPin, setSelectedPin] = useState(null);
  const [mapView, setMapView] = useState('MY'); // 'MY' | 'TEAM' | 'COVERAGE'
  const coverageLoaded = useRef(false);

  // Ensure map canvas resizes when tab becomes visible
  useEffect(() => {
    if (isActive && mapRef.current) {
      setTimeout(() => mapRef.current.resize(), 100);
    }
  }, [isActive]);

  // Check geolocation permission on mount
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setGeoStatus('active'),
      (err) => {
        if (err.code === 1) setGeoStatus('denied');
        else setGeoStatus('active');
      },
      { timeout: 3000 }
    );
  }, []);

  // Initialize Mapbox
  useEffect(() => {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [-79.38, 43.65],
      zoom: 13,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 15 });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }

    map.on('load', () => {
      // ── MY PINS SOURCE ──
      map.addSource('properties', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'properties',
        paint: {
          'circle-color': [
            'match', ['get', 'last_status'],
            'SALE', STATUS_COLORS.SALE,
            'CONVO', STATUS_COLORS.CONVO,
            'NOT_INTERESTED', STATUS_COLORS.NOT_INTERESTED,
            'CALLBACK', STATUS_COLORS.CALLBACK,
            'THINKING', STATUS_COLORS.THINKING,
            'NO_SOLICITING', STATUS_COLORS.NO_SOLICITING,
            'CONSTRUCTION', STATUS_COLORS.CONSTRUCTION,
            'NO_ANSWER', STATUS_COLORS.NO_ANSWER,
            STATUS_COLORS.NO_ANSWER
          ],
          'circle-radius': [
            'match', ['get', 'last_status'],
            'NO_SOLICITING', 9,
            'CONSTRUCTION', 9,
            8
          ],
          'circle-stroke-width': ['case', ['==', ['get', 'knocked_today'], 1], 3, 1],
          'circle-stroke-color': [
            'match', ['get', 'last_status'],
            'NO_SOLICITING', 'rgba(220,38,38,0.6)',
            'CONSTRUCTION', 'rgba(245,158,11,0.6)',
            ['case', ['==', ['get', 'knocked_today'], 1], 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.15)']
          ],
          'circle-opacity': ['case', ['==', ['get', 'knocked_today'], 1], 1, 0.7],
        }
      });

      map.addLayer({
        id: 'today-glow',
        type: 'circle',
        source: 'properties',
        filter: ['==', ['get', 'knocked_today'], 1],
        paint: {
          'circle-radius': 14,
          'circle-color': 'transparent',
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'match', ['get', 'last_status'],
            'SALE', STATUS_COLORS.SALE,
            'CONVO', STATUS_COLORS.CONVO,
            'NOT_INTERESTED', STATUS_COLORS.NOT_INTERESTED,
            'CALLBACK', STATUS_COLORS.CALLBACK,
            'THINKING', STATUS_COLORS.THINKING,
            'NO_SOLICITING', STATUS_COLORS.NO_SOLICITING,
            'CONSTRUCTION', STATUS_COLORS.CONSTRUCTION,
            'NO_ANSWER', STATUS_COLORS.NO_ANSWER,
            STATUS_COLORS.NO_ANSWER
          ],
          'circle-stroke-opacity': 0.4,
        }
      });

      // ── TEAM GHOST PINS SOURCE ──
      map.addSource('team-properties', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'team-ghost-point',
        type: 'circle',
        source: 'team-properties',
        paint: {
          'circle-color': [
            'match', ['get', 'last_status'],
            'SALE', STATUS_COLORS.SALE,
            'CONVO', STATUS_COLORS.CONVO,
            'NOT_INTERESTED', STATUS_COLORS.NOT_INTERESTED,
            'CALLBACK', STATUS_COLORS.CALLBACK,
            'THINKING', STATUS_COLORS.THINKING,
            'NO_SOLICITING', STATUS_COLORS.NO_SOLICITING,
            'CONSTRUCTION', STATUS_COLORS.CONSTRUCTION,
            'NO_ANSWER', STATUS_COLORS.NO_ANSWER,
            STATUS_COLORS.NO_ANSWER
          ],
          'circle-radius': 7,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.08)',
          'circle-opacity': 0.3,
        },
        layout: { visibility: 'none' }
      });

      map.addLayer({
        id: 'team-ghost-ring',
        type: 'circle',
        source: 'team-properties',
        paint: {
          'circle-radius': 12,
          'circle-color': 'transparent',
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.06)',
          'circle-stroke-opacity': 0.5,
        },
        layout: { visibility: 'none' }
      });

      // ── COVERAGE SOURCE ──
      map.addSource('team-coverage', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

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
        layout: { visibility: 'none' }
      });

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
        layout: { visibility: 'none' }
      });

      // ── CLICK HANDLERS ──

      const handleMyPinClick = (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const statusLabel = (props.last_status || 'UNKNOWN').replace('_', ' ');
        const timeStr = props.last_knocked_at
          ? new Date(props.last_knocked_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';
        map.flyTo({ center: coords, zoom: 16.5, offset: [0, 80] });
        setSelectedPin({ ...props, statusLabel, timeStr, visitsNum: props.visits || 1, isGhost: false });
      };

      map.on('click', 'unclustered-point', handleMyPinClick);
      map.on('click', 'today-glow', handleMyPinClick);

      const handleTeamPinClick = (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const statusLabel = (props.last_status || 'UNKNOWN').replace('_', ' ');
        const timeStr = props.last_knocked_at
          ? new Date(props.last_knocked_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';
        map.flyTo({ center: coords, zoom: 16.5, offset: [0, 80] });
        setSelectedPin({ ...props, statusLabel, timeStr, visitsNum: 1, isGhost: true });
      };

      map.on('click', 'team-ghost-point', handleTeamPinClick);

      // Coverage popup
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

      // Dismiss bottom sheet when clicking empty space (not coverage popups)
      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ['unclustered-point', 'today-glow', 'team-ghost-point']
        });
        if (!features.length) {
          setSelectedPin(null);
        }
      });

      const cursorPointer = () => { map.getCanvas().style.cursor = 'pointer'; };
      const cursorDefault = () => { map.getCanvas().style.cursor = ''; };

      map.on('mouseenter', 'unclustered-point', cursorPointer);
      map.on('mouseleave', 'unclustered-point', cursorDefault);
      map.on('mouseenter', 'today-glow', cursorPointer);
      map.on('mouseleave', 'today-glow', cursorDefault);
      map.on('mouseenter', 'team-ghost-point', cursorPointer);
      map.on('mouseleave', 'team-ghost-point', cursorDefault);
      map.on('mouseenter', 'coverage-point', cursorPointer);
      map.on('mouseleave', 'coverage-point', cursorDefault);

      mapRef.current = map;
      setMapReady(true);
    });

    return () => map.remove();
  }, []);

  // ── Toggle layer visibility based on mapView ──
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    const ghostVis    = mapView === 'TEAM'     ? 'visible' : 'none';
    const coverageVis = mapView === 'COVERAGE' ? 'visible' : 'none';

    map.setLayoutProperty('team-ghost-point', 'visibility', ghostVis);
    map.setLayoutProperty('team-ghost-ring',  'visibility', ghostVis);
    map.setLayoutProperty('coverage-point',   'visibility', coverageVis);
    map.setLayoutProperty('coverage-glow',    'visibility', coverageVis);
  }, [mapView, mapReady]);

  // ── Load coverage data (paginated) ──
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
      console.error('[MapTab] loadCoverage error:', err);
    }
  }, [mapReady]);

  // ── Load coverage once when switching to COVERAGE view ──
  useEffect(() => {
    if (!mapReady || mapView !== 'COVERAGE') return;
    if (!coverageLoaded.current) {
      coverageLoaded.current = true;
      loadCoverage(true);
    }
  }, [mapView, mapReady, loadCoverage]);

  // ── Poll coverage silently every 60s while in coverage view ──
  useEffect(() => {
    if (!mapReady || mapView !== 'COVERAGE') return;
    const id = setInterval(() => loadCoverage(false), 60000);
    return () => clearInterval(id);
  }, [mapView, mapReady, loadCoverage]);

  // ── Refresh Pins ──
  const refreshPins = useCallback(async () => {
    if (!mapRef.current || !mapReady) return;
    try {
      const geojson = await getActiveSessionGeoJSON();

      const source = mapRef.current.getSource('properties');
      if (source) {
        source.setData(geojson);
        setPinCount(geojson.features.length);
      }

      // Update total knocks for the active session warning logic
      const rsStart = await sqlocal.sql`SELECT payload FROM events WHERE type = 'DAY_START' ORDER BY created_at DESC LIMIT 1`;
      if (rsStart.length > 0) {
        const sessData = JSON.parse(rsStart[0].payload);
        const knocksRs = await sqlocal.sql`SELECT payload FROM events WHERE type = 'KNOCK'`;
        const knocks = knocksRs.filter(r => JSON.parse(r.payload).session_id === sessData.session_id);

        const uniqueKeys = new Set();
        knocks.forEach(r => {
          const p = JSON.parse(r.payload);
          const key = `${p.house_number || ''} ${p.street_name || ''}`.trim().toLowerCase();
          if (key) uniqueKeys.add(key);
        });
        setTotalKnocks(uniqueKeys.size);
      } else {
        setTotalKnocks(0);
      }

      // Fetch team ghost data
      if (navigator.onLine && user?.id) {
        const teamGeo = await getTeamGeoJSON(user.id);
        const teamSource = mapRef.current.getSource('team-properties');
        if (teamSource) {
          teamSource.setData(teamGeo);
          setTeamPinCount(teamGeo.features.length);
        }
      }

    } catch (err) {
      console.error('[MapTab] Pin refresh error:', err);
    }
  }, [mapReady, user?.id]);

  // ── Refresh pins only when tab is active ──
  useEffect(() => {
    if (!mapReady) return;
    if (!isActive) return;

    refreshPins();
    const id = setInterval(refreshPins, 15000);
    return () => clearInterval(id);
  }, [mapReady, refreshPins, isActive]);

  function handleRecenter() {
    if (!mapRef.current) return;
    if (mapView === 'COVERAGE') {
      loadCoverage(true);
      return;
    }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });
        },
        () => {}
      );
    }
  }

  const showGeoWarning = totalKnocks > 0 && pinCount === 0 && mapView === 'MY';
  const sheetOpen = selectedPin !== null;

  return (
    <div className="map-container">
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* ── View Toggle ── */}
      <div className="map-view-toggle">
        <button
          className={`map-toggle-btn ${mapView === 'MY' ? 'active' : ''}`}
          onClick={() => setMapView('MY')}
        >
          My Pins
        </button>
        <button
          className={`map-toggle-btn ${mapView === 'TEAM' ? 'active' : ''}`}
          onClick={() => setMapView('TEAM')}
        >
          Team View
          {teamPinCount > 0 && <span className="team-badge">{teamPinCount}</span>}
        </button>
        <button
          className={`map-toggle-btn ${mapView === 'COVERAGE' ? 'active' : ''}`}
          onClick={() => setMapView('COVERAGE')}
        >
          Coverage
          {coverageCount > 0 && mapView === 'COVERAGE' && <span className="team-badge">{coverageCount.toLocaleString()}</span>}
        </button>
      </div>

      {/* ── Pin Count ── */}
      {mapView !== 'COVERAGE' && (
        <div className="map-pin-count" style={{ left: 16, top: 76 }}>
          <span>{pinCount}</span> my properties
          {mapView === 'TEAM' && teamPinCount > 0 && (
            <span style={{ marginLeft: 8, color: '#a78bfa', fontSize: 10 }}>
              + {teamPinCount} team
            </span>
          )}
          {totalKnocks > 0 && pinCount < totalKnocks && (
            <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 10 }}>
              ({totalKnocks - pinCount} without GPS)
            </span>
          )}
        </div>
      )}

      {/* ── Coverage count pill ── */}
      {mapView === 'COVERAGE' && coverageCount > 0 && (
        <div className="map-pin-count" style={{ left: 16, top: 76 }}>
          <span>{coverageCount.toLocaleString()}</span> all-time properties
        </div>
      )}

      {showGeoWarning && (
        <div className="map-geo-warning">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <strong>{totalKnocks} knocks logged</strong> but no GPS data attached.
            {geoStatus === 'denied' && <> Allow location access in your browser to see pins.</>}
            {geoStatus === 'active' && <> New knocks will appear as pins automatically.</>}
            {geoStatus === 'checking' && <> Checking location permissions…</>}
          </div>
        </div>
      )}

      {/* ── Coverage Legend ── */}
      {mapView === 'COVERAGE' && (
        <div className="map-coverage-legend">
          {Object.entries(STATUS_COLORS).map(([key, color]) => (
            <div className="map-legend-item" key={key}>
              <div className="map-legend-dot" style={{ background: color }} />
              {key.replace(/_/g, ' ')}
            </div>
          ))}
        </div>
      )}

      <button className="map-recenter-btn" onClick={handleRecenter} title={mapView === 'COVERAGE' ? 'Fit to footprint' : 'Recenter'} style={{ bottom: sheetOpen ? 'calc(24px + 180px)' : '24px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="3"></circle>
          <line x1="12" y1="2" x2="12" y2="6"></line>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line>
          <line x1="18" y1="12" x2="22" y2="12"></line>
        </svg>
      </button>

      {/* ── Pin Info Bottom Sheet ── */}
      <div className={`pin-sheet-overlay ${sheetOpen ? 'open' : ''}`}>
        {selectedPin && (
          <>
            <div className="pin-sheet-header">
              <div>
                <div className="pin-sheet-address">
                  {selectedPin.address}
                  {selectedPin.isGhost && (
                    <span className="ghost-badge">TEAM</span>
                  )}
                </div>
                {selectedPin.isGhost && selectedPin.rep_name && (
                  <div className="pin-sheet-rep">Knocked by {selectedPin.rep_name}</div>
                )}
              </div>
              <button className="pin-sheet-close" onClick={() => setSelectedPin(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div className="pin-sheet-status-row">
              <div className="pin-sheet-status-badge" style={{
                background: STATUS_COLORS[selectedPin.last_status] + '33',
                color: STATUS_COLORS[selectedPin.last_status] || '#fff'
              }}>
                {selectedPin.statusLabel}
              </div>
              {!selectedPin.isGhost && selectedPin.visitsNum > 1 && (
                <div className="pin-sheet-visits">
                  {selectedPin.visitsNum - 1} Re-knocks ({selectedPin.visitsNum} visits)
                </div>
              )}
            </div>

            <div className="pin-sheet-time">
              Last knocked: {selectedPin.timeStr}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
