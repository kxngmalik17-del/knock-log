-- ============================================
-- TEAM MAP FEATURES — Street Claims + Team Pins
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Street Claims Table (max 2 reps per street)
create table if not exists public.street_claims (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid references auth.users(id) on delete cascade not null,
  rep_name text not null default '',
  street_name text not null,
  street_center_lat real,
  street_center_lng real,
  session_date date not null default current_date,
  claimed_at timestamp with time zone default now()
);

-- Unique constraint: one rep can only claim a street once per day
create unique index if not exists idx_street_claims_unique
  on public.street_claims (rep_id, street_name, session_date);

-- Index for fast lookups
create index if not exists idx_street_claims_date
  on public.street_claims (session_date, street_name);

alter table public.street_claims enable row level security;

-- All authenticated users can see all street claims (team visibility)
create policy "street_claims_select_all" on public.street_claims
  for select using (true);

-- Users can only insert their own claims
create policy "street_claims_insert_own" on public.street_claims
  for insert with check (auth.uid() = rep_id);

-- Users can only delete their own claims
create policy "street_claims_delete_own" on public.street_claims
  for delete using (auth.uid() = rep_id);

-- 2. Allow all authenticated users to READ knock_events (for ghost pins / team view)
-- NOTE: The existing RLS policy only allows own reads.
-- We add a new policy for team-wide SELECT access.
create policy "knock_events_select_all_team" on public.knock_events
  for select using (true);

-- 3. Allow all authenticated users to READ events (for team view)
create policy "events_select_all_team" on public.events
  for select using (true);

-- 4. Allow all authenticated users to read reps (for display names)
create policy "reps_select_all_team" on public.reps
  for select using (true);
