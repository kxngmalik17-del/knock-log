import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { derivePropertiesFromEvents, getPropertiesAsGeoJSON } from '../../lib/propertyService';
import { sqlocal } from '../../lib/db';
import '../mapStyles.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_STYLE = 'mapbox://styles/xmalikjc/cmnwoppdm00ck01s76r6ccva7';

const STATUS_COLORS = {
  'NO_ANSWER':      '#6b7280',
  'CONVO':          '#3b82f6',
  'SALE':           '#10b981',
  'NOT_INTERESTED': '#ef4444',
  'CALLBACK':       '#f59e0b',
  'THINKING':       '#60a5fa',
};

export default function MapTab({ user, isActive }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [pinCount, setPinCount] = useState(0);
  const [totalKnocks, setTotalKnocks] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [geoStatus, setGeoStatus] = useState('checking');

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
            'NO_ANSWER', STATUS_COLORS.NO_ANSWER,
            STATUS_COLORS.NO_ANSWER
          ],
          'circle-radius': 8,
          'circle-stroke-width': ['case', ['==', ['get', 'knocked_today'], 1], 3, 1],
          'circle-stroke-color': ['case', ['==', ['get', 'knocked_today'], 1], 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0.15)'],
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
            'NO_ANSWER', STATUS_COLORS.NO_ANSWER,
            STATUS_COLORS.NO_ANSWER
          ],
          'circle-stroke-opacity': 0.4,
        }
      });

      map.on('click', 'unclustered-point', (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const statusLabel = (props.last_status || 'UNKNOWN').replace('_', ' ');
        const timeStr = props.last_knocked_at
          ? new Date(props.last_knocked_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';

        new mapboxgl.Popup({ offset: 14, closeButton: true })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-address">${props.address}</div>
            <div class="popup-status ${props.last_status}">${statusLabel}</div>
            <div class="popup-time">${timeStr}</div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => map.remove();
  }, []);

  const refreshPins = useCallback(async () => {
    if (!mapRef.current || !mapReady) return;
    try {
      const countResult = await sqlocal.sql`SELECT COUNT(*) as count FROM events WHERE type = 'KNOCK'`;
      setTotalKnocks(countResult[0]?.count || 0);

      await derivePropertiesFromEvents();
      const geojson = await getPropertiesAsGeoJSON();
      const source = mapRef.current.getSource('properties');
      if (source) {
        source.setData(geojson);
        setPinCount(geojson.features.length);
      }
    } catch (err) {
      console.error('[MapTab] Pin refresh error:', err);
    }
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    refreshPins();
    const id = setInterval(refreshPins, 5000);
    return () => clearInterval(id);
  }, [mapReady, refreshPins]);

  function handleRecenter() {
    if (!mapRef.current) return;
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });
        },
        () => {}
      );
    }
  }

  const showGeoWarning = totalKnocks > 0 && pinCount === 0;

  return (
    <div className="map-container">
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      <div className="map-pin-count">
        <span>{pinCount}</span> properties
        {totalKnocks > 0 && pinCount < totalKnocks && (
          <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 10 }}>
            ({totalKnocks - pinCount} without GPS)
          </span>
        )}
      </div>

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

      <button className="map-recenter-btn" onClick={handleRecenter} title="Recenter">
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
  );
}
