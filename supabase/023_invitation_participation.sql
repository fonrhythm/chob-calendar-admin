BEGIN;
DO $patch$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.chob_submit_event_with_tasks(jsonb,jsonb,uuid,text)'::regprocedure) INTO definition;
 IF strpos(definition,'仅限受邀')=0 THEN
  definition:=replace(definition,
    '无限制|无需|无门槛|free|unrestricted|no_limit',
    '无限制|无需|无门槛|仅限受邀|free|unrestricted|no_limit|invited|invitation_only');
  IF strpos(definition,'仅限受邀')=0 THEN RAISE EXCEPTION '参与方式接口版本不符，请先执行 022'; END IF;
  EXECUTE definition;
 END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
