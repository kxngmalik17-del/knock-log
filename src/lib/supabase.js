import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl && !supabaseAnonKey) {
  throw new Error('Supabase URL AND Anon Key are both missing');
}
if (!supabaseUrl) {
  throw new Error('Supabase URL is missing (NEXT_PUBLIC_SUPABASE_URL)');
}
if (!supabaseAnonKey) {
  throw new Error('Supabase Anon Key is missing (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
