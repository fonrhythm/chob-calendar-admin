BEGIN;
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) INTO definition;
 IF strpos(definition,'unmatched_import_names')=0 THEN
  IF strpos(definition, '至少选择一位参与艺人。')=0 THEN RAISE EXCEPTION '保存接口版本不符，请先执行 004'; END IF;
  definition:=replace(definition,
   'IF coalesce(array_length(artist_ids_value,1),0)=0 THEN',
   'IF coalesce(array_length(artist_ids_value,1),0)=0 AND NOT (payload->>''status''=''draft'' AND jsonb_array_length(coalesce(payload->''attributes''->''unmatched_import_names'',''[]''::jsonb))>0) THEN');
  definition:=replace(definition,'-- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。',
   'IF payload->>''status''=''published'' AND jsonb_array_length(coalesce(payload->''attributes''->''unmatched_import_names'',''[]''::jsonb))>0 THEN RAISE EXCEPTION ''请先完成待匹配艺人，再发布。''; END IF;
   -- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。');
  EXECUTE definition;
 END IF;
END $migration$;

CREATE OR REPLACE FUNCTION public.chob_save_event_bundle_v2(payload jsonb,task_payload jsonb,expected_updated_at text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved jsonb; publish_at timestamptz:=nullif(payload->>'scheduled_publish_at','')::timestamptz;
BEGIN
 IF publish_at IS NOT NULL AND publish_at<=now() THEN RAISE EXCEPTION '请选择未来的发布时间。'; END IF;
 saved:=public.chob_save_event_bundle(payload,task_payload,expected_updated_at);
 UPDATE public.events SET scheduled_publish_at=CASE WHEN payload->>'status'='published' THEN publish_at ELSE NULL END WHERE id=(saved->>'id')::uuid;
 RETURN saved || jsonb_build_object('scheduled_publish_at',publish_at);
END $$;
REVOKE ALL ON FUNCTION public.chob_save_event_bundle_v2(jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_event_bundle_v2(jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chob_submit_event_scheduled(payload jsonb,record_id uuid DEFAULT NULL,expected_updated_at text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; publish_at timestamptz:=nullif(payload->>'scheduled_publish_at','')::timestamptz;
BEGIN
 IF publish_at IS NOT NULL AND publish_at<=now() THEN RAISE EXCEPTION '请选择未来的发布时间。'; END IF;
 -- Existing function enforces account verification, ownership and edit limits.
 result:=public.chob_submit_event(payload,record_id,expected_updated_at);
 UPDATE public.events SET scheduled_publish_at=publish_at WHERE id=result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.chob_submit_event_scheduled(jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_submit_event_scheduled(jsonb,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
DO $migration$
DECLARE definition text; constraint_row record;
BEGIN
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO definition;
 definition:=replace(definition,'t.start_date IS NOT NULL AND t.end_date IS NOT NULL','t.start_date IS NOT NULL AND (t.end_date IS NOT NULL OR t.task_type=''ticketing'')');
 definition:=replace(definition,'''interaction'',''见面互动''),(''music'',''音乐演出''),(''brand'',''品牌商务''),(''screen'',''影视宣传''),(''broadcast'',''节目／直播''),(''other'',''其他''', '''music'',''演出舞台''),(''screen'',''影视宣传''),(''interaction'',''站台活动''),(''awards'',''颁奖红毯''),(''broadcast'',''线上直播''),(''other'',''其他''');
 EXECUTE definition;
 IF to_regprocedure('public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb)'::regprocedure) INTO definition;
  definition:=replace(definition,'public.chob_save_event_bundle(','public.chob_save_event_bundle_v2(');
  EXECUTE definition;
 END IF;
 FOR constraint_row IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND contype='c' LOOP
  IF constraint_row.definition LIKE '%end_date IS NOT NULL%' AND constraint_row.definition LIKE '%published%' AND constraint_row.definition NOT LIKE '%ticketing%' THEN
   EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I',constraint_row.conname);
   EXECUTE format('ALTER TABLE public.tasks ADD CONSTRAINT %I %s',constraint_row.conname,replace(constraint_row.definition,'end_date IS NOT NULL','(end_date IS NOT NULL OR task_type = ''ticketing'')'));
  END IF;
 END LOOP;
END $migration$;
COMMIT;
