-- ============================================
-- TEAM MAP FEATURES — Enable Editing Sales
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Allow all authenticated users to UPDATE events (for editing sales from the team dashboard)
-- We use "true" so any rep can edit any sale on the board.
create policy "events_update_all_team" on public.events
  for update using (true);
