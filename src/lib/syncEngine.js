import { supabase } from './supabase';
import { 
  getPendingEvents, 
  markEventSynced, 
  incrementEventRetry,
  getSyncTimestamp,
  updateSyncTimestamp,
  sqlocal,
  insertLocalEvent
} from './db';

const SYNC_INTERVAL_MS = 15000; // 15 seconds (battery-optimized)
const MAX_RETRIES = 5;

class SyncEngine {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.userId = null;
    this.listeners = new Set();
  }

  setUserId(id) {
    this.userId = id;
  }

  start() {
    if (this.intervalId) return;
    console.log('[SyncEngine] Started.');
    this.intervalId = setInterval(() => this.runSync(), SYNC_INTERVAL_MS);
    // Run immediately on start
    this.runSync();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[SyncEngine] Stopped.');
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (let callback of this.listeners) {
      callback();
    }
  }

  async runSync() {
    if (this.isRunning || !navigator.onLine || !this.userId) return;
    this.isRunning = true;
    
    try {
      await this.pushPendingEvents();
    } catch (err) {
      console.error('[SyncEngine] Sync cycle error:', err);
    } finally {
      this.notify();
      this.isRunning = false;
    }
  }

  async pushPendingEvents() {
    const pending = await getPendingEvents();
    if (pending.length === 0) return;

    console.log(`[SyncEngine] Found ${pending.length} pending events to sync.`);

    // Batch process: 25 at a time for faster round-trips
    const batchSize = 25;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      
      const payload = batch.map(e => ({
        event_id: e.event_id,
        rep_id: this.userId,
        type: e.type,
        payload: JSON.parse(e.payload),
        created_at: e.created_at
      }));

      // Use upsert to prevent duplicates on retries
      const { error } = await supabase
        .from('events')
        .upsert(payload, { onConflict: 'event_id' });

      if (error) {
        console.error('[SyncEngine] Batch sync failed:', error);
        // Mark retries concurrently instead of sequentially
        await Promise.all(batch.map(e => incrementEventRetry(e.event_id)));
      } else {
        // Mark synced concurrently instead of sequentially
        await Promise.all(batch.map(e => markEventSynced(e.event_id)));
        console.log(`[SyncEngine] Successfully synced batch of ${batch.length} events.`);
      }
    }
  }

  // Not implemented strictly as we rely entirely on local state
  // If we wanted multi-device sync, we'd implement downloadDelta here.
  async pullDeltaEvents() {
    const lastSync = await getSyncTimestamp();
    // delta logic ... (omitted since priority is outbox)
  }
}

export const syncEngine = new SyncEngine();
