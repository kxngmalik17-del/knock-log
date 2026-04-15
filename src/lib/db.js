import { SQLocal } from 'sqlocal';

export const sqlocal = new SQLocal('knocklog-db.sqlite3');

// Initialize schema on load
export const initLocalSchema = async () => {
  await sqlocal.sql`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `;

  // Properties cache with geo columns (v2 schema)
  await sqlocal.sql`
    CREATE TABLE IF NOT EXISTS properties (
      property_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      last_status TEXT,
      last_knocked_at TEXT,
      last_rep_id TEXT,
      territory_id TEXT,
      knocked_today INTEGER DEFAULT 0
    );
  `;
};

// Insert a generic event into the append-only outbox
export async function insertLocalEvent(event_id, type, payload) {
  const created_at = new Date().toISOString();
  await sqlocal.sql`
    INSERT INTO events (event_id, type, payload, created_at, synced, retry_count)
    VALUES (${event_id}, ${type}, ${JSON.stringify(payload)}, ${created_at}, 0, 0)
  `;
}

// Upsert an event fetched from the remote server
export async function upsertServerEvent(event_id, type, payload, created_at) {
  await sqlocal.sql`
    INSERT INTO events (event_id, type, payload, created_at, synced, retry_count)
    VALUES (${event_id}, ${type}, ${JSON.stringify(payload)}, ${created_at}, 1, 0)
    ON CONFLICT(event_id) DO UPDATE SET 
      synced = 1
  `;
}

// Get pending events
export async function getPendingEvents() {
  return await sqlocal.sql`
    SELECT * FROM events WHERE synced = 0 ORDER BY created_at ASC
  `;
}

// Mark an event as synced
export async function markEventSynced(event_id) {
  return await sqlocal.sql`
    UPDATE events SET synced = 1 WHERE event_id = ${event_id}
  `;
}

// Increment retry count
export async function incrementEventRetry(event_id) {
  return await sqlocal.sql`
    UPDATE events SET retry_count = retry_count + 1 WHERE event_id = ${event_id}
  `;
}

// Helper to get sync state
export async function getSyncTimestamp(key = 'last_sync_timestamp') {
  const result = await sqlocal.sql`SELECT value FROM sync_state WHERE key = ${key}`;
  return result.length > 0 ? result[0].value : null;
}

// Helper to update sync timestamp
export async function updateSyncTimestamp(key = 'last_sync_timestamp', timestamp) {
  if (arguments.length === 1) {
    timestamp = key;
    key = 'last_sync_timestamp';
  }
  await sqlocal.sql`
    INSERT INTO sync_state (key, value)
    VALUES (${key}, ${timestamp})
    ON CONFLICT(key) DO UPDATE SET value = ${timestamp}
  `;
}

// ── Property helpers ──

export async function upsertProperty({ property_id, address, lat, lng, last_status, last_knocked_at, last_rep_id, territory_id, knocked_today }) {
  await sqlocal.sql`
    INSERT INTO properties (property_id, address, lat, lng, last_status, last_knocked_at, last_rep_id, territory_id, knocked_today)
    VALUES (${property_id}, ${address}, ${lat || null}, ${lng || null}, ${last_status}, ${last_knocked_at}, ${last_rep_id || null}, ${territory_id || null}, ${knocked_today || 0})
    ON CONFLICT(property_id) DO UPDATE SET
      lat = COALESCE(${lat || null}, lat),
      lng = COALESCE(${lng || null}, lng),
      last_status = ${last_status},
      last_knocked_at = ${last_knocked_at},
      last_rep_id = ${last_rep_id || null},
      knocked_today = ${knocked_today || 0}
  `;
}

export async function getAllProperties() {
  return await sqlocal.sql`
    SELECT * FROM properties WHERE lat IS NOT NULL AND lng IS NOT NULL
  `;
}

export async function updateLocalEvent(event_id, updatedPayload) {
  await sqlocal.sql`
    UPDATE events 
    SET payload = ${JSON.stringify(updatedPayload)}, synced = 0 
    WHERE event_id = ${event_id}
  `;
}

export async function softDeleteLocalEvent(event_id) {
  // Soft delete by changing type, keeping it in the sync queue
  await sqlocal.sql`
    UPDATE events 
    SET type = 'DELETED', synced = 0 
    WHERE event_id = ${event_id}
  `;
}

initLocalSchema().catch(console.error);
