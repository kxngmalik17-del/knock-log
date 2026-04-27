/**
 * ONE-TIME MIGRATION: Re-geocode scattered pins back to GTA
 *
 * Finds all KNOCK events whose lat/lng falls outside the GTA bounding box,
 * re-geocodes them via Mapbox with Toronto bias, and updates the payload.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !MAPBOX_TOKEN) {
  console.error('Missing env vars. Run with: node --env-file=.env.local scripts/fix-scattered-pins.mjs');
  process.exit(1);
}

// GTA bounding box
const BBOX = { minLng: -80.8, minLat: 42.9, maxLng: -78.5, maxLat: 44.4 };

function isOutsideGTA(lat, lng) {
  return lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng;
}

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || '',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function geocode(address) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1&country=ca&proximity=-79.3832,43.6532&bbox=-80.8,42.9,-78.5,44.4`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.features && data.features.length > 0) {
    return { lat: data.features[0].center[1], lng: data.features[0].center[0] };
  }
  return null;
}

// Rate-limit helper: wait ms between calls
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('🔍 Fetching all KNOCK events from Supabase...');

  // Fetch all knock events (paginate with limit)
  let allEvents = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const batch = await supaFetch(
      `events?type=eq.KNOCK&select=event_id,payload&offset=${offset}&limit=${pageSize}`
    );
    if (!batch || batch.length === 0) break;
    allEvents = allEvents.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`📦 Total KNOCK events: ${allEvents.length}`);

  // Find events outside GTA
  const scattered = [];
  for (const row of allEvents) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!p.lat || !p.lng) continue;
    if (isOutsideGTA(parseFloat(p.lat), parseFloat(p.lng))) {
      scattered.push({ event_id: row.event_id, payload: p });
    }
  }

  console.log(`🌍 Events outside GTA: ${scattered.length}`);
  if (scattered.length === 0) {
    console.log('✅ Nothing to fix! All pins are within the GTA.');
    return;
  }

  let fixed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < scattered.length; i++) {
    const { event_id, payload } = scattered[i];
    const address = `${payload.house_number || ''} ${payload.street_name || ''}`.trim();

    if (!address) {
      skipped++;
      continue;
    }

    try {
      const coords = await geocode(address);
      if (coords) {
        const updatedPayload = { ...payload, lat: coords.lat, lng: coords.lng };

        await supaFetch(
          `events?event_id=eq.${event_id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ payload: updatedPayload }),
            prefer: 'return=minimal',
          }
        );

        fixed++;
        console.log(`  ✅ [${i + 1}/${scattered.length}] ${address} → (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
      } else {
        failed++;
        console.log(`  ⚠️ [${i + 1}/${scattered.length}] ${address} → No GTA result found`);
      }
    } catch (err) {
      failed++;
      console.log(`  ❌ [${i + 1}/${scattered.length}] ${address} → Error: ${err.message}`);
    }

    // Mapbox free tier: 10 req/sec, so pace at ~5/sec to be safe
    await sleep(200);
  }

  console.log('');
  console.log('═══════════════════════════════');
  console.log(`✅ Fixed:   ${fixed}`);
  console.log(`⚠️  Failed:  ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log('═══════════════════════════════');
  console.log('Done! The team_property_coverage view will automatically reflect the updated coordinates.');
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
