-- =============================================================
-- KnockLog — Phase 2: Commercial Leads & Pipeline Migration
-- =============================================================

-- 1. Create the persistent leads table
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key text UNIQUE NOT NULL,
  business_name text NOT NULL,
  street_name text NOT NULL,
  house_number text,
  suite text,
  lat real,
  lng real,
  owner_rep_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'COLD'
    CHECK (stage IN ('COLD', 'CONTACTED', 'DM_IDENTIFIED', 'WALKTHROUGH_BOOKED', 'QUOTED', 'WON', 'LOST')),
  stage_updated_at timestamp with time zone DEFAULT now(),
  contacts jsonb DEFAULT '[]'::jsonb, -- array of { name, role, phone, email, notes }
  next_follow_up_at timestamp with time zone,
  est_monthly_value numeric,
  est_sqft integer,
  frequency text,
  services jsonb DEFAULT '[]'::jsonb,
  current_vendor text,
  contract_end text,
  quote_amount numeric,
  parent_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  last_event_id text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Indexes for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_leads_target_key ON public.leads (target_key);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads (stage);
CREATE INDEX IF NOT EXISTS idx_leads_owner_rep_id ON public.leads (owner_rep_id);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON public.leads (next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_parent_lead_id ON public.leads (parent_lead_id);

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view, insert, and update leads
DROP POLICY IF EXISTS "Authenticated reps can read leads" ON public.leads;
CREATE POLICY "Authenticated reps can read leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated reps can insert leads" ON public.leads;
CREATE POLICY "Authenticated reps can insert leads"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated reps can update leads" ON public.leads;
CREATE POLICY "Authenticated reps can update leads"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Stage advancement helper function (prevents regressions)
CREATE OR REPLACE FUNCTION lead_stage_rank(s text) RETURNS integer AS $$
BEGIN
  RETURN CASE s
    WHEN 'COLD' THEN 1
    WHEN 'CONTACTED' THEN 2
    WHEN 'DM_IDENTIFIED' THEN 3
    WHEN 'WALKTHROUGH_BOOKED' THEN 4
    WHEN 'QUOTED' THEN 5
    WHEN 'WON' THEN 6
    WHEN 'LOST' THEN 0 -- Terminal or closed out
    ELSE 1
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Upsert lead on commercial knock events trigger
CREATE OR REPLACE FUNCTION sync_commercial_lead_from_knock()
RETURNS trigger AS $$
DECLARE
  p jsonb;
  t_key text;
  b_name text;
  s_name text;
  h_num text;
  suite_str text;
  out_type text;
  obj_type text;
  new_stage text;
  curr_stage text;
  follow_up timestamp with time zone;
  cb_time timestamp with time zone;
  ld jsonb;
  gk jsonb;
BEGIN
  IF new.type = 'KNOCK' THEN
    p := new.payload;
    IF p->>'mode' = 'COMMERCIAL' THEN
      t_key := p->>'target_key';
      b_name := COALESCE(p->>'business_name', 'Commercial Target');
      s_name := COALESCE(p->>'street_name', '');
      h_num := p->>'house_number';
      suite_str := p->>'suite';
      out_type := p->>'outcome_type';
      obj_type := p->>'objection_type';
      ld := p->'lead_details';
      gk := p->'gatekeeper';

      -- Map knock outcome to target pipeline stage
      IF out_type = 'WALKTHROUGH_BOOKED' THEN
        new_stage := 'WALKTHROUGH_BOOKED';
      ELSIF out_type = 'DECISION_MAKER' THEN
        IF obj_type = 'NOT INTERESTED' OR obj_type = 'NO SOLICITING' THEN
          new_stage := 'LOST';
        ELSE
          new_stage := 'DM_IDENTIFIED';
        END IF;
      ELSIF out_type = 'GATEKEEPER' THEN
        new_stage := 'CONTACTED';
      ELSE
        new_stage := 'COLD';
      END IF;

      -- Check follow-up date
      IF p->>'callback_time' IS NOT NULL THEN
        cb_time := (p->>'callback_time')::timestamp with time zone;
      END IF;

      IF out_type = 'WALKTHROUGH_BOOKED' AND ld->>'walkthrough_at' IS NOT NULL THEN
        follow_up := (ld->>'walkthrough_at')::timestamp with time zone;
      ELSIF cb_time IS NOT NULL THEN
        follow_up := cb_time;
      END IF;

      -- Upsert lead into public.leads table
      IF t_key IS NOT NULL AND t_key != '' THEN
        SELECT stage INTO curr_stage FROM public.leads WHERE target_key = t_key;

        IF curr_stage IS NULL THEN
          -- New lead
          INSERT INTO public.leads (
            target_key, business_name, street_name, house_number, suite,
            lat, lng, owner_rep_id, stage, stage_updated_at,
            next_follow_up_at, est_monthly_value, est_sqft, frequency, services,
            current_vendor, contract_end, last_event_id, notes
          ) VALUES (
            t_key, b_name, s_name, h_num, suite_str,
            (p->>'lat')::real, (p->>'lng')::real, new.rep_id, new_stage, now(),
            follow_up,
            (ld->>'est_monthly_value')::numeric,
            (ld->>'est_sqft')::integer,
            ld->>'frequency',
            COALESCE(ld->'services', '[]'::jsonb),
            ld->>'current_vendor',
            ld->>'contract_end',
            new.event_id,
            p->>'notes'
          ) ON CONFLICT (target_key) DO NOTHING;
        ELSE
          -- Existing lead: advance stage forward only
          IF lead_stage_rank(new_stage) > lead_stage_rank(curr_stage) THEN
            curr_stage := new_stage;
          ELSIF new_stage = 'LOST' AND curr_stage != 'WON' THEN
            curr_stage := 'LOST';
          END IF;

          UPDATE public.leads
          SET
            business_name = COALESCE(NULLIF(b_name, 'Commercial Target'), business_name),
            suite = COALESCE(suite_str, suite),
            lat = COALESCE((p->>'lat')::real, lat),
            lng = COALESCE((p->>'lng')::real, lng),
            stage = curr_stage,
            stage_updated_at = now(),
            next_follow_up_at = COALESCE(follow_up, next_follow_up_at),
            est_monthly_value = COALESCE((ld->>'est_monthly_value')::numeric, est_monthly_value),
            est_sqft = COALESCE((ld->>'est_sqft')::integer, est_sqft),
            frequency = COALESCE(ld->>'frequency', frequency),
            services = CASE WHEN ld->'services' IS NOT NULL THEN ld->'services' ELSE services END,
            current_vendor = COALESCE(ld->>'current_vendor', current_vendor),
            contract_end = COALESCE(ld->>'contract_end', contract_end),
            last_event_id = new.event_id,
            notes = COALESCE(p->>'notes', notes),
            updated_at = now()
          WHERE target_key = t_key;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Bind trigger on events table
DROP TRIGGER IF EXISTS trg_sync_commercial_lead ON public.events;
CREATE TRIGGER trg_sync_commercial_lead
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION sync_commercial_lead_from_knock();

-- 4. Backfill existing commercial events into leads table
INSERT INTO public.leads (
  target_key, business_name, street_name, house_number, suite,
  lat, lng, owner_rep_id, stage, stage_updated_at,
  next_follow_up_at, est_monthly_value, est_sqft, frequency, services,
  current_vendor, contract_end, last_event_id, notes
)
SELECT DISTINCT ON (e.payload->>'target_key')
  e.payload->>'target_key' AS target_key,
  COALESCE(e.payload->>'business_name', 'Commercial Target') AS business_name,
  COALESCE(e.payload->>'street_name', '') AS street_name,
  e.payload->>'house_number' AS house_number,
  e.payload->>'suite' AS suite,
  (e.payload->>'lat')::real AS lat,
  (e.payload->>'lng')::real AS lng,
  e.rep_id AS owner_rep_id,
  CASE
    WHEN (e.payload->>'outcome_type') = 'WALKTHROUGH_BOOKED' THEN 'WALKTHROUGH_BOOKED'
    WHEN (e.payload->>'outcome_type') = 'DECISION_MAKER' AND (e.payload->>'objection_type') IN ('NOT INTERESTED', 'NO SOLICITING') THEN 'LOST'
    WHEN (e.payload->>'outcome_type') = 'DECISION_MAKER' THEN 'DM_IDENTIFIED'
    WHEN (e.payload->>'outcome_type') = 'GATEKEEPER' THEN 'CONTACTED'
    ELSE 'COLD'
  END AS stage,
  e.created_at AS stage_updated_at,
  CASE
    WHEN (e.payload->'lead_details'->>'walkthrough_at') IS NOT NULL THEN (e.payload->'lead_details'->>'walkthrough_at')::timestamp with time zone
    WHEN (e.payload->>'callback_time') IS NOT NULL THEN (e.payload->>'callback_time')::timestamp with time zone
    ELSE NULL
  END AS next_follow_up_at,
  (e.payload->'lead_details'->>'est_monthly_value')::numeric AS est_monthly_value,
  (e.payload->'lead_details'->>'est_sqft')::integer AS est_sqft,
  e.payload->'lead_details'->>'frequency' AS frequency,
  COALESCE(e.payload->'lead_details'->'services', '[]'::jsonb) AS services,
  e.payload->'lead_details'->>'current_vendor' AS current_vendor,
  e.payload->'lead_details'->>'contract_end' AS contract_end,
  e.event_id AS last_event_id,
  e.payload->>'notes' AS notes
FROM public.events e
WHERE e.type = 'KNOCK'
  AND (e.payload->>'mode') = 'COMMERCIAL'
  AND (e.payload->>'target_key') IS NOT NULL
  AND (e.payload->>'target_key') != ''
ORDER BY e.payload->>'target_key', e.created_at DESC
ON CONFLICT (target_key) DO NOTHING;
