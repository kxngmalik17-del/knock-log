import { supabase } from './supabase';
import { modeOf, MODES, resolveStatus } from '../config/modes';

/**
 * TEAM SERVICE
 * Handles fetching team knock data for ghost pins, street claims, leaderboard, and all-time coverage.
 */

/**
 * Fetch today's knock events from ALL reps on the team (excluding the current user).
 * Returns GeoJSON suitable for the ghost pin layer.
 * @param {string} currentUserId
 * @param {string|null} filterMode - 'RESIDENTIAL' | 'COMMERCIAL' | null (all)
 */
export async function getTeamGeoJSON(currentUserId, filterMode = null) {
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
    const mode = modeOf(p);
    if (filterMode !== null && mode !== filterMode) continue;

    const address = `${p.house_number || ''} ${p.street_name || ''}`.trim();
    if (!address || !p.lat || !p.lng) continue;

    const key = (mode === MODES.COMMERCIAL && p.target_key)
      ? 'comm_' + p.target_key
      : address.toLowerCase();

    let resolvedStatus = resolveStatus(p);

    propMap[key] = {
      address, lat: p.lat, lng: p.lng, last_status: resolvedStatus,
      mode,
      business_name: p.business_name || null,
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
        mode: p.mode, business_name: p.business_name,
        last_knocked_at: p.last_knocked_at, rep_name: p.rep_name, is_ghost: 1,
      }
    }))
  };
}



/**
 * Fetch ALL-TIME team coverage across every rep.
 * Reads from the team_property_coverage view — latest status per unique address.
 * Returns GeoJSON for the Team Coverage Map.
 * @param {string|null} filterMode - 'RESIDENTIAL' | 'COMMERCIAL' | null
 */
