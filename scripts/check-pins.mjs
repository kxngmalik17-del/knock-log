/**
 * DIAGNOSTIC: Check how many events still have lat/lng outside GTA
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars.');
  process.exit(1);
}

const BBOX = { minLng: -80.8, minLat: 42.9, maxLng: -78.5, maxLat: 44.4 };

function isOutsideGTA(lat, lng) {
  return lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng;
}

async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

async function main() {
  // Check events table directly
  console.log('=== Checking events table ===');
  let allEvents = [];
  let offset = 0;
  while (true) {
    const batch = await supaFetch(`events?type=eq.KNOCK&select=event_id,payload&offset=${offset}&limit=1000`);
    if (!batch || batch.length === 0) break;
    allEvents = allEvents.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  
  let outsideCount = 0;
  let noCoords = 0;
  let insideCount = 0;
  const samples = [];
  
  for (const row of allEvents) {
    const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!p.lat || !p.lng) { noCoords++; continue; }
    const lat = parseFloat(p.lat);
    const lng = parseFloat(p.lng);
    if (isOutsideGTA(lat, lng)) {
      outsideCount++;
      if (samples.length < 5) {
        samples.push({ event_id: row.event_id, addr: `${p.house_number} ${p.street_name}`, lat, lng });
      }
    } else {
      insideCount++;
    }
  }
  
  console.log(`Total KNOCK events: ${allEvents.length}`);
  console.log(`Inside GTA: ${insideCount}`);
  console.log(`Outside GTA: ${outsideCount}`);
  console.log(`No coordinates: ${noCoords}`);
  if (samples.length > 0) {
    console.log('\nSample outside-GTA events:');
    samples.forEach(s => console.log(`  ${s.addr} → lat:${s.lat}, lng:${s.lng} (id: ${s.event_id})`));
  }

  // Now check what the view returns
  console.log('\n=== Checking team_property_coverage view ===');
  const viewData = await supaFetch('team_property_coverage?select=address_key,lat,lng&limit=2000');
  let viewOutside = 0;
  let viewInside = 0;
  const viewSamples = [];
  
  for (const row of (viewData || [])) {
    const lat = parseFloat(row.lat);
    const lng = parseFloat(row.lng);
    if (isOutsideGTA(lat, lng)) {
      viewOutside++;
      if (viewSamples.length < 5) {
        viewSamples.push({ addr: row.address_key, lat, lng });
      }
    } else {
      viewInside++;
    }
  }
  
  console.log(`View total rows: ${(viewData || []).length}`);
  console.log(`View inside GTA: ${viewInside}`);
  console.log(`View outside GTA: ${viewOutside}`);
  if (viewSamples.length > 0) {
    console.log('\nSample outside-GTA view rows:');
    viewSamples.forEach(s => console.log(`  ${s.addr} → lat:${s.lat}, lng:${s.lng}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
