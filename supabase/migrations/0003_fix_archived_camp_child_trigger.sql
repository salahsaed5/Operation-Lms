-- 0003_fix_archived_camp_child_trigger.sql
-- Fix: generic archived-camp trigger must not reference daily_checkins-only
-- columns on other child tables (e.g. groups), which raises SQLSTATE 42703.

CREATE OR REPLACE FUNCTION prevent_mutation_on_archived_camp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp_id UUID;
  v_status camp_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_camp_id := OLD.camp_id;
  ELSE
    v_camp_id := NEW.camp_id;
  END IF;

  SELECT status INTO v_status
  FROM public.camps
  WHERE id = v_camp_id;

  IF v_status = 'archived' THEN
    -- Only daily_checkins has these selfie fields. Keep this branch nested
    -- so generic triggers on other tables never evaluate those record fields.
    IF TG_TABLE_NAME = 'daily_checkins' AND TG_OP = 'UPDATE' THEN
      IF OLD.selfie_deleted_after_archive = FALSE
         AND NEW.selfie_deleted_after_archive = TRUE
         AND NEW.selfie_storage_path IS NULL THEN
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION
      'CITS Integrity Violation: Cannot modify % because camp % is archived (read-only).',
      TG_TABLE_NAME, v_camp_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
