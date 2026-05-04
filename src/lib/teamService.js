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
  const allRows = [];
  const PAGE_SIZE = 1000;
  let from = 0;

  // Supabase caps responses at 1,000 rows by default — paginate until exhausted
  while (true) {
    const { data, error } = await supabase
      .from('team_property_coverage')
      .select('house_number, street_name, last_knocked_at, outcome_type, convo_status, objection_type, lat, lng')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('[TeamService] Failed to fetch team coverage:', error);
      break;
    }

    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }

  return {
    type: 'FeatureCollection',
    features: allRows.map(row => ({
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
 * Fetch leaderboard stats for a given date (or week, yesterday, all-time).
 * @param {string} dateStr - 'TODAY' | 'YESTERDAY' | 'ALL_TIME' | 'WEEK' | 'YYYY-MM-DD'
 * Returns array of { rep_id, rep_name, doors, convos, sales, close_rate, dph }, sorted by sales.
 */
export async function getTeamStats(dateStr = 'TODAY') {
  let startISO, endISO, allTime = false;

  if (dateStr === 'ALL_TIME') {
    allTime = true;
  } else if (dateStr === 'WEEK') {
    // Monday of current week
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    startISO = monday.toISOString().split('T')[0] + 'T00:00:00.000Z';
    endISO = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0] + 'T00:00:00.000Z';
  } else if (dateStr === 'YESTERDAY') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    startISO = yStr + 'T00:00:00.000Z';
    const next = new Date(yesterday);
    next.setDate(next.getDate() + 1);
    endISO = next.toISOString().split('T')[0] + 'T00:00:00.000Z';
  } else {
    const d = dateStr === 'TODAY' ? new Date().toISOString().split('T')[0] : dateStr;
    startISO = d + 'T00:00:00.000Z';
    const next = new Date(d + 'T00:00:00.000Z');
    next.setDate(next.getDate() + 1);
    endISO = next.toISOString().split('T')[0] + 'T00:00:00.000Z';
  }

  // Build queries — no date filter for ALL_TIME
  const knockQuery = supabase.from('events').select('rep_id, payload').eq('type', 'KNOCK');
  const sessionQuery = supabase.from('events').select('rep_id, type, payload').in('type', ['DAY_START', 'DAY_END']);
  if (!allTime) {
    knockQuery.gte('created_at', startISO).lt('created_at', endISO);
    sessionQuery.gte('created_at', startISO).lt('created_at', endISO);
  }

  // Fetch knocks + session events in parallel
  const [knockRes, sessionRes, repsRes] = await Promise.all([
    knockQuery,
    sessionQuery,
    supabase.from('reps').select('user_id, display_name'),
  ]);

  if (knockRes.error || !knockRes.data) {
    console.error('[TeamService] Failed to fetch team stats:', knockRes.error);
    return [];
  }

  const repNameMap = {};
  (repsRes.data || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  // Build session hours per rep
  const sessionHours = {};
  const sessionStarts = {};
  for (const row of (sessionRes.data || [])) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const rid = row.rep_id;
    if (row.type === 'DAY_START' && p.start_time) {
      sessionStarts[rid] = new Date(p.start_time);
    } else if (row.type === 'DAY_END' && p.end_time && sessionStarts[rid]) {
      const hours = (new Date(p.end_time) - sessionStarts[rid]) / (1000 * 60 * 60);
      sessionHours[rid] = (sessionHours[rid] || 0) + Math.max(0.01, hours);
      delete sessionStarts[rid];
    }
  }
  // For active sessions (no DAY_END yet), use now as end time
  for (const [rid, start] of Object.entries(sessionStarts)) {
    const hours = (new Date() - start) / (1000 * 60 * 60);
    sessionHours[rid] = (sessionHours[rid] || 0) + Math.max(0.01, hours);
  }

  const repData = {};
  const seenAddresses = {};

  for (const row of knockRes.data) {
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
    if (resolvedStatus === 'SALE') {
      repData[rid].sales++;
      // Accumulate revenue from sale_details if present
      if (p.sale_details?.job_total) {
        const num = parseFloat(String(p.sale_details.job_total).replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) repData[rid].revenue = (repData[rid].revenue || 0) + num;
      }
    } else if (['CONVO', 'CALLBACK', 'THINKING'].includes(resolvedStatus)) repData[rid].convos++;
  }

  return Object.values(repData)
    .map(r => ({
      ...r,
      close_rate: r.doors > 0 ? ((r.sales / r.doors) * 100).toFixed(1) : '0.0',
      dph: sessionHours[r.rep_id] ? (r.doors / sessionHours[r.rep_id]).toFixed(1) : null,
      revenue: r.revenue || 0,
    }))
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
      const sd = p.sale_details || null;
      feed.push({
        id: row.created_at + rid,
        rep_id: rid,
        rep_name: repName,
        status: status,
        street_name: streetName,
        timestamp: timestamp,
        sale_details: sd,
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


/**
 * Fetch ALL successful sales from history across ALL reps.
 * This is used for the persistent "Sales Book" / Customer List.
 */
export async function getAllSales() {
  const { data: events, error } = await supabase
    .from('events')
    .select('event_id, rep_id, payload, created_at')
    .eq('type', 'KNOCK')
    .order('created_at', { ascending: false });

  if (error || !events) {
    console.error('[TeamService] Failed to fetch all sales:', error);
    return [];
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const sales = [];
  for (const row of events) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const status = resolveStatus(p);

    if (status === 'SALE') {
      sales.push({
        id: row.created_at + row.rep_id,
        event_id: row.event_id,
        rep_id: row.rep_id,
        rep_name: p.sale_details?.rep_override || repNameMap[row.rep_id] || 'Teammate',
        address: `${p.house_number || ''} ${p.street_name || ''}`.trim(),
        timestamp: p.timestamp || row.created_at,
        details: p.sale_details || {},
      });
    }
  }
  return sales;
}

/**
 * Patch the sale_details of an existing KNOCK event by event_id.
 * Merges updatedDetails into the existing sale_details object.
 */
export async function updateSaleDetails(eventId, updatedDetails) {
  const { data, error: fetchErr } = await supabase
    .from('events')
    .select('payload')
    .eq('event_id', eventId)
    .single();

  if (fetchErr || !data) {
    console.error('[TeamService] updateSaleDetails fetch error:', fetchErr);
    throw new Error('Could not load the event to update.');
  }

  const currentPayload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
  const merged = {
    ...currentPayload,
    sale_details: {
      ...(currentPayload.sale_details || {}),
      ...updatedDetails,
    },
  };

  const { error: updateErr } = await supabase
    .from('events')
    .update({ payload: merged })
    .eq('event_id', eventId);

  if (updateErr) {
    console.error('[TeamService] updateSaleDetails update error:', updateErr);
    throw new Error('Failed to save changes.');
  }
}

// ── Internal helper ──
function resolveStatus(p) {
  if (p.outcome_type !== 'CONVO') return p.outcome_type || 'NO_ANSWER';
  if (p.convo_status === 'CALLBACK' || p.objection_type === 'CALLBACK') return 'CALLBACK';
  if (p.objection_type === 'NOT INTERESTED') return 'NOT_INTERESTED';
  if (p.objection_type === 'NEED TO THINK' || p.objection_type === 'NOT DECISION MAKER') return 'THINKING';
  if (p.objection_type === 'NO SOLICITING') return 'NO_SOLICITING';
  if (p.objection_type === 'CONSTRUCTION') return 'CONSTRUCTION';
  return 'CONVO';
}
