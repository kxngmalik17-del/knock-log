import { createClient } from '@supabase/supabase-js';

// Fallback to the provided keys if Vercel env vars are missing or misconfigured.
// It is safe to expose the anon/publishable key in the client, as long as RLS is enabled in the database.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rwuwfevgepigvuihindn.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_JYO2wYAlT2MANkchrYlFfw_CISKaut_';

if (!supabaseUrl && !supabaseAnonKey) {
  throw new Error('Supabase URL AND Anon Key are both missing');
}
if (!supabaseUrl) {
  throw new Error('Supabase URL is missing');
}
if (!supabaseAnonKey) {
  throw new Error('Supabase Anon Key is missing');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
