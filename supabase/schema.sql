-- ============================================
-- KnockLog — Supabase Schema & RLS Policies
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Reps profile table
create table if not exists public.reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  display_name text not null,
  created_at timestamp with time zone default now()
);

-- 2. Knocks table
create table if not exists public.knocks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  user_id uuid references auth.users(id) on delete cascade not null,
  rep_name text not null,
  outcome text not null,
  objection text
);

-- 3. Enable RLS
alter table public.reps enable row level security;
alter table public.knocks enable row level security;

-- 4. RLS Policies — Reps
-- Users can read their own profile
create policy "Users can view own profile"
  on public.reps for select
  using (auth.uid() = user_id);

-- Users can insert their own profile
create policy "Users can create own profile"
  on public.reps for insert
  with check (auth.uid() = user_id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.reps for update
  using (auth.uid() = user_id);

-- 5. RLS Policies — Knocks
-- Users can read their own knocks
create policy "Users can view own knocks"
  on public.knocks for select
  using (auth.uid() = user_id);

-- Users can insert their own knocks
create policy "Users can insert own knocks"
  on public.knocks for insert
  with check (auth.uid() = user_id);

-- 6. Indexes for performance
create index if not exists idx_knocks_user_created
  on public.knocks (user_id, created_at desc);

create index if not exists idx_reps_user_id
  on public.reps (user_id);
