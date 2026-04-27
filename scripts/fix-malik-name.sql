-- Fix Malik's display name (missing from reps table)
INSERT INTO public.reps (user_id, display_name)
VALUES ('07853cdf-ed2c-4f3b-b713-cde7c40e20a1', 'Malik')
ON CONFLICT (user_id) DO UPDATE SET display_name = 'Malik';