export async function getTeamCoverageGeoJSON(filterMode = null) {
  // If COMMERCIAL, fetch directly from commercial_opportunities & knock_events for accurate pipeline stage and target keys
  if (filterMode === MODES.COMMERCIAL) {
    const [oppsRes, knocksRes] = await Promise.all([
      supabase.from('commercial_opportunities').select('*'),
      supabase.from('knock_events').select('*').eq('mode', 'commercial').not('lat', 'is', null)
    ]);

    const features = [];
    const seen = new Set();

    if (oppsRes.data) {
      for (const o of oppsRes.data) {
        if (!o.lat || !o.lng) continue;
        const key = `${o.company_name || ''}_${o.address || ''}_${o.unit_number || ''}`.toLowerCase();
        seen.add(key);

        let uiStage = 'COLD';
        const s = (o.stage || '').toLowerCase();
        if (s === 'walkthrough_scheduled' || s === 'walkthrough_booked') uiStage = 'WALKTHROUGH_BOOKED';
        else if (s === 'proposal_sent' || s === 'quoted') uiStage = 'QUOTED';
        else if (s === 'won') uiStage = 'WON';
        else if (s === 'lost') uiStage = 'LOST';
        else if (s === 'dm_identified') uiStage = 'DM_IDENTIFIED';
        else if (s === 'contacted') uiStage = 'CONTACTED';
        else if (LEAD_STAGES.includes(o.stage)) uiStage = o.stage;

        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
          properties: {
            address: o.address || '',
            business_name: o.company_name || '',
            suite: o.unit_number || '',
            last_status: uiStage,
            stage: uiStage,
            last_knocked_at: o.updated_at || o.created_at,
            mode: MODES.COMMERCIAL,
          }
        });
      }
    }

    if (knocksRes.data) {
      for (const k of knocksRes.data) {
        if (!k.lat || !k.lng) continue;
        const bName = k.company_name || k.business_name || '';
        const key = `${bName}_${k.street_name || ''}_${k.unit_number || ''}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [k.lng, k.lat] },
          properties: {
            address: `${k.house_number ? k.house_number + ' ' : ''}${k.street_name || ''}`.trim(),
            business_name: bName,
            suite: k.unit_number || '',
            last_status: k.outcome_type,
            stage: k.outcome_type === 'WALKTHROUGH_BOOKED' ? 'WALKTHROUGH_BOOKED' : 'COLD',
            last_knocked_at: k.timestamp || k.created_at,
            mode: MODES.COMMERCIAL,
          }
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }

  const allRows = [];
  const PAGE_SIZE = 1000;
  let from = 0;

  // Supabase caps responses at 1,000 rows by default — paginate until exhausted
  while (true) {
    let query = supabase
      .from('team_property_coverage')
      .select('house_number, street_name, last_knocked_at, outcome_type, convo_status, objection_type, lat, lng');

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('[TeamService] Failed to fetch team coverage:', error);
      break;
    }

    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }

  // Filter by mode if requested (team_property_coverage is residential unless commercial outcome types present)
  const filteredRows = allRows.filter(row => {
    if (!filterMode) return true;
    const isCommercial = ['GATEKEEPER', 'DECISION_MAKER', 'WALKTHROUGH_BOOKED'].includes(row.outcome_type);
    const rowMode = isCommercial ? MODES.COMMERCIAL : MODES.RESIDENTIAL;
    return rowMode === filterMode;
  });

  return {
    type: 'FeatureCollection',
    features: filteredRows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      properties: {
        address: `${row.house_number || ''} ${row.street_name || ''}`.trim(),
        last_status: resolveStatus({ outcome_type: row.outcome_type, convo_status: row.convo_status, objection_type: row.objection_type }),
        last_knocked_at: row.last_knocked_at,
        mode: filterMode || MODES.RESIDENTIAL,
      }
    }))
  };
}


/**
 * Fetch leaderboard stats for a given date (or week, yesterday, all-time).
 * @param {string} dateStr - 'TODAY' | 'YESTERDAY' | 'ALL_TIME' | 'WEEK' | 'YYYY-MM-DD'
 * @param {string} filterMode - 'RESIDENTIAL' | 'COMMERCIAL' (defaults to RESIDENTIAL)
 * Returns array sorted by primary metric.
 *   Residential: { rep_id, rep_name, doors, convos, sales, close_rate, dph, revenue }
 *   Commercial:  { rep_id, rep_name, targets, dm_reached, walkthroughs, reach_rate, dph }
 */
export async function getTeamStats(dateStr = 'TODAY', filterMode = MODES.RESIDENTIAL) {
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

  // Helper for pagination
  const fetchAllKnocks = async () => {
    const allData = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      let q = supabase.from('events').select('rep_id, payload').eq('type', 'KNOCK');
      if (!allTime) q = q.gte('created_at', startISO).lt('created_at', endISO);
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      allData.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return allData;
  };

  const fetchAllSessions = async () => {
    const allData = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      let q = supabase.from('events').select('rep_id, type, payload').in('type', ['DAY_START', 'DAY_END']);
      if (!allTime) q = q.gte('created_at', startISO).lt('created_at', endISO);
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      allData.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return allData;
  };

  // Fetch knocks + session events in parallel
  const [knockResData, sessionResData, repsRes] = await Promise.all([
    fetchAllKnocks(),
    fetchAllSessions(),
    supabase.from('reps').select('user_id, display_name'),
  ]);



  const repNameMap = {};
  const nameToIdMap = {};
  (repsRes.data || []).forEach(r => { 
    repNameMap[r.user_id] = r.display_name; 
    nameToIdMap[r.display_name.toLowerCase()] = r.user_id;
  });

  // Build session hours per rep
  const sessionHours = {};
  const sessionStarts = {};
  for (const row of sessionResData) {
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

  for (const row of knockResData) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const knockMode = modeOf(p);
    // Strict mode filter: skip events that don't belong to the requested mode
    if (knockMode !== filterMode) continue;

    const rid = row.rep_id;
    // Stable target key for deduplication
    const targetKey = (knockMode === MODES.COMMERCIAL && p.target_key)
      ? p.target_key
      : `${p.house_number || ''} ${p.street_name || ''}`.trim().toLowerCase();
    if (!targetKey) continue;

    const resolvedStatus = resolveStatus(p);

    // Rep override for residential sales
    let eventRid = rid;
    if (knockMode === MODES.RESIDENTIAL && resolvedStatus === 'SALE' && p.sale_details?.rep_override) {
      const overrideStr = p.sale_details.rep_override.trim();
      if (overrideStr) {
        const matchId = nameToIdMap[overrideStr.toLowerCase()];
        if (matchId) {
          eventRid = matchId;
        } else {
          eventRid = 'override_' + overrideStr.toLowerCase();
          repNameMap[eventRid] = overrideStr;
        }
      }
    }

    if (!repData[eventRid]) {
      if (filterMode === MODES.COMMERCIAL) {
        repData[eventRid] = { rep_id: eventRid, rep_name: repNameMap[eventRid] || 'Rep', targets: 0, dm_reached: 0, walkthroughs: 0 };
      } else {
        repData[eventRid] = { rep_id: eventRid, rep_name: repNameMap[eventRid] || 'Rep', doors: 0, convos: 0, sales: 0 };
      }
      seenAddresses[eventRid] = new Set();
    }

    if (filterMode === MODES.COMMERCIAL) {
      // Count unique business targets
      if (!seenAddresses[eventRid].has(targetKey)) {
        seenAddresses[eventRid].add(targetKey);
        repData[eventRid].targets++;
      }
      if (resolvedStatus === 'WALKTHROUGH_BOOKED') {
        repData[eventRid].walkthroughs++;
      } else if (['DECISION_MAKER', 'DM_INTERESTED', 'HAS_VENDOR', 'LANDLORD', 'NOT_NOW', 'NOT_INTERESTED', 'NO_SOLICITING'].includes(resolvedStatus)) {
        repData[eventRid].dm_reached++;
      }
    } else {
      // Residential: count unique doors
      if (!seenAddresses[eventRid].has(targetKey)) {
        seenAddresses[eventRid].add(targetKey);
        repData[eventRid].doors++;
      }
      if (resolvedStatus === 'SALE') {
        if (p.sale_details?.job_status === 'CANCELLED') {
          repData[eventRid].convos++;
        } else {
          repData[eventRid].sales++;
          if (p.sale_details?.job_total) {
            const num = parseFloat(String(p.sale_details.job_total).replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) repData[eventRid].revenue = (repData[eventRid].revenue || 0) + num;
          }
        }
      } else if (['CONVO', 'CALLBACK', 'THINKING'].includes(resolvedStatus)) {
        repData[eventRid].convos++;
      }
    }
  }

  if (filterMode === MODES.COMMERCIAL) {
    return Object.values(repData)
      .map(r => ({
        ...r,
        reach_rate: r.targets > 0 ? ((r.dm_reached / r.targets) * 100).toFixed(1) : '0.0',
        walkthrough_rate: r.targets > 0 ? ((r.walkthroughs / r.targets) * 100).toFixed(1) : '0.0',
        dph: sessionHours[r.rep_id] ? (r.targets / sessionHours[r.rep_id]).toFixed(1) : null,
      }))
      .sort((a, b) => b.walkthroughs - a.walkthroughs || b.dm_reached - a.dm_reached);
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
 * @param {string|null} filterMode - 'RESIDENTIAL' | 'COMMERCIAL' | null
 */
export async function getTeamActivity(filterMode = null) {
  const todayStr = new Date().toISOString().split('T')[0];

  const events = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('rep_id, payload, created_at')
      .eq('type', 'KNOCK')
      .gte('created_at', todayStr + 'T00:00:00.000Z')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      console.error('[TeamService] Failed to fetch team activity:', error);
      break;
    }
    events.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const feed = [];
  const radarMap = {};

  for (const row of events) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const itemMode = modeOf(p);
    if (filterMode && itemMode !== filterMode) continue;

    const rid = row.rep_id;
    const repName = repNameMap[rid] || 'Teammate';
    const timestamp = p.timestamp || row.created_at;
    const streetName = p.street_name || 'Unknown Street';
    
    // Determine status
    const status = resolveStatus(p);

    // 1. Build Live Feed (Notable events only)
    const isCommercial = itemMode === MODES.COMMERCIAL;
    const isNotable = isCommercial
      ? ['WALKTHROUGH_BOOKED', 'GATEKEEPER', 'DECISION_MAKER', 'DM_INTERESTED'].includes(status)
      : ['SALE', 'CONVO', 'CALLBACK'].includes(status);

    if (isNotable) {
      const sd = p.sale_details || p.lead_details || null;
      feed.push({
        id: row.created_at + rid,
        rep_id: rid,
        rep_name: repName,
        status: status,
        mode: itemMode,
        job_status: sd?.job_status || (status === 'WALKTHROUGH_BOOKED' ? 'WALKTHROUGH' : 'PREBOOKED'),
        address: `${p.house_number || ''} ${p.street_name || ''}`.trim(),
        business_name: p.business_name || null,
        suite: p.suite || null,
        timestamp: timestamp,
        sale_details: sd,
        lead_details: p.lead_details || null,
      });
    }

    // 2. Build Team Radar (Only the most recent knock per rep)
    if (!radarMap[rid] || timestamp > radarMap[rid].timestamp) {
      radarMap[rid] = {
        rep_id: rid,
        rep_name: repName,
        status: status,
        mode: itemMode,
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
 * Fetch ALL successful sales / won leads from history across ALL reps.
 * This is used for the persistent "Sales Book" / Customer List.
 * @param {string|null} filterMode - 'RESIDENTIAL' | 'COMMERCIAL' | null
 */
export async function getAllSales(filterMode = null) {
  const events = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('event_id, rep_id, payload, created_at')
      .eq('type', 'KNOCK')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      console.error('[TeamService] Failed to fetch all sales:', error);
      break;
    }
    events.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const sales = [];
  for (const row of events) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const itemMode = modeOf(p);
    if (filterMode && itemMode !== filterMode) continue;

    const status = resolveStatus(p);

    if (status === 'SALE' || (itemMode === MODES.COMMERCIAL && status === 'WALKTHROUGH_BOOKED')) {
      sales.push({
        id: row.created_at + row.rep_id,
        event_id: row.event_id,
        rep_id: row.rep_id,
        rep_name: p.sale_details?.rep_override || repNameMap[row.rep_id] || 'Teammate',
        address: `${p.house_number || ''} ${p.street_name || ''}`.trim(),
        business_name: p.business_name || null,
        suite: p.suite || null,
        mode: itemMode,
        timestamp: p.timestamp || row.created_at,
        details: p.sale_details || p.lead_details || {},
        lead_details: p.lead_details || null,
        job_status: p.sale_details?.job_status || (status === 'WALKTHROUGH_BOOKED' ? 'WALKTHROUGH' : 'PREBOOKED'),
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



/**
 * Delete a KNOCK event completely from the database.
 */
export async function deleteSaleEvent(eventId) {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('event_id', eventId);

  if (error) {
    console.error('[TeamService] deleteSaleEvent error:', error);
    throw new Error('Failed to delete sale.');
  }
}
/**
 * Calculate commission based on job total.
 * - $348 and below: 25%
 * - $349 to $400: 30%
 * - $401 and above: 40%
 */
export function calculateCommission(amount) {
  if (!amount) return 0;
  // Handle strings like "$350" or "350"
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.]/g, ''));
  if (isNaN(num) || num <= 0) return 0;

  let pct = 0.25;
  if (num > 400) pct = 0.40;
  else if (num >= 349) pct = 0.30;

  return num * pct;
}

// ── Phase 2: Commercial Leads & Pipeline Services ───────────────────────────

/**
 * Fetch all persistent commercial leads, sorted by stage and updated_at.
 */
export async function getLeads() {
  if (!navigator.onLine) return [];

  const { data: reps } = await supabase.from('reps').select('user_id, display_name');
  const repNameMap = {};
  (reps || []).forEach(r => { repNameMap[r.user_id] = r.display_name; });

  const { data: opps, error: oppErr } = await supabase
    .from('commercial_opportunities')
    .select('*')
    .order('updated_at', { ascending: false });

  if (oppErr) {
    console.warn('[TeamService] getLeads commercial_opportunities error:', oppErr);
  }

  const leads = (opps || []).map(o => {
    let uiStage = 'COLD';
    const s = (o.stage || '').toLowerCase();
    if (s === 'walkthrough_scheduled' || s === 'walkthrough_booked') uiStage = 'WALKTHROUGH_BOOKED';
    else if (s === 'proposal_sent' || s === 'quoted') uiStage = 'QUOTED';
    else if (s === 'won') uiStage = 'WON';
    else if (s === 'lost') uiStage = 'LOST';
    else if (s === 'dm_identified') uiStage = 'DM_IDENTIFIED';
    else if (s === 'contacted') uiStage = 'CONTACTED';
    else if (s === 'knocked' || s === 'cold' || s === 'identified') uiStage = 'COLD';
    else if (LEAD_STAGES.includes(o.stage)) uiStage = o.stage;

    return {
      id: o.id,
      target_key: `${o.company_name || ''}_${o.address || ''}_${o.unit_number || ''}`,
      business_name: o.company_name,
      company_name: o.company_name,
      address: o.address || '',
      suite: o.unit_number || '',
      city: o.city || 'Toronto',
      lat: o.lat,
      lng: o.lng,
      stage: uiStage,
      contacts: o.dm_name ? [{ name: o.dm_name, title: o.dm_title || '', phone: o.dm_phone || '', email: o.dm_email || '' }] : [],
      est_monthly_value: o.expected_mrr,
      owner_name: repNameMap[o.created_by_rep_id] || 'Team Lead',
      owner_rep_id: o.created_by_rep_id,
      notes: o.gatekeeper_notes || o.lost_reason || '',
      walkthrough_at: o.walkthrough_date,
      cleaning_frequency: o.cleaning_frequency,
      square_footage: o.square_footage,
      competitor_vendor: o.competitor_vendor,
      created_at: o.created_at,
      updated_at: o.updated_at,
    };
  });

  return leads;
}

/**
 * Update a lead's stage and record the change.
 */
export async function updateLeadStage(leadId, newStage, updatedFields = {}) {
  const stageMap = {
    'COLD': 'knocked',
    'CONTACTED': 'contacted',
    'DM_IDENTIFIED': 'dm_identified',
    'WALKTHROUGH_BOOKED': 'walkthrough_scheduled',
    'QUOTED': 'proposal_sent',
    'WON': 'won',
    'LOST': 'lost',
  };
  const dbStage = stageMap[newStage] || newStage.toLowerCase();

  const { error } = await supabase
    .from('commercial_opportunities')
    .update({
      stage: dbStage,
      updated_at: new Date().toISOString(),
      ...(updatedFields.business_name ? { company_name: updatedFields.business_name } : {}),
      ...(updatedFields.est_monthly_value !== undefined ? { expected_mrr: updatedFields.est_monthly_value } : {}),
      ...(updatedFields.notes !== undefined ? { gatekeeper_notes: updatedFields.notes } : {}),
      ...(updatedFields.next_follow_up_at !== undefined ? { walkthrough_date: updatedFields.next_follow_up_at } : {}),
    })
    .eq('id', leadId);

  if (error) {
    console.error('[TeamService] updateLeadStage error:', error);
    throw new Error('Failed to update stage.');
  }
}

/**
 * Update any lead details (contact, notes, estimate, follow-up, etc).
 */
export async function updateLeadDetails(leadId, updates) {
  const { error } = await supabase
    .from('commercial_opportunities')
    .update({
      updated_at: new Date().toISOString(),
      ...(updates.business_name ? { company_name: updates.business_name } : {}),
      ...(updates.est_monthly_value !== undefined ? { expected_mrr: updates.est_monthly_value } : {}),
      ...(updates.notes !== undefined ? { gatekeeper_notes: updates.notes } : {}),
      ...(updates.walkthrough_date !== undefined ? { walkthrough_date: updates.walkthrough_date } : {}),
    })
    .eq('id', leadId);

  if (error) {
    console.error('[TeamService] updateLeadDetails error:', error);
    throw new Error('Failed to update details.');
  }
}

/**
 * Fetch follow-ups due today or overdue for commercial pre-session radar.
 */
export async function getCommercialFollowUps() {
  if (!navigator.onLine) return [];

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('commercial_opportunities')
    .select('*')
    .lte('walkthrough_date', todayEnd.toISOString())
    .neq('stage', 'won')
    .neq('stage', 'lost')
    .order('walkthrough_date', { ascending: true })
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map(o => ({
    id: o.id,
    business_name: o.company_name,
    address: o.address,
    suite: o.unit_number,
    lat: o.lat,
    lng: o.lng,
    walkthrough_at: o.walkthrough_date,
    est_monthly_value: o.expected_mrr,
    notes: o.gatekeeper_notes,
    stage: o.stage,
  }));
}


