BEGIN;

INSERT INTO public.participation_conditions(id,code,name)
SELECT gen_random_uuid(),'top_spender_lucky_fans','Top Spender/Lucky Fans'
WHERE NOT EXISTS (SELECT 1 FROM public.participation_conditions WHERE code='top_spender_lucky_fans' OR name='Top Spender/Lucky Fans');

CREATE OR REPLACE FUNCTION public.chob_submit_event_with_tasks(payload jsonb, task_payload jsonb DEFAULT '[]'::jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; old_task_id uuid; new_task_id uuid; item jsonb; condition_name text; condition_code text:=nullif(payload->>'participation_condition',''); derived_company text;
BEGIN
 IF condition_code IS NULL THEN RAISE EXCEPTION '请选择参与方式。'; END IF;
 SELECT name INTO condition_name FROM public.participation_conditions WHERE code=condition_code;
 IF NOT FOUND THEN RAISE EXCEPTION '参与方式不存在，请刷新页面。'; END IF;
 IF jsonb_typeof(task_payload) IS DISTINCT FROM 'array' OR jsonb_array_length(task_payload)>1 THEN RAISE EXCEPTION '具体事项格式不正确。'; END IF;
 IF (condition_name || ' ' || condition_code) ~* '无限制|无需|无门槛|free|unrestricted|no_limit' AND jsonb_array_length(task_payload)>0 THEN RAISE EXCEPTION '无限制无需填写具体事项。'; END IF;
 IF (condition_name || ' ' || condition_code) !~* '无限制|无需|无门槛|free|unrestricted|no_limit' AND jsonb_array_length(task_payload)=0 THEN RAISE EXCEPTION '请填写具体事项。'; END IF;
 IF jsonb_array_length(task_payload)=1 THEN
  item:=task_payload->0;
  IF coalesce(length(btrim(item->>'title')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '请填写具体事项标题。'; END IF;
  IF nullif(item->>'start_date','') IS NULL THEN RAISE EXCEPTION '请填写具体事项的开始日期。'; END IF;
  IF item->>'task_type' NOT IN ('ticketing','registration','shopping','other') THEN RAISE EXCEPTION '具体事项类别无效。'; END IF;
  IF item->>'task_type'<>'ticketing' AND nullif(item->>'end_date','') IS NULL THEN RAISE EXCEPTION '请填写具体事项的结束日期。'; END IF;
  IF nullif(item->>'end_date','') IS NOT NULL AND (item->>'end_date')::date<(item->>'start_date')::date THEN RAISE EXCEPTION '具体事项的结束日期不能早于开始日期。'; END IF;
  IF nullif(item->>'action_url','') IS NOT NULL AND item->>'action_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '操作链接无效。'; END IF;
 END IF;
 IF record_id IS NOT NULL THEN
  SELECT nullif(attributes->>'user_task_id','')::uuid INTO old_task_id FROM public.events WHERE id=record_id AND created_by=auth.uid() AND user_submitted FOR UPDATE;
 END IF;
 -- The existing submission function checks email verification, artist validity, ownership and edit limits.
 result:=public.chob_submit_event_scheduled(payload,record_id,expected_updated_at);
 SELECT string_agg(DISTINCT btrim(a.company),' / ' ORDER BY btrim(a.company)) INTO derived_company
 FROM public.artists a WHERE a.id=ANY(ARRAY(SELECT jsonb_array_elements_text(coalesce(payload->'artist_ids','[]'::jsonb))::uuid)) AND a.deleted_at IS NULL AND nullif(btrim(a.company),'') IS NOT NULL;
 IF old_task_id IS NOT NULL THEN DELETE FROM public.tasks WHERE id=old_task_id AND event_id=result AND created_by=auth.uid(); END IF;
 IF item IS NOT NULL THEN
  new_task_id:=gen_random_uuid();
  INSERT INTO public.tasks(id,event_id,title,task_type,description,start_date,end_date,start_time,end_time,action_url,status,created_by,created_at,updated_at)
  VALUES(new_task_id,result,btrim(item->>'title'),item->>'task_type',coalesce(item->>'description',''),(item->>'start_date')::date,nullif(item->>'end_date','')::date,
   nullif(item->>'start_time','')::time,nullif(item->>'end_time','')::time,nullif(item->>'action_url',''),'published',auth.uid(),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');
 END IF;
 UPDATE public.events SET company=coalesce(derived_company,''),participation_condition=condition_code,
  description=coalesce(item->>'description',''),attributes=coalesce(attributes,'{}'::jsonb)-'user_task_id'||
   CASE WHEN new_task_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('user_task_id',new_task_id,'user_task',item) END,
  updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.chob_submit_event_with_tasks(jsonb,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_submit_event_with_tasks(jsonb,jsonb,uuid,text) TO authenticated;

DO $patch$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO definition;
 IF strpos(definition,'''user_task''')=0 THEN
  definition:=replace(definition,'''updated_at'',e.updated_at,','''user_task'',coalesce(e.attrs->''user_task'',''{}''::jsonb),''updated_at'',e.updated_at,');
  IF strpos(definition,'''user_task''')=0 THEN RAISE EXCEPTION '公开数据接口版本不符，请先执行 016'; END IF;
  EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.chob_report_correction(uuid,text[],text)'::regprocedure) INTO definition;
 definition:=replace(definition,'''images'',''link'']','''images'',''link'',''postponed'',''cancelled'']');
 IF strpos(definition,'''postponed''')=0 THEN RAISE EXCEPTION '纠错接口版本不符，请先执行 006'; END IF;
 EXECUTE definition;
 SELECT pg_get_functiondef('public.chob_resolve_correction(uuid,text,text,jsonb,boolean,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'''name'',''images''))','''name'',''images'',''postponed'',''cancelled''))');
 definition:=replace(definition,
  'IF changes ? ''time'' THEN attrs:=attrs || jsonb_build_object(''time_text'',changes->>''time''); END IF;',
  'IF changes ? ''time'' THEN attrs:=attrs || jsonb_build_object(''time_text'',changes->>''time''); END IF;
   IF changes ? ''postponed'' AND changes ? ''cancelled'' THEN RAISE EXCEPTION ''活动不能同时延期和取消。''; END IF;
   IF changes ? ''postponed'' THEN attrs:=attrs || jsonb_build_object(''event_status'',''postponed'',''status_note'',changes->>''postponed''); END IF;
   IF changes ? ''cancelled'' THEN attrs:=attrs || jsonb_build_object(''event_status'',''cancelled'',''status_note'',changes->>''cancelled''); END IF;');
 definition:=replace(definition,'attributes=attrs WHERE id=report.event_id;',
  'attributes=attrs, cancelled_at=CASE WHEN changes ? ''cancelled'' THEN now() ELSE cancelled_at END WHERE id=report.event_id;');
 IF strpos(definition,'status_note')=0 OR strpos(definition,'cancelled_at=CASE')=0 THEN RAISE EXCEPTION '纠错处理接口版本不符，请先执行 006'; END IF;
 EXECUTE definition;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
