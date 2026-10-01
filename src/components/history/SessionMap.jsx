import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { resolveStatus, statusColor, MODES } from '../../config/modes';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_STYLE = 'mapbox://styles/xmalikjc/cmnwoppdm00ck01s76r6ccva7';

export default function SessionMap({ events }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    // Filter knocks that have coordinates
    const knobs = events.filter(e => e.type === 'KNOCK' && e.lat && e.lng);
    if (!knobs.length) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [-79.38, 43.65],
      zoom: 13,
      interactive: true,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

    const geojsonData = {
      type: 'FeatureCollection',
      features: knobs.map(k => {
        const payloadMock = {
          mode: k.mode,
          outcome_type: k.outcome,
          convo_status: k.objection === 'CALLBACK' ? 'CALLBACK' : null,
          objection_type: k.objection
        };
        const resolvedStatus = resolveStatus(payloadMock);
        const pinColor = statusColor(resolvedStatus, k.mode || MODES.RESIDENTIAL);

        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [k.lng, k.lat] },
          properties: {
            address: k.address,
            business_name: k.business_name || null,
            suite: k.suite || null,
            mode: k.mode || MODES.RESIDENTIAL,
            last_status: resolvedStatus,
            color: pinColor,
            timeLabel: new Date(k.time).toLocaleString([], { hour: '2-digit', minute: '2-digit' })
          }
        };
      })
    };

    map.on('load', () => {
      // Calculate bounds to fit all pins
      const bounds = new mapboxgl.LngLatBounds();
      geojsonData.features.forEach(f => {
        bounds.extend(f.geometry.coordinates);
      });
      map.fitBounds(bounds, { padding: 40, maxZoom: 16 });

      map.addSource('session-pins', {
        type: 'geojson',
        data: geojsonData
      });

      map.addLayer({
        id: 'session-points',
        type: 'circle',
        source: 'session-pins',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 7,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.2)',
        }
      });

      map.on('click', 'session-points', (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const statusLabel = (props.last_status || 'UNKNOWN').replace(/_/g, ' ');
        const displayAddr = `${props.business_name ? `${props.business_name} · ` : ''}${props.suite ? `Unit ${props.suite}, ` : ''}${props.address}`;

        new mapboxgl.Popup({ offset: 10, closeButton: true })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-address">${displayAddr}</div>
            <div class="popup-status ${props.last_status}">${statusLabel}</div>
            <div class="popup-time">${props.timeLabel}</div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'session-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'session-points', () => { map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
    });

    return () => map.remove();
  }, [events]);

  const hasPins = events.some(e => e.type === 'KNOCK' && e.lat && e.lng);
  
  if (!hasPins) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: 13, background: '#1f2937', borderRadius: 8, margin: '16px 0' }}>No map locations recorded for this session.</div>;
  }

  return (
    <div style={{ height: '240px', width: '100%', borderRadius: '8px', overflow: 'hidden', margin: '16px 0', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
