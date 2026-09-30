-- 依次执行 017、018 后执行本脚本。获批协作人仅可管理活动与参与事项。
BEGIN;

CREATE OR REPLACE FUNCTION chob_private.can_edit_events() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id=auth.uid()
      AND role IN ('admin','collaborator_fan') AND backend_approved IS TRUE
      AND is_active IS TRUE AND email_verified IS TRUE
  );
$$;
REVOKE ALL ON FUNCTION chob_private.can_edit_events() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION chob_private.can_edit_events() TO authenticated;

-- 编辑者只能读取后台活动、事项和表单选项；不授予表的直接写入权限。
GRANT SELECT ON public.events,public.tasks,public.event_type_definitions,public.participation_conditions TO authenticated;
DROP POLICY IF EXISTS chob_editor_events_read ON public.events;
CREATE POLICY chob_editor_events_read ON public.events FOR SELECT TO authenticated
USING (chob_private.can_edit_events());
DROP POLICY IF EXISTS chob_editor_tasks_read ON public.tasks;
CREATE POLICY chob_editor_tasks_read ON public.tasks FOR SELECT TO authenticated
USING (chob_private.can_edit_events());
DROP POLICY IF EXISTS chob_editor_event_types_read ON public.event_type_definitions;
CREATE POLICY chob_editor_event_types_read ON public.event_type_definitions FOR SELECT TO authenticated
USING (chob_private.can_edit_events());
DROP POLICY IF EXISTS chob_editor_conditions_read ON public.participation_conditions;
CREATE POLICY chob_editor_conditions_read ON public.participation_conditions FOR SELECT TO authenticated
USING (chob_private.can_edit_events());

-- 保留原表单验证和并发检查，只修改其授权范围；受控函数代替直接开放写表。
DO $migration$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) INTO definition;
  revised := regexp_replace(definition, 'role\s*=\s*''admin''', 'role IN (''admin'',''collaborator_fan'') AND backend_approved IS TRUE', 'g');
  IF revised=definition AND strpos(definition, 'collaborator_fan')=0 THEN RAISE EXCEPTION '活动保存接口版本不符，请先执行 004 和 015。'; END IF;
  EXECUTE revised;
  ALTER FUNCTION public.chob_save_event_bundle(jsonb,jsonb,text) SECURITY DEFINER;
  ALTER FUNCTION public.chob_save_event_bundle_v2(jsonb,jsonb,text) SECURITY DEFINER;

  SELECT pg_get_functiondef('public.chob_import_event_bundles_v2(jsonb,boolean)'::regprocedure) INTO definition;
  revised := replace(definition,
    'IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role=''admin'' AND is_active IS TRUE AND email_verified IS TRUE) THEN',
    'IF NOT chob_private.can_edit_events() THEN');
  IF revised=definition AND strpos(definition, 'can_edit_events')=0 THEN RAISE EXCEPTION '批量导入接口版本不符，请先执行 017。'; END IF;
  EXECUTE revised;
  ALTER FUNCTION public.chob_import_event_bundles_v2(jsonb,boolean) SECURITY DEFINER;

  SELECT pg_get_functiondef('public.chob_manage_events(uuid[],text)'::regprocedure) INTO definition;
  revised := replace(definition,
    'IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role=''admin'' AND is_active IS TRUE AND email_verified IS TRUE) THEN',
    'IF NOT chob_private.can_edit_events() THEN');
  IF revised=definition AND strpos(definition, 'can_edit_events')=0 THEN RAISE EXCEPTION '批量管理接口版本不符，请先执行 017。'; END IF;
  EXECUTE revised;
  ALTER FUNCTION public.chob_manage_events(uuid[],text) SECURITY DEFINER;

  SELECT pg_get_functiondef('public.chob_set_postponement(uuid,date,boolean,text)'::regprocedure) INTO definition;
  revised := replace(definition, 'PERFORM chob_private.require_admin();',
    'IF NOT chob_private.can_edit_events() THEN RAISE EXCEPTION ''仅活动编辑可操作。'' USING ERRCODE=''42501''; END IF;');
  IF revised=definition AND strpos(definition, 'can_edit_events')=0 THEN RAISE EXCEPTION '活动延期接口版本不符，请先执行 016。'; END IF;
  EXECUTE revised;
END $migration$;

-- 活动变更通知由活动编辑保存；独立公告管理仍由管理员控制。
CREATE OR REPLACE FUNCTION public.chob_save_event_with_notice(payload jsonb,task_payload jsonb,expected_updated_at text DEFAULT NULL,notice_payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved jsonb;
BEGIN
  saved := public.chob_save_event_bundle_v2(payload,task_payload,expected_updated_at);
  IF notice_payload IS NOT NULL THEN
    IF length(btrim(coalesce(notice_payload->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '活动通知标题需为 1–200 字。'; END IF;
    IF coalesce(notice_payload->>'source_url','')<>'' AND notice_payload->>'source_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
    INSERT INTO public.chob_announcements(title,body,source_url,event_id)
    VALUES(btrim(notice_payload->>'title'),coalesce(notice_payload->>'body',''),coalesce(notice_payload->>'source_url',''),(saved->>'id')::uuid);
  END IF;
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
