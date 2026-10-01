-- ============================================
-- TEAM MAP FEATURES — Enable Deleting Sales
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Allow all authenticated users to DELETE events (for deleting sales from the team dashboard)
-- We use "true" so any rep can delete any sale on the board.
create policy "events_delete_all_team" on public.events
  for delete using (true);
