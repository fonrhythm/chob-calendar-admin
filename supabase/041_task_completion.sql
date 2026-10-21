-- Manual completion persists; date-based completion is computed on each feed.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-041-task-completion'));
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS closure_reason text NOT NULL DEFAULT '';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND conname='chob_task_closure_reason_check') THEN
  ALTER TABLE public.tasks ADD CONSTRAINT chob_task_closure_reason_check CHECK(closure_reason IN ('','sold_out','results_published','ended'));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION chob_private.task_completion_date(value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parsed date;
BEGIN
 IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
 parsed:=value::date;
 IF to_char(parsed,'YYYY-MM-DD')<>value THEN RETURN NULL; END IF;
 RETURN parsed;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION chob_private.task_completion_state(
 t public.tasks,e public.events,at_time timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE event_day date; final_day date; postponed_day date; task_at timestamptz;
 event_at timestamptz; deadline timestamptz; auto_reason text:=''; reason text:='';
 cancelled boolean; closed boolean;
BEGIN
 postponed_day:=chob_private.task_completion_date(e.attributes->>'postponed_to_date');
 -- A valid replacement date is authoritative. Otherwise a postponed or TBA
 -- event must not close tasks merely because its old date has passed.
 IF postponed_day IS NOT NULL THEN event_day:=postponed_day;
 ELSIF coalesce(e.attributes->>'event_status','')<>'postponed'
  AND coalesce(e.field_states->>'date',e.attributes->'field_states'->>'date','') NOT IN ('tba','missing') THEN
  event_day:=e.date;
 END IF;
 IF event_day IS NOT NULL THEN
  final_day:=chob_private.task_completion_date(e.attributes->>'end_date');
  IF final_day IS NULL OR final_day<event_day THEN final_day:=event_day; END IF;
  event_at:=(final_day+1)::timestamp AT TIME ZONE 'Asia/Bangkok';
 END IF;
 IF t.end_date IS NOT NULL THEN
  task_at:=CASE WHEN t.end_time IS NULL THEN (t.end_date+1)::timestamp
   ELSE t.end_date+t.end_time END AT TIME ZONE 'Asia/Bangkok';
 END IF;
 IF event_at IS NOT NULL AND (task_at IS NULL OR event_at<=task_at) THEN
  deadline:=event_at; auto_reason:='event_ended';
 ELSIF task_at IS NOT NULL THEN deadline:=task_at; auto_reason:='task_ended'; END IF;
 cancelled:=e.cancelled_at IS NOT NULL OR coalesce(e.attributes->>'event_status','')='cancelled';
 closed:=coalesce(t.is_closed,false) OR cancelled OR coalesce(at_time>=deadline,false);
 IF coalesce(t.is_closed,false) THEN
  reason:=coalesce(nullif(t.closure_reason,''),CASE WHEN t.task_type='ticketing' THEN 'sold_out' ELSE 'ended' END);
 ELSIF cancelled THEN reason:='event_cancelled';
 ELSIF coalesce(at_time>=deadline,false) THEN reason:=auto_reason;
 END IF;
 RETURN jsonb_build_object('is_closed',closed,'closure_reason',reason,
  'auto_close_at',deadline,'auto_close_reason',auto_reason);
END $$;
REVOKE ALL ON FUNCTION chob_private.task_completion_date(text),chob_private.task_completion_state(public.tasks,public.events,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.chob_set_task_completion(
 target uuid,next_state text,expected_task_version timestamptz,expected_event_version timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent_id uuid; parent public.events; item public.tasks; stamp timestamp;
BEGIN
 IF chob_private.can_edit_events() IS NOT TRUE OR chob_private.is_wechat_session() THEN
  RAISE EXCEPTION '仅获批 Web 活动编辑者可管理事项。' USING ERRCODE='42501';
 END IF;
 IF next_state IS NULL OR next_state NOT IN ('open','sold_out','results_published','ended') THEN
  RAISE EXCEPTION '事项结束状态无效。';
 END IF;
 IF expected_task_version IS NULL OR expected_event_version IS NULL THEN
  RAISE EXCEPTION '事项版本缺失，请刷新后重试。';
 END IF;
 SELECT event_id INTO parent_id FROM public.tasks WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION '事项不存在，请刷新后重试。'; END IF;
 -- The bundle also locks the event before its tasks. Use the same lock order.
 SELECT * INTO parent FROM public.events WHERE id=parent_id FOR UPDATE;
 IF NOT FOUND OR parent.attributes ? 'admin_deleted_at' OR parent.attributes ? 'merged_into' THEN
  RAISE EXCEPTION '关联活动已删除或归档，请刷新后重试。';
 END IF;
 SELECT * INTO item FROM public.tasks WHERE id=target AND event_id=parent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '事项归属已改变，请刷新后重试。'; END IF;
 IF (item.updated_at AT TIME ZONE 'UTC') IS DISTINCT FROM expected_task_version
  OR (parent.updated_at AT TIME ZONE 'UTC') IS DISTINCT FROM expected_event_version THEN
  RAISE EXCEPTION '活动或事项已被修改，请刷新后重试。';
 END IF;
 stamp:=greatest(clock_timestamp() AT TIME ZONE 'UTC',item.updated_at+interval '1 microsecond',parent.updated_at+interval '1 microsecond');
 UPDATE public.tasks SET is_closed=(next_state<>'open'),
  closure_reason=CASE WHEN next_state='open' THEN '' ELSE next_state END,updated_at=stamp
 WHERE id=target RETURNING * INTO item;
 UPDATE public.events SET updated_at=stamp WHERE id=parent_id RETURNING * INTO parent;
 -- Keep the stored task row separate from derived feed state. An ended parent
 -- can keep an explicitly reopened task out of the current pending list.
 RETURN jsonb_build_object('task',to_jsonb(item),'event_updated_at',parent.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.chob_set_task_completion(uuid,text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_set_task_completion(uuid,text,timestamptz,timestamptz) TO authenticated;

DO $migration$
DECLARE target oid; original text; revised text; previous_acl aclitem[];
 save_anchor text:='UPDATE public.tasks SET is_closed=coalesce((task->>''is_closed'')::boolean,is_closed),result_url=coalesce(task->>''result_url'',result_url) WHERE id=task_id_value AND event_id=event_id_value;';
 save_patch text:='/* chob-task-completion-save-v1 */
    IF task ? ''closure_reason'' AND (jsonb_typeof(task->''closure_reason'')<>''string'' OR task->>''closure_reason'' NOT IN ('''',''sold_out'',''results_published'',''ended'')) THEN RAISE EXCEPTION ''事项结束原因无效''; END IF;
    UPDATE public.tasks SET
     closure_reason=CASE
      WHEN task ? ''is_closed'' AND NOT (task->>''is_closed'')::boolean THEN ''''
      WHEN task ? ''closure_reason'' THEN CASE
       WHEN task->>''closure_reason''<>'''' THEN task->>''closure_reason''
       WHEN coalesce((task->>''is_closed'')::boolean,false) THEN CASE WHEN task_type=''ticketing'' THEN ''sold_out'' ELSE ''ended'' END ELSE '''' END
      WHEN coalesce((task->>''is_closed'')::boolean,false) THEN coalesce(nullif(closure_reason,''''),CASE WHEN task_type=''ticketing'' THEN ''sold_out'' ELSE ''ended'' END)
      ELSE closure_reason END,
     is_closed=CASE WHEN task ? ''is_closed'' THEN (task->>''is_closed'')::boolean
      WHEN task ? ''closure_reason'' THEN task->>''closure_reason''<>'''' ELSE is_closed END,
     result_url=coalesce(task->>''result_url'',result_url)
    WHERE id=task_id_value AND event_id=event_id_value;';
 feed_anchor text:='r.value || jsonb_build_object(';
 feed_patch text:='r.value || /* chob-task-completion-feed-v1 */ CASE WHEN r.value->>''kind''=''task'' THEN
 coalesce((SELECT chob_private.task_completion_state(t,e) FROM public.tasks t
 WHERE t.id=nullif(r.value->>''id'','''')::uuid AND t.event_id=e.id),''{}''::jsonb)
 ELSE ''{}''::jsonb END || jsonb_build_object(';
BEGIN
 target:=to_regprocedure('public.chob_save_event_bundle(jsonb,jsonb,text)');
 IF target IS NULL THEN RAISE EXCEPTION '041_task_completion: bundle save is missing; migration rolled back'; END IF;
 SELECT pg_get_functiondef(target),proacl INTO original,previous_acl FROM pg_proc WHERE oid=target;
 IF strpos(original,'chob-task-completion-save-v1')=0 THEN
  IF (length(original)-length(replace(original,save_anchor,'')))/length(save_anchor)<>1
   OR strpos(original,'公示链接无效')=0 OR strpos(original,'FOR UPDATE;')=0 THEN
   RAISE EXCEPTION '041_task_completion: unknown bundle save definition; migration rolled back';
  END IF;
  revised:=replace(original,save_anchor,save_patch); EXECUTE revised;
 ELSIF strpos(original,save_patch)=0
  OR (length(original)-length(replace(original,'chob-task-completion-save-v1','')))/length('chob-task-completion-save-v1')<>1 THEN
  RAISE EXCEPTION '041_task_completion: changed bundle save patch; migration rolled back';
 END IF;
 IF to_regprocedure('public.chob_save_event_bundle(jsonb,jsonb,text)')::oid IS DISTINCT FROM target
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM previous_acl THEN
  RAISE EXCEPTION '041_task_completion: bundle identity or permissions changed; migration rolled back';
 END IF;

 target:=to_regprocedure('public.chob_public_feed()');
 IF target IS NULL THEN RAISE EXCEPTION '041_task_completion: public feed is missing; migration rolled back'; END IF;
 SELECT pg_get_functiondef(target),proacl INTO original,previous_acl FROM pg_proc WHERE oid=target;
 IF strpos(original,'base:=public.chob_public_feed_legacy034();')=0
  OR strpos(original,'jsonb_array_elements(base->''records'') r(value)')=0
  OR strpos(original,'LEFT JOIN public.events e ON')=0 THEN
  RAISE EXCEPTION '041_task_completion: unknown public feed definition; migration rolled back';
 END IF;
 IF strpos(original,'chob-task-completion-feed-v1')=0 THEN
  IF (length(original)-length(replace(original,feed_anchor,'')))/length(feed_anchor)<>1 THEN
   RAISE EXCEPTION '041_task_completion: ambiguous public feed definition; migration rolled back';
  END IF;
  revised:=replace(original,feed_anchor,feed_patch); EXECUTE revised;
 ELSIF strpos(original,feed_patch)=0
  OR (length(original)-length(replace(original,'chob-task-completion-feed-v1','')))/length('chob-task-completion-feed-v1')<>1 THEN
  RAISE EXCEPTION '041_task_completion: changed feed patch; migration rolled back';
 END IF;
 IF to_regprocedure('public.chob_public_feed()')::oid IS DISTINCT FROM target
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM previous_acl THEN
  RAISE EXCEPTION '041_task_completion: feed identity or permissions changed; migration rolled back';
 END IF;
END $migration$;

INSERT INTO chob_private.migrations(version) VALUES('041_task_completion') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;

SELECT jsonb_build_object('migration','041_task_completion',
 'applied',EXISTS(SELECT 1 FROM chob_private.migrations WHERE version='041_task_completion'),
 'anon_write',has_function_privilege('anon','public.chob_set_task_completion(uuid,text,timestamptz,timestamptz)','execute'),
 'authenticated_write',has_function_privilege('authenticated','public.chob_set_task_completion(uuid,text,timestamptz,timestamptz)','execute')
) AS task_completion_migration_summary;
