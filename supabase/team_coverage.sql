-- ============================================
-- TEAM COVERAGE MAP FEATURES
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Add lat/lng columns to knock_events if they don't exist
alter table public.knock_events 
add column if not exists lat real,
add column if not exists lng real;

-- Optional: Populate existing lat/lng from events table payload (if history exists)
-- This backfills the new columns from the raw JSON payloads
update public.knock_events ke
set lat = (e.payload->>'lat')::real,
    lng = (e.payload->>'lng')::real
from public.events e
where ke.id = e.event_id
  and (ke.lat is null or ke.lng is null)
  and e.payload->>'lat' is not null;

-- 2. Create a View for the Team Coverage Map
-- This returns the LATEST status and coordinates for every unique address knocked by ANY rep.
create or replace view public.team_property_coverage as
select distinct on (lower(trim(house_number || ' ' || street_name)))
  lower(trim(house_number || ' ' || street_name)) as address_key,
  house_number,
  street_name,
  timestamp as last_knocked_at,
  outcome_type,
  convo_status,
  objection_type,
  lat,
  lng,
  rep_id
from public.knock_events
where lat is not null and lng is not null
order by lower(trim(house_number || ' ' || street_name)), timestamp desc;

-- Ensure authenticated users can query this view
grant select on public.team_property_coverage to authenticated;
