import { supabase } from './supabase';

/**
 * TEAM SERVICE
 * Handles fetching team knock data for ghost pins and street claim management.
 */

const STATUS_COLORS = {
  'NO_ANSWER': '#6b7280',
  'CONVO': '#3b82f6',
  'SALE': '#10b981',
  'NOT_INTERESTED': '#ef4444',
  'CALLBACK': '#f59e0b',
  'THINKING': '#60a5fa',
};

/**
 * Fetch today's knock events from ALL reps on the team (excluding the current user).
 * Returns GeoJSON suitable for the ghost pin layer.
 */
export async function getTeamGeoJSON(currentUserId) {
  const todayStr = new Date().toISOString().split('T')[0];

  // Get today's knock events from all reps
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

  // Get rep names for display
  const { data: reps } = await supabase
    .from('reps')
    .select('user_id, display_name');

  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  // Deduplicate by address (latest wins per property)
  const propMap = {};
  for (const row of knockEvents) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim();
    if (!address || !p.lat || !p.lng) continue;

    const key = address.toLowerCase();

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

    propMap[key] = {
      address,
      lat: p.lat,
      lng: p.lng,
      last_status: resolvedStatus,
      last_knocked_at: p.timestamp || row.created_at,
      rep_name: repNameMap[row.rep_id] || 'Teammate',
      rep_id: row.rep_id,
    };
  }

  return {
    type: 'FeatureCollection',
    features: Object.values(propMap).map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        address: p.address,
        last_status: p.last_status,
        last_knocked_at: p.last_knocked_at,
        rep_name: p.rep_name,
        is_ghost: 1,
      }
    }))
  };
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
 * Claim a street for the current rep.
 * Returns { success, message, claim? }
 */
export async function claimStreet({ repId, repName, streetName, lat, lng }) {
  const todayStr = new Date().toISOString().split('T')[0];

  // Check existing claims for this street today
  const { data: existing, error: fetchError } = await supabase
    .from('street_claims')
    .select('*')
    .eq('street_name', streetName)
    .eq('session_date', todayStr);

  if (fetchError) {
    return { success: false, message: 'Failed to check existing claims.' };
  }

  // Already claimed by this rep?
  if (existing?.some(c => c.rep_id === repId)) {
    return { success: false, message: 'You already claimed this street.' };
  }

  // Max 2 reps per street
  if (existing?.length >= 2) {
    const claimedBy = existing.map(c => c.rep_name || 'Unknown').join(' & ');
    return { success: false, message: `Street is full — claimed by ${claimedBy}.` };
  }

  const { data: claim, error: insertError } = await supabase
    .from('street_claims')
    .insert({
      rep_id: repId,
      rep_name: repName || '',
      street_name: streetName,
      street_center_lat: lat || null,
      street_center_lng: lng || null,
      session_date: todayStr,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return { success: false, message: 'You already claimed this street.' };
    }
    return { success: false, message: 'Failed to claim street.' };
  }

  return { success: true, message: 'Street claimed!', claim };
}

/**
 * Release a street claim.
 */
export async function releaseStreetClaim(claimId) {
  const { error } = await supabase
    .from('street_claims')
    .delete()
    .eq('id', claimId);

  return !error;
}
