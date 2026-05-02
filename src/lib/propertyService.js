import { sqlocal, upsertProperty, getAllProperties } from './db';

/**
 * PROPERTY DERIVATION SERVICE
 * Scans the local event log and builds/updates the properties table
 * with the latest status, coordinates, and timestamps for each address.
 */

// Deterministic property_id from address string
function makePropertyId(address) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'prop_' + Math.abs(hash).toString(36);
}

function buildGeoJSONFromKnocks(knocks) {
  const propMap = {};
  const todayStr = new Date().toISOString().split('T')[0];

  for (const row of knocks) {
    const p = row.payload ? JSON.parse(row.payload) : row; // handle both sqlocal rows and raw payload objects
    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim();
    if (!address) continue;
    if (!p.lat || !p.lng) continue; // Must have coordinates to map

    const pid = makePropertyId(address.toLowerCase());
    
    // Determine the resolved status for the pin color
    let resolvedStatus = p.outcome_type || 'NO_ANSWER';
    if (p.outcome_type === 'CONVO') {
      if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') {
        resolvedStatus = 'CALLBACK';
      } else if (p.objection_type === 'NOT INTERESTED') {
        resolvedStatus = 'NOT_INTERESTED';
      } else if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') {
        resolvedStatus = 'THINKING';
      } else if (p.objection_type === 'NO SOLICITING') {
        resolvedStatus = 'NO_SOLICITING';
      } else if (p.objection_type === 'CONSTRUCTION') {
        resolvedStatus = 'CONSTRUCTION';
      } else {
        resolvedStatus = 'CONVO';
      }
    }

    propMap[pid] = {
      property_id: pid,
      address,
      lat: p.lat,
      lng: p.lng,
      last_status: resolvedStatus,
      last_knocked_at: p.timestamp || row.created_at,
      knocked_today: (p.timestamp || row.created_at || '').startsWith(todayStr) ? 1 : 0,
      visits: (propMap[pid]?.visits || 0) + 1
    };
  }

  return {
    type: 'FeatureCollection',
    features: Object.values(propMap).map(p => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      },
      properties: {
        property_id: p.property_id,
        address: p.address,
        last_status: p.last_status,
        last_knocked_at: p.last_knocked_at,
        knocked_today: p.knocked_today,
        visits: p.visits
      }
    }))
  };
}


/**
 * Scans all KNOCK events from local SQLite and upserts into the properties table.
 * This is idempotent — safe to call repeatedly.
 */
export async function derivePropertiesFromEvents() {
  const rs = await sqlocal.sql`SELECT * FROM events WHERE type = 'KNOCK' ORDER BY created_at ASC`;
  const todayStr = new Date().toISOString().split('T')[0];
  const propMap = {};
  
  for (const row of rs) {
    const p = JSON.parse(row.payload);
    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim();
    if (!address) continue;

    const pid = makePropertyId(address.toLowerCase());
    
    let resolvedStatus = p.outcome_type || 'NO_ANSWER';
    if (p.outcome_type === 'CONVO') {
      if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') {
        resolvedStatus = 'CALLBACK';
      } else if (p.objection_type === 'NOT INTERESTED') {
        resolvedStatus = 'NOT_INTERESTED';
      } else if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') {
        resolvedStatus = 'THINKING';
      } else {
        resolvedStatus = 'CONVO';
      }
    }

    const knockedToday = (p.timestamp || row.created_at).startsWith(todayStr) ? 1 : 0;

    propMap[pid] = {
      property_id: pid,
      address,
      lat: p.lat || propMap[pid]?.lat || null,
      lng: p.lng || propMap[pid]?.lng || null,
      last_status: resolvedStatus,
      last_knocked_at: p.timestamp || row.created_at,
      last_rep_id: p.rep_id || null,
      territory_id: null,
      knocked_today: knockedToday || propMap[pid]?.knocked_today || 0
    };
  }

  for (const prop of Object.values(propMap)) {
    await upsertProperty(prop);
  }
}

/**
 * Returns all geo-located properties as a GeoJSON FeatureCollection
 */
export async function getPropertiesAsGeoJSON() {
  const props = await getAllProperties();
  
  return {
    type: 'FeatureCollection',
    features: props.map(p => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      },
      properties: {
        property_id: p.property_id,
        address: p.address,
        last_status: p.last_status,
        last_knocked_at: p.last_knocked_at,
        knocked_today: p.knocked_today,
        last_rep_id: p.last_rep_id
      }
    }))
  };
}

export async function getActiveSessionGeoJSON() {
  const rsStart = await sqlocal.sql`SELECT payload FROM events WHERE type = 'DAY_START' ORDER BY created_at DESC LIMIT 1`;
  if (rsStart.length === 0) return { type: 'FeatureCollection', features: [] };
  
  const sessData = JSON.parse(rsStart[0].payload);
  const sessionId = sessData.session_id;

  const rsEnd = await sqlocal.sql`SELECT payload FROM events WHERE type = 'DAY_END'`;
  const ends = rsEnd.filter(r => JSON.parse(r.payload).session_id === sessionId);
  if (ends.length > 0) return { type: 'FeatureCollection', features: [] }; // Session closed

  const knocksRs = await sqlocal.sql`SELECT payload, created_at FROM events WHERE type = 'KNOCK'`;
  const knocks = knocksRs.filter(r => JSON.parse(r.payload).session_id === sessionId);
  
  return buildGeoJSONFromKnocks(knocks);
}

export async function getSessionGeoJSON(sessionId) {
  const knocksRs = await sqlocal.sql`SELECT payload, created_at FROM events WHERE type = 'KNOCK'`;
  const knocks = knocksRs.filter(r => JSON.parse(r.payload).session_id === sessionId);
  return buildGeoJSONFromKnocks(knocks);
}


