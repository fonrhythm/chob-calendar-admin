-- Apply after 001–005. Transactional; no historical rows are deleted.
BEGIN;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS user_edit_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS user_submitted boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.chob_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.events(id),
 user_id uuid NOT NULL REFERENCES public.users(id), fields text[] NOT NULL,
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','correct','changed','other')),
 reply text, resolved_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.chob_announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES public.events(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), body text NOT NULL DEFAULT '',
 source_url text NOT NULL DEFAULT '' CHECK(source_url='' OR source_url ~* '^https?://[^[:space:]]+$'),
 published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.chob_personal (
 id uuid PRIMARY KEY REFERENCES public.users(id), nickname text NOT NULL DEFAULT '',
 favorites text[] NOT NULL DEFAULT '{}', artist_favorites text[] NOT NULL DEFAULT '{}',
 items text[] NOT NULL DEFAULT '{}', tags jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.chob_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 event_id uuid REFERENCES public.events(id), content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chob_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chob_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chob_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chob_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chob_corrections,public.chob_announcements,public.chob_personal,public.chob_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.chob_corrections,public.chob_announcements,public.chob_personal,public.chob_messages TO authenticated;
DROP POLICY IF EXISTS chob_correction_read ON public.chob_corrections;
CREATE POLICY chob_correction_read ON public.chob_corrections FOR SELECT TO authenticated USING(user_id=auth.uid() OR chob_private.is_admin());
DROP POLICY IF EXISTS chob_announcement_read ON public.chob_announcements;
CREATE POLICY chob_announcement_read ON public.chob_announcements FOR SELECT TO authenticated USING(published OR chob_private.is_admin());
DROP POLICY IF EXISTS chob_personal_read ON public.chob_personal;
CREATE POLICY chob_personal_read ON public.chob_personal FOR SELECT TO authenticated USING(id=auth.uid());
DROP POLICY IF EXISTS chob_message_read ON public.chob_messages;
CREATE POLICY chob_message_read ON public.chob_messages FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.chob_activity_category(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN lower(value) IN ('interaction','music','brand','screen','broadcast','other') THEN lower(value)
 WHEN value ~* '见面|互动|签售|粉丝|fan.?meet|fan.?sign' THEN 'interaction'
 WHEN value ~* '音乐|演唱|演出|音乐节|concert|festival|livehouse|stage' THEN 'music'
 WHEN value ~* '品牌|商务|站台|代言|brand' THEN 'brand'
 WHEN value ~* '影视|剧集|电影|首映|series|screen|premiere' THEN 'screen'
 WHEN value ~* '节目|直播|广播|电台|broadcast|live|radio|综艺' THEN 'broadcast' ELSE 'other' END;
$$;

CREATE OR REPLACE FUNCTION public.chob_public_feed() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH published AS (
 SELECT e.*, coalesce(e.attributes,'{}'::jsonb) AS attrs FROM public.events e
 WHERE e.status='published' AND (e.scheduled_publish_at IS NULL OR e.scheduled_publish_at<=now())
 ), event_rows AS (
 SELECT e.id, jsonb_build_object(
 'id',e.id,'kind','event','date',e.date,'end_date',coalesce(e.attrs->>'end_date',''),
 'name',coalesce(nullif(e.attrs->>'unmatched_artist',''),(SELECT string_agg(a.name,' / ' ORDER BY a.name) FROM public.artists a WHERE a.id=ANY(e.artist_ids)),'待补充艺人'),
 'artist_ids',e.artist_ids,'artist_names',(SELECT coalesce(jsonb_agg(a.name),'[]'::jsonb) FROM public.artists a WHERE a.id=ANY(e.artist_ids)),
 'region',CASE e.attrs->>'region' WHEN '中国' THEN 'china' WHEN '泰国' THEN 'thailand' WHEN '其他国家或地区' THEN 'oversea' WHEN '线上' THEN 'oversea' ELSE coalesce(e.attrs->>'region','thailand') END,
 'category',coalesce(e.attrs->>'category',CASE e.attrs->>'artist_type' WHEN 'BL演员' THEN 'bl' WHEN 'GL演员' THEN 'gl' WHEN '歌手' THEN 'singer' WHEN '乐队' THEN 'band' WHEN '组合' THEN 'group' WHEN '演员' THEN 'actor' ELSE 'other' END),
 'activity',e.title,'type',coalesce((SELECT to_jsonb(t)->>'name' FROM public.event_type_definitions t WHERE t.id=e.event_type_id),'其他'),
 'activity_type',public.chob_activity_category(coalesce(e.attrs->>'activity_category',(SELECT to_jsonb(t)->>'name' FROM public.event_type_definitions t WHERE t.id=e.event_type_id))), 'time',coalesce(nullif(e.attrs->>'time_text',''),e.time::text,''),
 'venue',e.location,'city',e.location_region,'company',e.company,'note',coalesce(e.attrs->>'note',e.description,''),
 'link',e.ticket_url,'images',coalesce(e.attrs->'picture_urls','[]'::jsonb),'isofficial',coalesce(e.attrs->'isofficial',to_jsonb(e)->'is_official','false'::jsonb),
 'roll_call',coalesce(e.attrs->'roll_call','false'::jsonb),'recurring_daily',coalesce(e.attrs->'recurring_daily','false'::jsonb),
 'event_status',CASE WHEN e.cancelled_at IS NOT NULL THEN 'cancelled' ELSE coalesce(e.attrs->>'event_status','active') END,
 'postponed_to_date',coalesce(e.attrs->>'postponed_to_date',''),'original_date',coalesce(e.attrs->>'original_date',''),
 'related_event_id',e.attrs->>'related_event_id','updated_at',e.updated_at,
 'pending_fields',coalesce((SELECT jsonb_agg(DISTINCT field) FROM public.chob_corrections c CROSS JOIN LATERAL unnest(c.fields) field WHERE c.event_id=e.id AND c.status='pending'),'[]'::jsonb)
 ) AS record FROM published e
 ), records AS (
 SELECT record FROM event_rows
 UNION ALL SELECT e.record || jsonb_build_object('id',t.id,'event_id',t.event_id,'kind','task','task_type',t.task_type,'date',t.start_date,'end_date',t.end_date,'time',t.start_time,'end_time',t.end_time,'activity',t.title,'note',t.description,'link',t.action_url)
 FROM public.tasks t JOIN event_rows e ON e.id=t.event_id WHERE t.status='published' AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
 )
 SELECT jsonb_build_object('records',coalesce((SELECT jsonb_agg(record) FROM records),'[]'::jsonb),
 'artists',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'company',a.company,'categories',a.categories,'group_kind',a.group_kind)) FROM public.artists a WHERE a.deleted_at IS NULL),'[]'::jsonb) || coalesce((SELECT jsonb_agg(jsonb_build_object('id','cp:'||c.id::text,'name',c.cp_name,'company','','categories',jsonb_build_array('CP'),'member_ids',jsonb_build_array(c.artist_1_id,c.artist_2_id))) FROM public.cp_pairs c WHERE c.deleted_at IS NULL),'[]'::jsonb),
 'types',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM (VALUES ('interaction','见面互动'),('music','音乐演出'),('brand','品牌商务'),('screen','影视宣传'),('broadcast','节目／直播'),('other','其他')) AS kinds(id,name)),
 'conditions',coalesce((SELECT jsonb_agg(jsonb_build_object('code',t.code,'name',to_jsonb(t)->>'name')) FROM public.participation_conditions t),'[]'::jsonb),
 'announcements',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.chob_announcements a WHERE a.published),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.chob_public_feed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chob_public_feed() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.chob_report_correction(target uuid, field_names text[], details text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 IF NOT chob_private.active_member() THEN RAISE EXCEPTION '请先登录并验证邮箱。' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=target AND status='published' AND (scheduled_publish_at IS NULL OR scheduled_publish_at<=now())) THEN RAISE EXCEPTION '活动不存在或尚未公开。'; END IF;
 IF coalesce(array_length(field_names,1),0)=0 OR NOT field_names <@ ARRAY['name','activity','date','time','venue','city','company','note','images','link'] THEN RAISE EXCEPTION '请选择需要核实的内容。'; END IF;
 INSERT INTO public.chob_corrections(event_id,user_id,fields,content) VALUES(target,auth.uid(),field_names,btrim(details)) RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.chob_resolve_correction(report_id uuid, decision text, response text, changes jsonb DEFAULT '{}', notify_users boolean DEFAULT false, source_url text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report public.chob_corrections; event_row public.events; attrs jsonb;
BEGIN
 PERFORM chob_private.require_admin();
 IF decision NOT IN ('correct','changed','other') OR length(btrim(coalesce(response,'')))=0 THEN RAISE EXCEPTION '请选择处理结果并填写回复。'; END IF;
 SELECT * INTO report FROM public.chob_corrections WHERE id=report_id FOR UPDATE;
 IF NOT FOUND OR report.status<>'pending' THEN RAISE EXCEPTION '该纠错已经处理或不存在，请刷新。'; END IF;
 SELECT * INTO event_row FROM public.events WHERE id=report.event_id FOR UPDATE;
 attrs:=coalesce(event_row.attributes,'{}'::jsonb);
 IF decision='changed' THEN
  IF jsonb_typeof(changes) IS DISTINCT FROM 'object' OR changes='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(changes) k WHERE k NOT IN ('activity','date','time','venue','city','company','note','link','name','images')) THEN RAISE EXCEPTION '请提供有效更正内容。'; END IF;
  IF changes ? 'activity' AND length(btrim(changes->>'activity')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '活动名称需为 1–200 字。'; END IF;
  IF changes ? 'date' AND nullif(changes->>'date','') IS NULL THEN RAISE EXCEPTION '日期不可为空。'; END IF;
  IF changes ? 'link' AND coalesce(changes->>'link','')<>'' AND changes->>'link' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '来源链接无效。'; END IF;
  IF changes ? 'images' THEN
   IF jsonb_typeof(changes->'images') IS DISTINCT FROM 'array' OR jsonb_array_length(changes->'images')>9 THEN RAISE EXCEPTION '图片应为最多九个链接。'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(changes->'images') p(url) WHERE url !~* '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION '图片链接无效。'; END IF;
   attrs:=attrs || jsonb_build_object('picture_urls',changes->'images');
  END IF;
  IF changes ? 'note' THEN attrs:=attrs || jsonb_build_object('note',changes->>'note'); END IF;
  IF changes ? 'name' THEN attrs:=attrs || jsonb_build_object('unmatched_artist',changes->>'name'); END IF;
  IF changes ? 'time' THEN attrs:=attrs || jsonb_build_object('time_text',changes->>'time'); END IF;
  UPDATE public.events SET title=CASE WHEN changes ? 'activity' THEN btrim(changes->>'activity') ELSE title END,
   date=CASE WHEN changes ? 'date' THEN (changes->>'date')::date ELSE date END,
   location=CASE WHEN changes ? 'venue' THEN changes->>'venue' ELSE location END,
   location_region=CASE WHEN changes ? 'city' THEN changes->>'city' ELSE location_region END,
   company=CASE WHEN changes ? 'company' THEN changes->>'company' ELSE company END,
   ticket_url=CASE WHEN changes ? 'link' THEN nullif(changes->>'link','') ELSE ticket_url END, attributes=attrs WHERE id=report.event_id;
 END IF;
 UPDATE public.events SET updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=report.event_id;
 UPDATE public.chob_corrections SET status=decision,reply=response,resolved_at=now(),resolved_by=auth.uid() WHERE id=report_id;
 INSERT INTO public.chob_messages(user_id,event_id,content) VALUES(report.user_id,report.event_id,response);
 IF notify_users THEN INSERT INTO public.chob_announcements(event_id,title,body,source_url) VALUES(report.event_id,left(event_row.title || '变动',200),response,source_url); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.chob_save_personal(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.chob_personal; f text[]; a text[]; i text[];
BEGIN
 IF NOT chob_private.active_member() THEN RAISE EXCEPTION '请先登录并验证邮箱。' USING ERRCODE='42501'; END IF;
 IF length(coalesce(payload->>'nickname',''))>100 OR length(payload::text)>100000 THEN RAISE EXCEPTION '个人资料过长。'; END IF;
 IF jsonb_typeof(payload->'favorites') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'artist_favorites') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'tags') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '个人资料格式不正确。'; END IF;
 SELECT coalesce(array_agg(DISTINCT value),'{}') INTO f FROM jsonb_array_elements_text(payload->'favorites');
 SELECT coalesce(array_agg(DISTINCT value),'{}') INTO a FROM jsonb_array_elements_text(payload->'artist_favorites');
 SELECT coalesce(array_agg(DISTINCT value),'{}') INTO i FROM jsonb_array_elements_text(payload->'items');
 IF EXISTS(SELECT 1 FROM unnest(i) item WHERE NOT EXISTS(SELECT 1 FROM public.events e WHERE 'supabase:'||e.id::text=item AND e.status='published')) THEN RAISE EXCEPTION '我的事项只能添加已有公开活动。'; END IF;
 INSERT INTO public.chob_personal(id,nickname,favorites,artist_favorites,items,tags) VALUES(auth.uid(),coalesce(payload->>'nickname',''),f,a,i,payload->'tags')
 ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,favorites=excluded.favorites,artist_favorites=excluded.artist_favorites,items=excluded.items,tags=excluded.tags,updated_at=now() RETURNING * INTO result;
 RETURN to_jsonb(result);
END $$;

CREATE OR REPLACE FUNCTION public.chob_submit_event(payload jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid:=coalesce(record_id,gen_random_uuid()); old public.events; ids uuid[]; attrs jsonb; pictures jsonb:=coalesce(payload->'images','[]'::jsonb);
BEGIN
 IF NOT chob_private.active_member() THEN RAISE EXCEPTION '请先登录并验证邮箱。' USING ERRCODE='42501'; END IF;
 IF coalesce(length(btrim(payload->>'activity')),0) NOT BETWEEN 1 AND 200 OR nullif(payload->>'date','') IS NULL THEN RAISE EXCEPTION '请填写活动名称与日期。'; END IF;
 IF coalesce(payload->>'region','') NOT IN ('china','thailand','oversea') THEN RAISE EXCEPTION '请选择地区。'; END IF;
 IF coalesce(length(btrim(payload->>'city')),0)=0 THEN RAISE EXCEPTION '请填写城市、线上直播或非公开。'; END IF;
 IF jsonb_typeof(pictures) IS DISTINCT FROM 'array' OR jsonb_array_length(pictures)>9 THEN RAISE EXCEPTION '最多九张图片。'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(pictures) p(url) WHERE url IS NULL OR url !~* '^https?://[^[:space:]]+$') THEN RAISE EXCEPTION '图片链接无效。'; END IF;
 IF nullif(payload->>'ticket_url','') IS NOT NULL AND payload->>'ticket_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION '票务链接无效。'; END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(coalesce(payload->'artist_ids','[]'::jsonb));
 IF EXISTS(SELECT 1 FROM unnest(ids) i WHERE NOT EXISTS(SELECT 1 FROM public.artists a WHERE a.id=i AND a.deleted_at IS NULL)) THEN RAISE EXCEPTION '艺人已不存在，请重新选择。'; END IF;
 IF cardinality(ids)=0 AND coalesce(length(btrim(payload->>'unmatched_artist')),0)=0 THEN RAISE EXCEPTION '请选择艺人，或勾选没有匹配的艺人后填写。'; END IF;
 IF nullif(payload->>'end_date','') IS NOT NULL AND (payload->>'end_date')::date<(payload->>'date')::date THEN RAISE EXCEPTION '结束日期不能早于开始日期。'; END IF;
 attrs:=jsonb_build_object('region',payload->>'region','category',payload->>'category','time_text',payload->>'time',
  'artist_reviewed',false,'duplicate_reviewed',false,'activity_category',public.chob_activity_category(payload->>'activity_category'),'note',coalesce(payload->>'note',''),'picture_urls',pictures,'unmatched_artist',coalesce(payload->>'unmatched_artist',''),
  'ticket_type',coalesce(payload->>'ticket_type',''),'participation_info',coalesce(payload->>'participation_info',''),'sale_date',coalesce(payload->>'sale_date',''),'sale_time',coalesce(payload->>'sale_time',''),'recurring_daily',coalesce((payload->>'recurring_daily')::boolean,false),'end_date',coalesce(payload->>'end_date',''));
 IF record_id IS NOT NULL THEN
  SELECT * INTO old FROM public.events WHERE id=target FOR UPDATE;
  IF NOT FOUND OR old.created_by<>auth.uid() OR NOT old.user_submitted THEN RAISE EXCEPTION '只能编辑自己提交的活动。' USING ERRCODE='42501'; END IF;
  IF nullif(old.attributes->>'related_event_id','') IS NOT NULL AND old.date IS DISTINCT FROM (payload->>'date')::date THEN RAISE EXCEPTION '已关联延期的活动日期请联系管理员修改。'; END IF;
  IF old.user_edit_count>=3 THEN RAISE EXCEPTION '三次编辑机会已用完，请联系管理员。'; END IF;
  IF old.updated_at IS DISTINCT FROM nullif(expected_updated_at,'')::timestamp THEN RAISE EXCEPTION '活动已更新，请刷新后再编辑。'; END IF;
  UPDATE public.events SET title=btrim(payload->>'activity'),date=(payload->>'date')::date,location=coalesce(payload->>'venue',''),location_region=payload->>'city',company=payload->>'company',
   artist_ids=ids,event_type_id=nullif(payload->>'event_type_id','')::uuid,ticket_url=nullif(payload->>'ticket_url',''),attributes=coalesce(attributes,'{}'::jsonb)||attrs,user_edit_count=user_edit_count+1,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=target;
 ELSE
  INSERT INTO public.events(id,title,date,location,location_region,company,artist_ids,event_type_id,ticket_url,attributes,status,created_by,created_at,updated_at,user_submitted)
  VALUES(target,btrim(payload->>'activity'),(payload->>'date')::date,coalesce(payload->>'venue',''),payload->>'city',payload->>'company',ids,nullif(payload->>'event_type_id','')::uuid,nullif(payload->>'ticket_url',''),attrs,'published',auth.uid(),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC',true);
 END IF;
 RETURN target;
END $$;

CREATE OR REPLACE FUNCTION public.chob_postpone_event(target uuid, new_date date, notify_users boolean DEFAULT false, source_url text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original public.events; new_id uuid:=gen_random_uuid();
BEGIN
 PERFORM chob_private.require_admin();
 SELECT * INTO original FROM public.events WHERE id=target FOR UPDATE;
 IF NOT FOUND OR new_date IS NULL OR new_date=original.date OR original.attributes->>'event_status' IN ('postponed','cancelled') OR original.cancelled_at IS NOT NULL THEN RAISE EXCEPTION '请选择未取消、未关联延期的活动与不同的新日期。'; END IF;
 INSERT INTO public.events(id,title,date,time,location,location_region,company,artist_ids,event_type_id,participation_condition,description,ticket_url,status,created_by,created_at,updated_at,attributes)
 VALUES(new_id,original.title,new_date,original.time,original.location,original.location_region,original.company,original.artist_ids,original.event_type_id,original.participation_condition,original.description,original.ticket_url,original.status,auth.uid(),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC',
 (coalesce(original.attributes,'{}'::jsonb)-'end_date'-'postponed_to_date')||jsonb_build_object('event_status','active','original_date',original.date,'related_event_id',target));
 UPDATE public.events SET attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('event_status','postponed','postponed_to_date',new_date,'related_event_id',new_id),updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=target;
 UPDATE public.chob_personal SET favorites=array_replace(favorites,'supabase:'||target::text,'supabase:'||new_id::text),items=array_replace(items,'supabase:'||target::text,'supabase:'||new_id::text),tags=CASE WHEN tags ? ('supabase:'||target::text) THEN (tags-('supabase:'||target::text))||jsonb_build_object('supabase:'||new_id::text,tags->('supabase:'||target::text)) ELSE tags END;
 IF notify_users THEN INSERT INTO public.chob_announcements(event_id,title,body,source_url) VALUES(new_id,left(original.title||'延期',200),'原 '||original.date::text||' 延期至 '||new_date::text,source_url); END IF;
 RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.chob_report_correction(uuid,text[],text),public.chob_resolve_correction(uuid,text,text,jsonb,boolean,text),public.chob_save_personal(jsonb),public.chob_submit_event(jsonb,uuid,text),public.chob_postpone_event(uuid,date,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_report_correction(uuid,text[],text),public.chob_resolve_correction(uuid,text,text,jsonb,boolean,text),public.chob_save_personal(jsonb),public.chob_submit_event(jsonb,uuid,text),public.chob_postpone_event(uuid,date,boolean,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.chob_my_submissions() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC),'[]'::jsonb) FROM public.events e WHERE e.created_by=auth.uid() AND e.user_submitted AND chob_private.active_member() $$;
REVOKE ALL ON FUNCTION public.chob_my_submissions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_my_submissions() TO authenticated;

CREATE OR REPLACE FUNCTION public.chob_publish_announcement(payload jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; BEGIN PERFORM chob_private.require_admin();
 INSERT INTO public.chob_announcements(title,body,source_url,event_id) VALUES(btrim(payload->>'title'),coalesce(payload->>'body',''),coalesce(payload->>'source_url',''),nullif(payload->>'event_id','')::uuid) RETURNING id INTO result; RETURN result; END $$;
CREATE OR REPLACE FUNCTION public.chob_review_artist(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM chob_private.require_admin();
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=target AND cardinality(artist_ids)>0) THEN RAISE EXCEPTION '请先为活动匹配正式艺人。'; END IF;
 UPDATE public.events SET attributes=(coalesce(attributes,'{}'::jsonb)-'unmatched_artist')||'{"artist_reviewed":true}'::jsonb,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=target; END $$;
CREATE OR REPLACE FUNCTION public.chob_review_duplicates(record_ids uuid[], keep_id uuid, decision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id_value uuid; BEGIN PERFORM chob_private.require_admin();
 IF decision NOT IN ('merge','keep','withdraw') OR cardinality(record_ids)<1 OR cardinality(record_ids)>100 OR NOT keep_id=ANY(record_ids) THEN RAISE EXCEPTION '重复记录处理参数无效。'; END IF;
 PERFORM 1 FROM public.events WHERE id=ANY(record_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.events WHERE id=ANY(record_ids))<>cardinality(record_ids) THEN RAISE EXCEPTION '活动已不存在或编号重复。'; END IF;
 FOREACH id_value IN ARRAY record_ids LOOP
  IF decision='merge' AND id_value<>keep_id THEN
   UPDATE public.tasks SET event_id=keep_id WHERE event_id=id_value;
   UPDATE public.chob_corrections SET event_id=keep_id WHERE event_id=id_value;
   UPDATE public.chob_personal SET favorites=array_replace(favorites,'supabase:'||id_value::text,'supabase:'||keep_id::text),items=array_replace(items,'supabase:'||id_value::text,'supabase:'||keep_id::text),tags=CASE WHEN tags ? ('supabase:'||id_value::text) THEN (tags-('supabase:'||id_value::text)) || jsonb_build_object('supabase:'||keep_id::text,coalesce(tags->('supabase:'||keep_id::text),tags->('supabase:'||id_value::text))) ELSE tags END;
   UPDATE public.chob_announcements SET event_id=keep_id WHERE event_id=id_value;
   UPDATE public.chob_messages SET event_id=keep_id WHERE event_id=id_value;
   UPDATE public.events SET status='withdrawn',attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('merged_into',keep_id) WHERE id=id_value;
  ELSIF decision='withdraw' THEN UPDATE public.events SET status='withdrawn' WHERE id=id_value;
  END IF;
  UPDATE public.events SET attributes=coalesce(attributes,'{}'::jsonb)||'{"duplicate_reviewed":true}'::jsonb,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=id_value;
 END LOOP; END $$;
REVOKE ALL ON FUNCTION public.chob_publish_announcement(jsonb),public.chob_review_artist(uuid),public.chob_review_duplicates(uuid[],uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_publish_announcement(jsonb),public.chob_review_artist(uuid),public.chob_review_duplicates(uuid[],uuid,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
