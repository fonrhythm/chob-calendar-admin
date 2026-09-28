BEGIN;

ALTER TABLE public.chob_announcements ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';
ALTER TABLE public.chob_announcements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.chob_save_announcement(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid:=nullif(payload->>'id','')::uuid; selected_event uuid:=nullif(payload->>'event_id','')::uuid;
BEGIN
 PERFORM chob_private.require_admin();
 IF length(btrim(coalesce(payload->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '公告标题需为 1–200 字。'; END IF;
 IF coalesce(payload->>'source_url','')<>'' AND payload->>'source_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
 IF selected_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.events WHERE id=selected_event) THEN RAISE EXCEPTION '关联活动不存在。'; END IF;
 IF result IS NULL THEN
  INSERT INTO public.chob_announcements(title,body,source_url,event_id,published,kind)
  VALUES(btrim(payload->>'title'),coalesce(payload->>'body',''),coalesce(payload->>'source_url',''),selected_event,coalesce((payload->>'published')::boolean,true),coalesce(nullif(payload->>'kind',''),'general')) RETURNING id INTO result;
 ELSE
  UPDATE public.chob_announcements SET title=btrim(payload->>'title'),body=coalesce(payload->>'body',''),source_url=coalesce(payload->>'source_url',''),event_id=selected_event,published=coalesce((payload->>'published')::boolean,true),updated_at=now() WHERE id=result;
  IF NOT FOUND THEN RAISE EXCEPTION '公告已不存在，请刷新。'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.chob_save_announcement(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_announcement(jsonb) TO authenticated;

-- A postponement can be announced before the replacement date is known.
-- Once known, the linked date is created or updated while the original stays visible.
CREATE OR REPLACE FUNCTION public.chob_set_postponement(target uuid,new_date date DEFAULT NULL,notify_users boolean DEFAULT false,source_url text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original public.events; replacement public.events; replacement_id uuid; notice_id uuid; notice_body text;
BEGIN
 PERFORM chob_private.require_admin();
 SELECT * INTO original FROM public.events WHERE id=target FOR UPDATE;
 IF NOT FOUND OR original.cancelled_at IS NOT NULL OR original.attributes->>'event_status'='cancelled' THEN RAISE EXCEPTION '活动不存在或已取消。'; END IF;
 IF new_date=original.date THEN RAISE EXCEPTION '新日期不能与原日期相同。'; END IF;
 replacement_id:=nullif(original.attributes->>'related_event_id','')::uuid;
 IF new_date IS NOT NULL THEN
  IF replacement_id IS NOT NULL THEN
   SELECT * INTO replacement FROM public.events WHERE id=replacement_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION '关联的新日期活动已不存在，请核对。'; END IF;
   UPDATE public.events SET date=new_date,attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('original_date',original.date,'event_status','active'),updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=replacement_id;
  ELSE
   replacement_id:=gen_random_uuid();
   INSERT INTO public.events(id,title,date,time,location,location_region,company,artist_ids,event_type_id,participation_condition,description,ticket_url,status,created_by,created_at,updated_at,attributes)
   VALUES(replacement_id,original.title,new_date,original.time,original.location,original.location_region,original.company,original.artist_ids,original.event_type_id,original.participation_condition,original.description,original.ticket_url,original.status,auth.uid(),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC',(coalesce(original.attributes,'{}'::jsonb)-'end_date'-'postponed_to_date')||jsonb_build_object('event_status','active','original_date',original.date,'related_event_id',target));
   UPDATE public.chob_personal SET favorites=array_replace(favorites,'supabase:'||target::text,'supabase:'||replacement_id::text),items=array_replace(items,'supabase:'||target::text,'supabase:'||replacement_id::text),tags=CASE WHEN tags ? ('supabase:'||target::text) THEN (tags-('supabase:'||target::text))||jsonb_build_object('supabase:'||replacement_id::text,tags->('supabase:'||target::text)) ELSE tags END;
  END IF;
 END IF;
 UPDATE public.events SET attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('event_status','postponed','postponed_to_date',coalesce(new_date::text,''),'related_event_id',replacement_id),updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=target;
 IF notify_users THEN
  notice_body:='原 '||original.date::text||CASE WHEN new_date IS NULL THEN ' 延期，新日期另行通知' ELSE ' 延期至 '||new_date::text END;
  SELECT id INTO notice_id FROM public.chob_announcements WHERE event_id=target AND kind='postponement' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF notice_id IS NULL THEN
   INSERT INTO public.chob_announcements(event_id,title,body,source_url,kind) VALUES(target,left(original.title||'延期',200),notice_body,source_url,'postponement');
  ELSE
   UPDATE public.chob_announcements SET body=notice_body,source_url=chob_set_postponement.source_url,published=true,updated_at=now() WHERE id=notice_id;
  END IF;
 END IF;
 RETURN coalesce(replacement_id,target);
END $$;
REVOKE ALL ON FUNCTION public.chob_set_postponement(uuid,date,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_set_postponement(uuid,date,boolean,text) TO authenticated;

DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO definition;
 IF strpos(definition,'''participation_label''')=0 THEN
  definition:=replace(definition,'''region'',CASE e.attrs->>''region''',
   '''participation_condition'',e.participation_condition,''participation_label'',coalesce((SELECT to_jsonb(c)->>''name'' FROM public.participation_conditions c WHERE c.code=e.participation_condition LIMIT 1),e.participation_condition),''participation_rules'',coalesce(e.description,''''),''region'',CASE e.attrs->>''region''');
  definition:=replace(definition,'''link'',t.action_url)',
   '''link'',t.action_url,''action_url'',t.action_url,''steps'',coalesce(t.description,''''))');
  IF strpos(definition,'''participation_label''')=0 OR strpos(definition,'''steps''')=0 THEN RAISE EXCEPTION '公开数据接口版本不符，请先执行 006 与 015。'; END IF;
  EXECUTE definition;
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
