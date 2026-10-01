-- =============================================================
-- KnockLog — Commercial Mode Migration
-- Run this in the Supabase SQL Editor (safe to run multiple times)
-- =============================================================

-- 1. Widen the outcome_type check constraint on knock_events
--    to accept commercial outcomes.
--    The old constraint only allows: NO_ANSWER, CONVO, SALE
--    New constraint adds:          GATEKEEPER, DECISION_MAKER, WALKTHROUGH_BOOKED

ALTER TABLE public.knock_events
  DROP CONSTRAINT IF EXISTS knock_events_outcome_type_check;

ALTER TABLE public.knock_events
  ADD CONSTRAINT knock_events_outcome_type_check
  CHECK (outcome_type IN (
    'NO_ANSWER',
    'CONVO',
    'SALE',
    'GATEKEEPER',
    'DECISION_MAKER',
    'WALKTHROUGH_BOOKED'
  ));

-- 2. Add mode column to knock_events (NULL = legacy RESIDENTIAL)
ALTER TABLE public.knock_events
  ADD COLUMN IF NOT EXISTS mode text
  CHECK (mode IS NULL OR mode IN ('RESIDENTIAL', 'COMMERCIAL'));

-- 3. Add mode column to day_sessions (NULL = legacy RESIDENTIAL)
ALTER TABLE public.day_sessions
  ADD COLUMN IF NOT EXISTS mode text
  CHECK (mode IS NULL OR mode IN ('RESIDENTIAL', 'COMMERCIAL'));

-- 4. Add commercial-specific columns to knock_events
--    (NULL-safe; residential rows just never populate these)
ALTER TABLE public.knock_events
  ADD COLUMN IF NOT EXISTS target_type    text,   -- 'BUSINESS' | 'GC_SITE'
  ADD COLUMN IF NOT EXISTS target_key     text,   -- stable slug key
  ADD COLUMN IF NOT EXISTS business_name  text,
  ADD COLUMN IF NOT EXISTS suite          text,
  ADD COLUMN IF NOT EXISTS gatekeeper     jsonb,  -- { name, dm_name, dm_title, dm_best_time }
  ADD COLUMN IF NOT EXISTS lead_details   jsonb,  -- { contact_name, phone, services, ... }
  ADD COLUMN IF NOT EXISTS lat            real,
  ADD COLUMN IF NOT EXISTS lng            real,
  ADD COLUMN IF NOT EXISTS notes         text;

-- 5. Update the legacy projection trigger to handle commercial events.
--    Key changes:
--      a) Reads mode from payload and writes it to both tables.
--      b) Maps commercial fields into the extended knock_events columns.
--      c) Ensures street_name is never NULL (commercial address populates it).

CREATE OR REPLACE FUNCTION project_event_to_legacy()
RETURNS trigger AS $$
BEGIN
  IF new.type = 'DAY_START' THEN
    INSERT INTO public.day_sessions (id, rep_id, session_date, start_time, status, mode)
    VALUES (
      (new.payload->>'session_id')::uuid,
      new.rep_id,
      (new.payload->>'session_date')::date,
      (new.payload->>'start_time')::timestamp with time zone,
      'OPEN',
      COALESCE(new.payload->>'mode', 'RESIDENTIAL')
    ) ON CONFLICT (id) DO NOTHING;

  ELSIF new.type = 'DAY_END' THEN
    UPDATE public.day_sessions
    SET status        = 'CLOSED',
        end_time      = (new.payload->>'end_time')::timestamp with time zone,
        export_status = new.payload->>'export_status',
        export_url    = new.payload->>'export_url',
        mode          = COALESCE(new.payload->>'mode', mode)  -- preserve if already set
    WHERE id = (new.payload->>'session_id')::uuid;

  ELSIF new.type = 'KNOCK' THEN
    INSERT INTO public.knock_events (
      id, rep_id, session_id,
      street_name, house_number,
      timestamp, outcome_type, convo_status, objection_type, callback_time,
      mode, target_type, target_key, business_name, suite,
      gatekeeper, lead_details, lat, lng, notes
    ) VALUES (
      new.event_id,
      new.rep_id,
      (new.payload->>'session_id')::uuid,
      -- street_name MUST NOT be null (legacy NOT NULL constraint)
      COALESCE(new.payload->>'street_name', ''),
      new.payload->>'house_number',
      (new.payload->>'timestamp')::timestamp with time zone,
      new.payload->>'outcome_type',
      new.payload->>'convo_status',
      new.payload->>'objection_type',
      (new.payload->>'callback_time')::timestamp with time zone,
      COALESCE(new.payload->>'mode', 'RESIDENTIAL'),
      new.payload->>'target_type',
      new.payload->>'target_key',
      new.payload->>'business_name',
      new.payload->>'suite',
      CASE WHEN new.payload->'gatekeeper' IS NOT NULL AND new.payload->>'gatekeeper' != 'null'
           THEN new.payload->'gatekeeper' ELSE NULL END,
      CASE WHEN new.payload->'lead_details' IS NOT NULL AND new.payload->>'lead_details' != 'null'
           THEN new.payload->'lead_details' ELSE NULL END,
      (new.payload->>'lat')::real,
      (new.payload->>'lng')::real,
      new.payload->>'notes'
    ) ON CONFLICT (id) DO NOTHING;

  ELSIF new.type = 'BREAK_START' THEN
    INSERT INTO public.break_sessions (id, rep_id, session_id, break_start_time)
    VALUES (
      (new.payload->>'break_id')::uuid,
      new.rep_id,
      (new.payload->>'session_id')::uuid,
      (new.payload->>'break_start_time')::timestamp with time zone
    ) ON CONFLICT (id) DO NOTHING;

  ELSIF new.type = 'BREAK_END' THEN
    UPDATE public.break_sessions
    SET break_end_time = (new.payload->>'break_end_time')::timestamp with time zone,
        duration       = (new.payload->>'duration')::integer
    WHERE id = (new.payload->>'break_id')::uuid;

  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Trigger is already bound from the original schema (CREATE OR REPLACE covers function body).
-- If the trigger was dropped for any reason, recreate it:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_project_event'
  ) THEN
    CREATE TRIGGER trg_project_event
    AFTER INSERT ON public.events
    FOR EACH ROW EXECUTE FUNCTION project_event_to_legacy();
  END IF;
END;
$$;

-- 6. Index the new mode and target_key columns for efficient filtering
CREATE INDEX IF NOT EXISTS idx_knock_events_mode
  ON public.knock_events (mode);

CREATE INDEX IF NOT EXISTS idx_knock_events_target_key
  ON public.knock_events (target_key);

CREATE INDEX IF NOT EXISTS idx_sessions_mode
  ON public.day_sessions (mode);

-- Done. All legacy rows implicitly treat NULL mode as RESIDENTIAL.
