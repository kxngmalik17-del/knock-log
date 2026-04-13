import { supabase } from './supabase';
import { sqlocal, upsertServerEvent, getSyncTimestamp, updateSyncTimestamp } from './db';

/**
 * HISTORY DERIVATION SERVICE
 * Strictly reads from local Event Sourcing OPFS SQLite.
 */

// Fetches derived history from local db
export async function getLocalHistory() {
  const rs = await sqlocal.sql`SELECT * FROM events ORDER BY created_at ASC`;
  
  // Fold mechanism to derive sessions
  const sessionsMap = {}; // sessionId -> { started_at, ended_at, status, events: [], total_doors, total_sales, total_convos, ... }
  
  for (let row of rs) {
    const payload = JSON.parse(row.payload);
    
    if (row.type === 'DAY_START') {
      const sId = payload.session_id;
      if (!sessionsMap[sId]) {
        sessionsMap[sId] = {
          session_id: sId,
          session_date: payload.session_date,
          started_at: payload.start_time || row.created_at,
          status: 'ACTIVE',
          events: [], // Holds KNOCK & BREAK events
          total_doors: 0,
          total_sales: 0,
          total_convos: 0,
          territory: []
        };
      }
    } 
    else if (row.type === 'DAY_END') {
      const sId = payload.session_id;
      if (sessionsMap[sId]) {
        sessionsMap[sId].ended_at = payload.end_time || row.created_at;
        sessionsMap[sId].status = 'CLOSED';
        sessionsMap[sId].export_status = payload.export_status;
        sessionsMap[sId].export_url = payload.export_url;
      }
    }
    else if (row.type === 'KNOCK') {
      const sId = payload.session_id;
      if (sessionsMap[sId]) {
        // Build timeline item
        const item = {
          id: payload.event_id,
          type: 'KNOCK',
          time: payload.timestamp,
          address: `${payload.house_number || ''} ${payload.street_name || ''}`.trim(),
          outcome: payload.outcome_type,
          objection: payload.objection_type || payload.convo_status,
          callback_time: payload.callback_time,
          synced: row.synced === 1
        };
        
        sessionsMap[sId].events.push(item);
        
        // Aggregations
        sessionsMap[sId].total_doors += 1;
        if (payload.outcome_type === 'CONVO') sessionsMap[sId].total_convos += 1;
        if (payload.outcome_type === 'SALE') {
            sessionsMap[sId].total_sales += 1;
            sessionsMap[sId].total_convos += 1; // Sales generally imply convos
        }
        
        // Push territory
        const street = payload.street_name;
        if (street && !sessionsMap[sId].territory.includes(street)) {
          sessionsMap[sId].territory.push(street);
        }
      }
    }
    else if (row.type === 'BREAK_START') {
      const sId = payload.session_id;
      if (sessionsMap[sId]) {
        sessionsMap[sId].events.push({
          id: payload.break_id,
          type: 'BREAK',
          time: payload.break_start_time,
          synced: row.synced === 1
        });
      }
    }
    else if (row.type === 'BREAK_END') {
      const sId = payload.session_id;
      if (sessionsMap[sId]) {
        const brk = sessionsMap[sId].events.find(e => e.type === 'BREAK' && e.id === payload.break_id);
        if (brk) {
          brk.duration = payload.duration;
        }
      }
    }
  }

  // Convert map to Array and sort descending by started_at
  const sessions = Object.values(sessionsMap).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  
  // Sort events inside each session chronologically
  sessions.forEach(s => {
    s.events.sort((a, b) => new Date(a.time) - new Date(b.time));
  });

  return sessions;
}

/**
 * PULL SERVER DELTAS
 * Merges missing historic events from Supabase directly into OPFS.
 */
export async function forceSyncHistoryDeltas(repId) {
  if (!navigator.onLine) return;
  
  const lastSyncStr = await getSyncTimestamp('history_sync_timestamp') || '1970-01-01T00:00:00.000Z';
  
  const { data: serverEvents, error } = await supabase
    .from('events')
    .select('*')
    .eq('rep_id', repId)
    .gt('created_at', lastSyncStr)
    .order('created_at', { ascending: true })
    .limit(1000); // Pagination could be added for massive sets

  if (error) {
    console.error("Failed to fetch history deltas:", error);
    return;
  }

  if (serverEvents && serverEvents.length > 0) {
    console.log(`[History] Fetched ${serverEvents.length} remote deltas. Merging to OPFS...`);
    
    for (let event of serverEvents) {
      await upsertServerEvent(event.event_id, event.type, event.payload, event.created_at);
    }
    
    // Update high watermark
    const latestTimestamp = serverEvents[serverEvents.length - 1].created_at;
    await updateSyncTimestamp('history_sync_timestamp', latestTimestamp);
    
    return true; // Indicates new data was fetched
  }
  
  return false;
}
