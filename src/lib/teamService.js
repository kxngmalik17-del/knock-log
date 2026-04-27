import { supabase } from './supabase';

/**
 * TEAM SERVICE
 * Handles fetching team knock data for ghost pins, street claims, leaderboard, and all-time coverage.
 */

/**
 * Fetch today's knock events from ALL reps on the team (excluding the current user).
 * Returns GeoJSON suitable for the ghost pin layer.
 */
export async function getTeamGeoJSON(currentUserId) {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: knockEvents, error } = await supabase
    .from('events')
    .select('event_id, rep_id, payload, created_at')
    .eq('type', 'KNOCK')
    .gte('created_at', todayStr + 'T00:00:00.000Z')
    .neq('rep_id', currentUserId);

  if (error || !knockEvents) {
    console.error('[TeamService] Failed to fetch team knocks:', error);
    return { type: 'FeatureCollection', features: [] };
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const propMap = {};
  for (const row of knockEvents) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim();
    if (!address || !p.lat || !p.lng) continue;

    const key = address.toLowerCase();
    let resolvedStatus = resolveStatus(p);

    propMap[key] = {
      address, lat: p.lat, lng: p.lng, last_status: resolvedStatus,
      last_knocked_at: p.timestamp || row.created_at,
      rep_name: repNameMap[row.rep_id] || 'Teammate',
    };
  }

  return {
    type: 'FeatureCollection',
    features: Object.values(propMap).map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        address: p.address, last_status: p.last_status,
        last_knocked_at: p.last_knocked_at, rep_name: p.rep_name, is_ghost: 1,
      }
    }))
  };
}


/**
 * Fetch ALL-TIME team coverage across every rep.
 * Reads from the team_property_coverage view — latest status per unique address.
 * Returns GeoJSON for the Team Coverage Map.
 */
export async function getTeamCoverageGeoJSON() {
  const { data, error } = await supabase
    .from('team_property_coverage')
    .select('house_number, street_name, last_knocked_at, outcome_type, convo_status, objection_type, lat, lng');

  if (error || !data) {
    console.error('[TeamService] Failed to fetch team coverage:', error);
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: data.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      properties: {
        address: `${row.house_number || ''} ${row.street_name || ''}`.trim(),
        last_status: resolveStatus({ outcome_type: row.outcome_type, convo_status: row.convo_status, objection_type: row.objection_type }),
        last_knocked_at: row.last_knocked_at,
      }
    }))
  };
}


/**
 * Fetch today's leaderboard stats for all reps.
 * Returns array of { rep_id, rep_name, doors, convos, sales, close_rate }, sorted by sales.
 */
export async function getTeamStats() {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: events, error } = await supabase
    .from('events')
    .select('rep_id, payload')
    .eq('type', 'KNOCK')
    .gte('created_at', todayStr + 'T00:00:00.000Z');

  if (error || !events) {
    console.error('[TeamService] Failed to fetch team stats:', error);
    return [];
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const repData = {};
  const seenAddresses = {};

  for (const row of events) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const rid = row.rep_id;
    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim().toLowerCase();
    if (!address) continue;

    if (!repData[rid]) {
      repData[rid] = { rep_id: rid, rep_name: repNameMap[rid] || 'Rep', doors: 0, convos: 0, sales: 0 };
      seenAddresses[rid] = new Set();
    }

    const resolvedStatus = resolveStatus(p);
    if (!seenAddresses[rid].has(address)) {
      seenAddresses[rid].add(address);
      repData[rid].doors++;
    }
    if (resolvedStatus === 'SALE') repData[rid].sales++;
    else if (['CONVO', 'CALLBACK', 'THINKING'].includes(resolvedStatus)) repData[rid].convos++;
  }

  return Object.values(repData)
    .map(r => ({ ...r, close_rate: r.doors > 0 ? ((r.sales / r.doors) * 100).toFixed(1) : '0.0' }))
    .sort((a, b) => b.sales - a.sales || b.doors - a.doors);
}


/**
 * Fetch today's team activity for the Live Feed and Team Radar.
 * Returns { feed: [], radar: [] }
 */
export async function getTeamActivity() {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: events, error } = await supabase
    .from('events')
    .select('rep_id, payload, created_at')
    .eq('type', 'KNOCK')
    .gte('created_at', todayStr + 'T00:00:00.000Z')
    .order('created_at', { ascending: false });

  if (error || !events) {
    console.error('[TeamService] Failed to fetch team activity:', error);
    return { feed: [], radar: [] };
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const feed = [];
  const radarMap = {};

  for (const row of events) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const rid = row.rep_id;
    const repName = repNameMap[rid] || 'Teammate';
    const timestamp = p.timestamp || row.created_at;
    const streetName = p.street_name || 'Unknown Street';
    
    // Determine status
    const status = resolveStatus(p);

    // 1. Build Live Feed (Notable events only)
    if (['SALE', 'CONVO', 'CALLBACK'].includes(status)) {
      feed.push({
        id: row.created_at + rid, // unique enough for a key
        rep_id: rid,
        rep_name: repName,
        status: status,
        street_name: streetName,
        timestamp: timestamp
      });
    }

    // 2. Build Team Radar (Only the most recent knock per rep)
    if (!radarMap[rid]) {
      radarMap[rid] = {
        rep_id: rid,
        rep_name: repName,
        street_name: streetName,
        timestamp: timestamp
      };
    }
  }

  return {
    feed, // Already sorted descending by the SQL query
    radar: Object.values(radarMap).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  };
}


// ── Internal helper ──
function resolveStatus(p) {
  if (p.outcome_type !== 'CONVO') return p.outcome_type || 'NO_ANSWER';
  if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') return 'CALLBACK';
  if (p.objection_type === 'NOT INTERESTED') return 'NOT_INTERESTED';
  if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') return 'THINKING';
  return 'CONVO';
}
