-- ============================================
-- TEAM COVERAGE MAP FEATURES (v2)
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Add lat/lng columns to knock_events if they don't exist
alter table public.knock_events
add column if not exists lat real,
add column if not exists lng real;

-- 2. Rewrite the Team Coverage View to read from the events table directly.
--
-- WHY: The old view read from knock_events.lat / knock_events.lng which were
-- only populated for knocks logged AFTER the column was added. All historical
-- knocks have their coordinates buried in the JSON payload of the events table.
-- Reading from events directly gives us 100% of all-time team data.
--
-- The view deduplicates by address, keeping the LATEST outcome per property.
create or replace view public.team_property_coverage as
select distinct on (
  lower(trim(
    coalesce(payload->>'house_number', '') || ' ' ||
    coalesce(payload->>'street_name', '')
  ))
)
  lower(trim(
    coalesce(payload->>'house_number', '') || ' ' ||
    coalesce(payload->>'street_name', '')
  ))                                          as address_key,
  payload->>'house_number'                    as house_number,
  payload->>'street_name'                     as street_name,
  (payload->>'timestamp')::timestamptz        as last_knocked_at,
  payload->>'outcome_type'                    as outcome_type,
  payload->>'convo_status'                    as convo_status,
  payload->>'objection_type'                  as objection_type,
  (payload->>'lat')::real                     as lat,
  (payload->>'lng')::real                     as lng,
  rep_id
from public.events
where
  type = 'KNOCK'
  and (payload->>'lat') is not null
  and (payload->>'lng') is not null
  and trim(
    coalesce(payload->>'house_number', '') || ' ' ||
    coalesce(payload->>'street_name', '')
  ) != ''
order by
  lower(trim(
    coalesce(payload->>'house_number', '') || ' ' ||
    coalesce(payload->>'street_name', '')
  )),
  (payload->>'timestamp')::timestamptz desc nulls last;

-- 3. Ensure authenticated users can query this view
grant select on public.team_property_coverage to authenticated;
