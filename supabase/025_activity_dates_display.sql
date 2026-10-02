BEGIN;
DO $migration$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO original;
 revised:=original;
 IF strpos(revised,'''prefer_activity_name''')=0 THEN
  IF strpos(revised,'''activity'',e.title')=0 THEN RAISE EXCEPTION '公开活动接口版本不符，停止修改'; END IF;
  revised:=replace(revised,'''activity'',e.title','''prefer_activity_name'',coalesce(e.attrs->''prefer_activity_name'',''false''::jsonb),''event_title'',e.title,''activity'',e.title');
 END IF;
 IF strpos(revised,'admin_deleted_at')=0 THEN
  IF strpos(revised,'WHERE e.status=''published''')=0 THEN RAISE EXCEPTION '公开活动过滤版本不符，停止修改'; END IF;
  revised:=replace(revised,'WHERE e.status=''published''','WHERE e.status=''published'' AND e.attributes->>''admin_deleted_at'' IS NULL');
 END IF;
 IF revised<>original THEN EXECUTE revised; END IF;
 SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) INTO original;
 IF strpos(original,'多日结束日期不能早于开始日期')=0 THEN
  revised:=replace(original,'-- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。',
  'IF nullif(payload->''attributes''->>''end_date'','''') IS NOT NULL AND (payload->''attributes''->>''end_date'')::date < (payload->>''date'')::date THEN RAISE EXCEPTION ''多日结束日期不能早于开始日期。''; END IF;
   IF payload->''attributes'' ? ''prefer_activity_name'' AND jsonb_typeof(payload->''attributes''->''prefer_activity_name'')<>''boolean'' THEN RAISE EXCEPTION ''显示名称选项格式无效。''; END IF;
   -- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。');
  IF revised=original THEN RAISE EXCEPTION '活动保存接口版本不符，停止修改'; END IF;
  EXECUTE revised;
 END IF;
END $migration$;
INSERT INTO chob_private.migrations(version) VALUES('025') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
