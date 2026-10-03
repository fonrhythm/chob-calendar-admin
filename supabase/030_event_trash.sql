BEGIN;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS trash_expires_at timestamptz;
UPDATE public.events SET trash_expires_at=clock_timestamp()+interval '3 days'
WHERE attributes->>'admin_deleted_at' IS NOT NULL AND trash_expires_at IS NULL;
CREATE OR REPLACE FUNCTION chob_private.track_event_trash()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.attributes->>'admin_deleted_at' IS NOT NULL AND NEW.attributes->>'admin_deleted_at' IS NULL
     AND coalesce(current_setting('chob.restoring_event',true),'')<>'yes' THEN
    RAISE EXCEPTION '活动已删除，请先从回收站恢复';
  END IF;
  IF OLD.attributes->>'admin_deleted_at' IS NULL AND NEW.attributes->>'admin_deleted_at' IS NOT NULL THEN
    NEW.trash_expires_at:=clock_timestamp()+interval '3 days';
  ELSIF NEW.attributes->>'admin_deleted_at' IS NULL THEN NEW.trash_expires_at:=NULL;
  ELSE NEW.trash_expires_at:=OLD.trash_expires_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chob_track_event_trash ON public.events;
CREATE TRIGGER chob_track_event_trash BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION chob_private.track_event_trash();
CREATE OR REPLACE FUNCTION public.chob_restore_events(event_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total integer;
BEGIN
  IF NOT chob_private.can_edit_events() THEN RAISE EXCEPTION '仅活动编辑可操作' USING ERRCODE='42501'; END IF;
  total:=coalesce(cardinality(event_ids),0);
  IF total NOT BETWEEN 1 AND 200 OR total<>(SELECT count(DISTINCT id) FROM unnest(event_ids) id) THEN RAISE EXCEPTION '请选择1至200个不同活动'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chob_event_batch_import'));
  PERFORM 1 FROM public.events WHERE id=ANY(event_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.events WHERE id=ANY(event_ids) AND attributes->>'admin_deleted_at' IS NOT NULL AND trash_expires_at>clock_timestamp())<>total THEN
    RAISE EXCEPTION '活动已过期或已变动，请刷新回收站';
  END IF;
  PERFORM set_config('chob.restoring_event','yes',true);
  UPDATE public.events SET status='draft',scheduled_publish_at=NULL,attributes=attributes-'admin_deleted_at',updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=ANY(event_ids);
  PERFORM set_config('chob.restoring_event','',true);
  UPDATE public.tasks SET status='draft',updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE event_id=ANY(event_ids);
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.chob_restore_events(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chob_restore_events(uuid[]) TO authenticated;
CREATE OR REPLACE FUNCTION chob_private.purge_event_trash()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chob_event_batch_import'));
  SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.events WHERE attributes->>'admin_deleted_at' IS NOT NULL AND trash_expires_at<=clock_timestamp() ORDER BY id FOR UPDATE) expired;
  IF ids IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.tasks WHERE event_id=ANY(ids);
  DELETE FROM public.chob_corrections WHERE event_id=ANY(ids);
  UPDATE public.chob_announcements SET event_id=NULL WHERE event_id=ANY(ids);
  UPDATE public.chob_messages SET event_id=NULL WHERE event_id=ANY(ids);
  DELETE FROM public.events WHERE id=ANY(ids);
  RETURN cardinality(ids);
END $$;
REVOKE ALL ON FUNCTION chob_private.purge_event_trash() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
