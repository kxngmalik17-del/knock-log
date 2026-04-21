-- ============================================
-- RUN THIS IN YOUR SUPABASE SQL EDITOR
-- Creates the events table + projection trigger
-- ============================================

-- 1. Events Table (Anti-Gravity Outbox Destination)
create table if not exists public.events (
  event_id uuid primary key,
  rep_id uuid references auth.users(id) on delete cascade not null,
  type text not null,
  payload jsonb not null,
  created_at timestamp with time zone default now()
);

alter table public.events enable row level security;

create policy "events_select_own" on public.events 
  for select using (auth.uid() = rep_id);
create policy "events_insert_own" on public.events 
  for insert with check (auth.uid() = rep_id);

-- 2. Index for fast sync queries
create index if not exists idx_events_rep_created
  on public.events (rep_id, created_at desc);

-- 3. Trigger to project events into legacy tables
create or replace function project_event_to_legacy()
returns trigger as $$
begin
  if new.type = 'DAY_START' then
    insert into public.day_sessions (id, rep_id, session_date, start_time, status)
    values (
      (new.payload->>'session_id')::uuid,
      new.rep_id,
      (new.payload->>'session_date')::date,
      (new.payload->>'start_time')::timestamp with time zone,
      'OPEN'
    ) on conflict (id) do nothing;
  
  elsif new.type = 'DAY_END' then
    update public.day_sessions
    set status = 'CLOSED',
        end_time = (new.payload->>'end_time')::timestamp with time zone,
        export_status = new.payload->>'export_status',
        export_url = new.payload->>'export_url'
    where id = (new.payload->>'session_id')::uuid;

  elsif new.type = 'KNOCK' then
    insert into public.knock_events (
      id, rep_id, session_id, street_name, house_number, timestamp, 
      outcome_type, convo_status, objection_type, callback_time,
      lat, lng
    ) values (
      new.event_id,
      new.rep_id,
      (new.payload->>'session_id')::uuid,
      new.payload->>'street_name',
      new.payload->>'house_number',
      (new.payload->>'timestamp')::timestamp with time zone,
      new.payload->>'outcome_type',
      new.payload->>'convo_status',
      new.payload->>'objection_type',
      (new.payload->>'callback_time')::timestamp with time zone,
      (new.payload->>'lat')::real,
      (new.payload->>'lng')::real
    ) on conflict (id) do nothing;

  elsif new.type = 'BREAK_START' then
    insert into public.break_sessions (id, rep_id, session_id, break_start_time)
    values (
      (new.payload->>'break_id')::uuid,
      new.rep_id,
      (new.payload->>'session_id')::uuid,
      (new.payload->>'break_start_time')::timestamp with time zone
    ) on conflict (id) do nothing;

  elsif new.type = 'BREAK_END' then
    update public.break_sessions
    set break_end_time = (new.payload->>'break_end_time')::timestamp with time zone,
        duration = (new.payload->>'duration')::integer
    where id = (new.payload->>'break_id')::uuid;
  
  end if;

  return new;
end;
$$ language plpgsql;

-- Drop if exists to avoid conflict
drop trigger if exists trg_project_event on public.events;

create trigger trg_project_event
after insert on public.events
for each row execute function project_event_to_legacy();
