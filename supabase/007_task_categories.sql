BEGIN;
DO $$ DECLARE c record; definition text; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND contype='c' LOOP
  IF c.def LIKE '%task_type%' AND c.def LIKE '%notification%' AND c.def NOT LIKE '%other%' THEN
   definition:=replace(c.def,'''notification''','''notification'', ''other''');
   IF definition=c.def THEN RAISE EXCEPTION '无法自动识别事项约束 %，请先核对定义。',c.conname; END IF;
   EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I',c.conname);
   EXECUTE format('ALTER TABLE public.tasks ADD CONSTRAINT %I %s',c.conname,definition);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.chob_save_event_bundle(
  payload jsonb, task_payload jsonb, expected_updated_at text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  event_id_value uuid := (payload->>'id')::uuid;
  existing public.events%ROWTYPE;
  saved public.events%ROWTYPE;
  task jsonb;
  task_id_value uuid;
  keep_ids uuid[] := '{}';
  artist_ids_value uuid[];
  stamp timestamp := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=actor AND role='admin' AND is_active IS TRUE AND email_verified IS TRUE) THEN
    RAISE EXCEPTION '仅启用且已验证邮箱的管理员可以保存活动。' USING ERRCODE='42501';
  END IF;
  IF event_id_value IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '活动编号或内容无效。'; END IF;
  IF jsonb_typeof(task_payload) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '事项列表格式不正确。'; END IF;
  IF jsonb_array_length(task_payload) > 100 THEN RAISE EXCEPTION '每个活动最多保存 100 条事项。'; END IF;
  IF coalesce(length(btrim(payload->>'title')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '活动标题需为 1–200 字。'; END IF;
  IF coalesce(payload->>'status','') NOT IN ('draft','published','withdrawn') THEN RAISE EXCEPTION '活动发布状态无效。'; END IF;
  IF nullif(payload->>'date','') IS NULL THEN RAISE EXCEPTION '请填写活动日期。'; END IF;
  IF nullif(payload->>'time','') IS NOT NULL AND nullif(payload->>'date','') IS NULL THEN RAISE EXCEPTION '填写活动时间时必须填写日期。'; END IF;
  IF nullif(payload->>'ticket_url','') IS NOT NULL AND payload->>'ticket_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '票务链接必须使用 http:// 或 https://。'; END IF;

  IF nullif(btrim(payload->>'location'),'') IS NULL THEN RAISE EXCEPTION '场地必填。'; END IF;
  IF jsonb_typeof(payload->'attributes') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '活动扩展资料无效。'; END IF;
  IF nullif(btrim(payload->'attributes'->>'region'),'') IS NULL THEN RAISE EXCEPTION '地区必填。'; END IF;
  IF nullif(btrim(payload->>'location_region'),'') IS NULL THEN RAISE EXCEPTION '城市或线上直播必填。'; END IF;
  IF nullif(payload->>'participation_condition','') IS NULL THEN RAISE EXCEPTION '参与方式必填。'; END IF;
  IF jsonb_typeof(payload->'attributes'->'picture_urls') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '图片链接应为列表。'; END IF;
  IF jsonb_array_length(payload->'attributes'->'picture_urls') > 9 THEN RAISE EXCEPTION '最多 9 张活动图片。'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(payload->'attributes'->'picture_urls') AS p(url) WHERE url IS NULL OR url !~* '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION '图片链接必须使用 http:// 或 https://。'; END IF;
  SELECT coalesce(array_agg(value::uuid), '{}') INTO artist_ids_value
  FROM jsonb_array_elements_text(coalesce(payload->'artist_ids','[]'::jsonb));
  IF coalesce(array_length(artist_ids_value,1),0)=0 THEN RAISE EXCEPTION '至少选择一位参与艺人。'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(artist_ids_value) AS a(id) WHERE NOT EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id=a.id)) THEN
    RAISE EXCEPTION '选择的艺人已不存在，请重新加载。';
  END IF;

  -- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。
  SELECT * INTO existing FROM public.events WHERE id=event_id_value FOR UPDATE;
  IF FOUND THEN
    IF existing.updated_at IS DISTINCT FROM nullif(expected_updated_at,'')::timestamp THEN
      RAISE EXCEPTION '该活动已被修改，请关闭表单、刷新列表后重新编辑。';
    END IF;
    UPDATE public.events SET
      title=btrim(payload->>'title'), date=nullif(payload->>'date','')::date,
      time=nullif(payload->>'time','')::time, location=nullif(payload->>'location',''),
      location_region=nullif(payload->>'location_region',''), company=nullif(payload->>'company',''),
      artist_ids=artist_ids_value, event_type_id=nullif(payload->>'event_type_id','')::uuid,
      participation_condition=nullif(payload->>'participation_condition',''),
      description=payload->>'description', ticket_url=nullif(payload->>'ticket_url',''),
      status=payload->>'status', attributes=coalesce(attributes,'{}'::jsonb) || (payload->'attributes'), updated_at=stamp
    WHERE id=event_id_value RETURNING * INTO saved;
  ELSE
    IF expected_updated_at IS NOT NULL THEN RAISE EXCEPTION '活动已不存在，请重新加载。'; END IF;
    INSERT INTO public.events(id,title,date,time,location,location_region,company,artist_ids,event_type_id,
      participation_condition,description,ticket_url,status,created_by,created_at,updated_at,attributes)
    VALUES(event_id_value,btrim(payload->>'title'),nullif(payload->>'date','')::date,nullif(payload->>'time','')::time,
      nullif(payload->>'location',''),nullif(payload->>'location_region',''),nullif(payload->>'company',''),artist_ids_value,
      nullif(payload->>'event_type_id','')::uuid,nullif(payload->>'participation_condition',''),payload->>'description',
      nullif(payload->>'ticket_url',''),payload->>'status',actor,stamp,stamp,payload->'attributes') RETURNING * INTO saved;
  END IF;

  FOR task IN SELECT value FROM jsonb_array_elements(task_payload) LOOP
    task_id_value := (task->>'id')::uuid;
    IF task_id_value IS NULL OR task_id_value=ANY(keep_ids) THEN RAISE EXCEPTION '事项编号缺失或重复。'; END IF;
    keep_ids := array_append(keep_ids,task_id_value);
    IF coalesce(length(btrim(task->>'title')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '事项标题需为 1–200 字。'; END IF;
    IF coalesce(task->>'task_type','') NOT IN ('ticketing','registration','booking','shopping','notification','other') THEN RAISE EXCEPTION '事项分类无效。'; END IF;
    IF coalesce(task->>'status','') NOT IN ('draft','published','withdrawn') THEN RAISE EXCEPTION '事项状态无效。'; END IF;
    IF nullif(task->>'action_url','') IS NOT NULL AND task->>'action_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '事项链接必须使用 http:// 或 https://。'; END IF;
    IF (nullif(task->>'start_time','') IS NOT NULL AND nullif(task->>'start_date','') IS NULL)
      OR (nullif(task->>'end_time','') IS NOT NULL AND nullif(task->>'end_date','') IS NULL) THEN RAISE EXCEPTION '填写事项时间时必须填写对应日期。'; END IF;
    IF EXISTS(SELECT 1 FROM public.tasks WHERE id=task_id_value AND event_id IS DISTINCT FROM event_id_value) THEN
      RAISE EXCEPTION '事项属于其他活动，不能转移覆盖。';
    END IF;
    INSERT INTO public.tasks(id,event_id,title,task_type,description,start_date,end_date,start_time,end_time,action_url,status,created_by,created_at,updated_at)
    VALUES(task_id_value,event_id_value,btrim(task->>'title'),task->>'task_type',task->>'description',
      nullif(task->>'start_date','')::date,nullif(task->>'end_date','')::date,
      nullif(task->>'start_time','')::time,nullif(task->>'end_time','')::time,
      nullif(task->>'action_url',''),task->>'status',actor,stamp,stamp)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,task_type=excluded.task_type,description=excluded.description,
      start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,
      action_url=excluded.action_url,status=excluded.status,updated_at=excluded.updated_at
    WHERE public.tasks.event_id=event_id_value;
    IF NOT FOUND THEN RAISE EXCEPTION '事项归属已改变，请重新加载。'; END IF;
  END LOOP;
  DELETE FROM public.tasks WHERE event_id=event_id_value AND NOT(id=ANY(keep_ids));
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.chob_save_event_bundle(jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chob_save_event_bundle(jsonb,jsonb,text) TO authenticated;


CREATE OR REPLACE FUNCTION public.chob_save_event_with_notice(payload jsonb, task_payload jsonb, expected_updated_at text DEFAULT NULL, notice_payload jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; BEGIN
 result:=public.chob_save_event_bundle(payload,task_payload,expected_updated_at);
 IF notice_payload IS NOT NULL THEN PERFORM public.chob_publish_announcement(notice_payload||jsonb_build_object('event_id',result->>'id')); END IF;
 RETURN result; END $$;
REVOKE ALL ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
