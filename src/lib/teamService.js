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
 * Fetch all street claims for today.
 */
export async function getTodayStreetClaims() {
  const todayStr = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('street_claims')
    .select('*')
    .eq('session_date', todayStr);

  if (error) {
    console.error('[TeamService] Failed to fetch street claims:', error);
    return [];
  }
  return data || [];
}

/**
 * Claim a street for the current rep. Returns { success, message, claim? }
 */
export async function claimStreet({ repId, repName, streetName, lat, lng }) {
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: existing, error: fetchError } = await supabase
    .from('street_claims')
    .select('*')
    .eq('street_name', streetName)
    .eq('session_date', todayStr);

  if (fetchError) return { success: false, message: 'Failed to check existing claims.' };
  if (existing?.some(c => c.rep_id === repId)) return { success: false, message: 'You already claimed this street.' };
  if (existing?.length >= 2) {
    const claimedBy = existing.map(c => c.rep_name || 'Unknown').join(' & ');
    return { success: false, message: `Street is full — claimed by ${claimedBy}.` };
  }

  const { data: claim, error: insertError } = await supabase
    .from('street_claims')
    .insert({ rep_id: repId, rep_name: repName || '', street_name: streetName, street_center_lat: lat || null, street_center_lng: lng || null, session_date: todayStr })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') return { success: false, message: 'You already claimed this street.' };
    return { success: false, message: 'Failed to claim street.' };
  }

  return { success: true, message: 'Street claimed!', claim };
}

/**
 * Release a street claim.
 */
export async function releaseStreetClaim(claimId) {
  const { error } = await supabase.from('street_claims').delete().eq('id', claimId);
  return !error;
}


// ── Internal helper ──
function resolveStatus(p) {
  if (p.outcome_type !== 'CONVO') return p.outcome_type || 'NO_ANSWER';
  if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') return 'CALLBACK';
  if (p.objection_type === 'NOT INTERESTED') return 'NOT_INTERESTED';
  if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') return 'THINKING';
  return 'CONVO';
}
