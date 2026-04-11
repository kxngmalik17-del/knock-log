-- ============================================
-- KnockLog v1 — Anti-Gravity Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Reps profile table
create table if not exists public.reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  display_name text not null,
  created_at timestamp with time zone default now()
);

-- 2. Day sessions
create table if not exists public.day_sessions (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid references auth.users(id) on delete cascade not null,
  session_date date not null default current_date,
  start_time timestamp with time zone default now(),
  end_time timestamp with time zone,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  export_status text default 'PENDING',
  export_url text
);

-- 3. Knock events (immutable)
create table if not exists public.knock_events (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.day_sessions(id) on delete cascade not null,
  street_name text not null,
  house_number text,
  timestamp timestamp with time zone default now(),
  outcome_type text not null check (outcome_type in ('NO_ANSWER', 'CONVO', 'SALE')),
  convo_status text,
  objection_type text,
  callback_time timestamp with time zone
);

-- 4. Break sessions
create table if not exists public.break_sessions (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid references auth.users(id) on delete cascade not null,
  session_id uuid references public.day_sessions(id) on delete cascade not null,
  break_start_time timestamp with time zone default now(),
  break_end_time timestamp with time zone,
  duration integer -- seconds, computed on close
);

-- 5. Enable RLS on all tables
alter table public.reps enable row level security;
alter table public.day_sessions enable row level security;
alter table public.knock_events enable row level security;
alter table public.break_sessions enable row level security;

-- 6. RLS Policies — Reps
create policy "reps_select_own" on public.reps
  for select using (auth.uid() = user_id);
create policy "reps_insert_own" on public.reps
  for insert with check (auth.uid() = user_id);
create policy "reps_update_own" on public.reps
  for update using (auth.uid() = user_id);

-- 7. RLS Policies — Day Sessions
create policy "sessions_select_own" on public.day_sessions
  for select using (auth.uid() = rep_id);
create policy "sessions_insert_own" on public.day_sessions
  for insert with check (auth.uid() = rep_id);
create policy "sessions_update_own" on public.day_sessions
  for update using (auth.uid() = rep_id);

-- 8. RLS Policies — Knock Events
create policy "events_select_own" on public.knock_events
  for select using (auth.uid() = rep_id);
create policy "events_insert_own" on public.knock_events
  for insert with check (auth.uid() = rep_id);

-- 9. RLS Policies — Break Sessions
create policy "breaks_select_own" on public.break_sessions
  for select using (auth.uid() = rep_id);
create policy "breaks_insert_own" on public.break_sessions
  for insert with check (auth.uid() = rep_id);
create policy "breaks_update_own" on public.break_sessions
  for update using (auth.uid() = rep_id);

-- 10. Indexes
create index if not exists idx_sessions_rep_date
  on public.day_sessions (rep_id, session_date desc);
create index if not exists idx_events_session
  on public.knock_events (session_id, timestamp desc);
create index if not exists idx_events_rep
  on public.knock_events (rep_id, timestamp desc);
create index if not exists idx_breaks_session
  on public.break_sessions (session_id);
create index if not exists idx_reps_user_id
  on public.reps (user_id);

-- 11. Create storage bucket for exports
insert into storage.buckets (id, name, public) 
values ('exports', 'exports', false) 
on conflict do nothing;

create policy "Users can upload their own exports" 
on storage.objects for insert 
with check ( bucket_id = 'exports' and auth.uid() = owner );

create policy "Users can view their own exports" 
on storage.objects for select 
using ( bucket_id = 'exports' and auth.uid() = owner );
