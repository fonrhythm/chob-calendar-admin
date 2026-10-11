-- A postponed event keeps its identity. Repeated updates reuse its notice.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-037'));

CREATE OR REPLACE FUNCTION chob_private.upsert_postponement_notice(
 target uuid, notice_title text, notice_body text, notice_source text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE notice_id uuid; retained_source text;
BEGIN
 PERFORM 1 FROM public.events WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '关联活动不存在。'; END IF;
 IF length(btrim(coalesce(notice_title,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '公告标题需为 1–200 字。'; END IF;
 IF coalesce(notice_source,'')<>'' AND notice_source !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
 SELECT n.id INTO notice_id FROM public.chob_announcements n
 WHERE n.event_id=target AND (n.kind='postponement' OR (n.title||' '||n.body) LIKE '%延期%')
 ORDER BY n.published DESC,n.created_at DESC,n.id LIMIT 1 FOR UPDATE;
 SELECT n.source_url INTO retained_source FROM public.chob_announcements n
 WHERE n.event_id=target AND (n.kind='postponement' OR (n.title||' '||n.body) LIKE '%延期%') AND n.source_url<>''
 ORDER BY n.published DESC,n.created_at DESC,n.id LIMIT 1;
 retained_source:=coalesce(nullif(notice_source,''),retained_source,'');
 IF notice_id IS NULL THEN
  INSERT INTO public.chob_announcements(event_id,title,body,source_url,kind)
  VALUES(target,btrim(notice_title),coalesce(notice_body,''),retained_source,'postponement') RETURNING id INTO notice_id;
 ELSE
  UPDATE public.chob_announcements SET title=btrim(notice_title),body=coalesce(notice_body,''),
   source_url=retained_source,kind='postponement',published=true,updated_at=now() WHERE id=notice_id;
 END IF;
 -- Retain duplicate notices as unpublished history, rather than deleting them.
 UPDATE public.chob_announcements SET published=false,updated_at=now()
 WHERE event_id=target AND id<>notice_id AND published=true
 AND (kind='postponement' OR (title||' '||body) LIKE '%延期%');
 RETURN notice_id;
END $$;
REVOKE ALL ON FUNCTION chob_private.upsert_postponement_notice(uuid,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.chob_set_postponement(target uuid,new_date date DEFAULT NULL,
 notify_users boolean DEFAULT false,source_url text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original public.events; attrs jsonb; original_date date; notice_body text; shifted_end date; effective_source text;
BEGIN
 IF NOT chob_private.can_edit_events() THEN RAISE EXCEPTION '仅活动编辑可操作。' USING ERRCODE='42501'; END IF;
 IF coalesce(source_url,'')<>'' AND source_url !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
 SELECT * INTO original FROM public.events WHERE id=target FOR UPDATE;
 IF NOT FOUND OR original.cancelled_at IS NOT NULL OR original.attributes->>'event_status'='cancelled'
 OR original.attributes ? 'admin_deleted_at' OR original.attributes ? 'merged_into' THEN
  RAISE EXCEPTION '活动不存在、已取消或已归档。';
 END IF;
 IF nullif(original.attributes->>'related_event_id','') IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.events e WHERE e.id=(original.attributes->>'related_event_id')::uuid
  AND e.status<>'withdrawn' AND NOT e.attributes ? 'admin_deleted_at') THEN
  RAISE EXCEPTION '此活动有旧版延期关联记录，请先合并原记录后再更新日期。';
 END IF;
 original_date:=coalesce(nullif(original.attributes->>'original_date','')::date,original.date);
 attrs:=(coalesce(original.attributes,'{}')-'related_event_id'-'postponed_to_date')
  ||jsonb_build_object('original_date',original_date);
 effective_source:=coalesce(nullif(source_url,''),nullif(original.attributes->>'postponement_source_url',''),
  (SELECT n.source_url FROM public.chob_announcements n WHERE n.event_id=target AND n.source_url<>''
   AND (n.kind='postponement' OR (n.title||' '||n.body) LIKE '%延期%') ORDER BY n.published DESC,n.created_at DESC,n.id LIMIT 1),'');
 IF effective_source<>'' THEN attrs:=attrs||jsonb_build_object('postponement_source_url',effective_source); END IF;
 IF new_date IS NULL THEN
  attrs:=attrs||jsonb_build_object('event_status','postponed','postponed_to_date','');
 ELSE
  IF original.date IS NOT NULL AND nullif(attrs->>'end_date','') IS NOT NULL THEN
   shifted_end:=(attrs->>'end_date')::date+(new_date-original.date);
   attrs:=attrs||jsonb_build_object('end_date',shifted_end);
  END IF;
  attrs:=attrs||jsonb_build_object('event_status','active','field_states',coalesce(attrs->'field_states','{}')||'{"date":"known"}'::jsonb);
 END IF;
 UPDATE public.events SET date=coalesce(new_date,date),attributes=attrs,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=target;
 -- Favorites, personal items, tasks and sources already reference this same ID.
 IF notify_users OR EXISTS(SELECT 1 FROM public.chob_announcements n WHERE n.event_id=target
 AND n.published AND (n.kind='postponement' OR (n.title||' '||n.body) LIKE '%延期%')) THEN
  notice_body:='原 '||coalesce(original_date::text,'日期待定')||CASE WHEN new_date IS NULL THEN ' 活动延期，新日期另行通知' ELSE ' 活动延期至 '||new_date::text END;
  PERFORM chob_private.upsert_postponement_notice(target,left(original.title||'延期',200),notice_body,effective_source);
 END IF;
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.chob_set_postponement(uuid,date,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_set_postponement(uuid,date,boolean,text) TO authenticated;

-- Older callers follow the same identity-preserving behavior.
CREATE OR REPLACE FUNCTION public.chob_postpone_event(target uuid,new_date date,notify_users boolean DEFAULT false,source_url text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM chob_private.require_admin(); RETURN public.chob_set_postponement(target,new_date,notify_users,source_url); END $$;
REVOKE ALL ON FUNCTION public.chob_postpone_event(uuid,date,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_postpone_event(uuid,date,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chob_save_event_with_notice(payload jsonb,task_payload jsonb,
 expected_updated_at text DEFAULT NULL,notice_payload jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved jsonb;
BEGIN
 saved:=public.chob_save_event_bundle_v2(payload,task_payload,expected_updated_at);
 IF notice_payload IS NOT NULL THEN
  IF length(btrim(coalesce(notice_payload->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '活动通知标题需为 1–200 字。'; END IF;
  IF coalesce(notice_payload->>'source_url','')<>'' AND notice_payload->>'source_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
  IF (coalesce(notice_payload->>'title','')||' '||coalesce(notice_payload->>'body','')) LIKE '%延期%' THEN
   PERFORM chob_private.upsert_postponement_notice((saved->>'id')::uuid,notice_payload->>'title',notice_payload->>'body',notice_payload->>'source_url');
  ELSE
   INSERT INTO public.chob_announcements(title,body,source_url,event_id)
   VALUES(btrim(notice_payload->>'title'),coalesce(notice_payload->>'body',''),coalesce(notice_payload->>'source_url',''),(saved->>'id')::uuid);
  END IF;
 END IF;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_event_with_notice(jsonb,jsonb,text,jsonb) TO authenticated;

-- Standalone notice creation/editing uses the same merge rule and admin checks.
CREATE OR REPLACE FUNCTION public.chob_save_announcement(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid:=nullif(payload->>'id','')::uuid; selected_event uuid:=nullif(payload->>'event_id','')::uuid;
BEGIN
 PERFORM chob_private.require_admin();
 IF length(btrim(coalesce(payload->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '公告标题需为 1–200 字。'; END IF;
 IF coalesce(payload->>'source_url','')<>'' AND payload->>'source_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '消息来源必须是有效网页链接。'; END IF;
 IF selected_event IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.events WHERE id=selected_event) THEN RAISE EXCEPTION '关联活动不存在。'; END IF;
 IF result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chob_announcements WHERE id=result) THEN RAISE EXCEPTION '公告已不存在，请刷新。'; END IF;
 IF selected_event IS NOT NULL AND coalesce((payload->>'published')::boolean,true)
 AND (coalesce(payload->>'kind',(SELECT kind FROM public.chob_announcements WHERE id=result))='postponement'
 OR (coalesce(payload->>'title','')||' '||coalesce(payload->>'body','')) LIKE '%延期%') THEN
  RETURN chob_private.upsert_postponement_notice(selected_event,payload->>'title',payload->>'body',payload->>'source_url');
 END IF;
 IF result IS NULL THEN
  INSERT INTO public.chob_announcements(title,body,source_url,event_id,published,kind)
  VALUES(btrim(payload->>'title'),coalesce(payload->>'body',''),coalesce(payload->>'source_url',''),selected_event,coalesce((payload->>'published')::boolean,true),coalesce(nullif(payload->>'kind',''),'general')) RETURNING id INTO result;
 ELSE
  UPDATE public.chob_announcements SET title=btrim(payload->>'title'),body=coalesce(payload->>'body',''),source_url=coalesce(payload->>'source_url',''),event_id=selected_event,published=coalesce((payload->>'published')::boolean,true),updated_at=now() WHERE id=result;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.chob_save_announcement(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_announcement(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.chob_publish_announcement(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN public.chob_save_announcement((payload-'id')||'{"published":true}'::jsonb); END $$;
REVOKE ALL ON FUNCTION public.chob_publish_announcement(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_publish_announcement(jsonb) TO authenticated;
INSERT INTO chob_private.migrations(version) VALUES('037') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
