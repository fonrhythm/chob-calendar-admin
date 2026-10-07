-- Additive upgrade after 033. No legacy backfill, deletes, or identity changes.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-034'));
CREATE TABLE IF NOT EXISTS public.sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), url text NOT NULL CHECK(url ~* '^https?://[^[:space:]]+$'),
 platform text NOT NULL DEFAULT '', account text NOT NULL DEFAULT '', source_type text NOT NULL DEFAULT 'unknown',
 priority smallint NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 5),
 published_at timestamptz, fetched_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz,
 verification text NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified','disputed')),
 raw_evidence jsonb NOT NULL DEFAULT '{}', evidence_hash text GENERATED ALWAYS AS (md5(raw_evidence::text)) STORED,
 created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(url,evidence_hash)
);
COMMENT ON COLUMN public.sources.priority IS '1 official organizer/brand/event; 2 company/artist official; 3 official FC; 4 reliable ticketing/media; 5 fan/unknown. Human confirmed, never inferred from URL.';
CREATE TABLE IF NOT EXISTS public.venues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(btrim(name)<>''),
 city text, region text, address text, aliases text[] NOT NULL DEFAULT '{}', source_id uuid REFERENCES public.sources(id)
);
CREATE TABLE IF NOT EXISTS public.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(btrim(name)<>''),
 aliases text[] NOT NULL DEFAULT '{}', source_id uuid REFERENCES public.sources(id)
);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS parent_event_id uuid REFERENCES public.events(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS field_states jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.events ALTER COLUMN date DROP NOT NULL;
CREATE INDEX IF NOT EXISTS chob_events_venue_idx ON public.events(venue_id);
CREATE INDEX IF NOT EXISTS chob_events_parent_idx ON public.events(parent_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS chob_reviewed_identity_idx ON public.events((attributes->>'identity_key'))
WHERE nullif(attributes->>'identity_key','') IS NOT NULL AND attributes->>'admin_deleted_at' IS NULL AND attributes->>'merged_into' IS NULL;
CREATE TABLE IF NOT EXISTS public.event_sources (
 event_id uuid NOT NULL REFERENCES public.events(id), source_id uuid NOT NULL REFERENCES public.sources(id),
 role text NOT NULL DEFAULT 'announcement' CHECK(role IN ('announcement','update','ticketing','correction','evidence')),
 is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,source_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS chob_one_primary_source ON public.event_sources(event_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS chob_event_sources_source_idx ON public.event_sources(source_id);
CREATE TABLE IF NOT EXISTS public.event_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.events(id),
 field text NOT NULL, old_value jsonb, new_value jsonb, source_id uuid REFERENCES public.sources(id),
 changed_at timestamptz NOT NULL DEFAULT now(), changed_by uuid REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS chob_changes_event_idx ON public.event_changes(event_id,changed_at DESC);
CREATE INDEX IF NOT EXISTS chob_changes_source_idx ON public.event_changes(source_id);
CREATE TABLE IF NOT EXISTS public.artist_companies (
 artist_id uuid NOT NULL REFERENCES public.artists(id), company_id uuid NOT NULL REFERENCES public.companies(id),
 role text NOT NULL CHECK(role IN ('agency','label','management')), source_id uuid REFERENCES public.sources(id),
 PRIMARY KEY(artist_id,company_id,role)
);
CREATE TABLE IF NOT EXISTS public.event_companies (
 event_id uuid NOT NULL REFERENCES public.events(id), company_id uuid NOT NULL REFERENCES public.companies(id),
 role text NOT NULL CHECK(role IN ('organizer','promoter','brand','agency','label','sponsor','ticketing')),
 source_id uuid REFERENCES public.sources(id), PRIMARY KEY(event_id,company_id,role)
);
CREATE INDEX IF NOT EXISTS chob_artist_companies_company_idx ON public.artist_companies(company_id);
CREATE INDEX IF NOT EXISTS chob_artist_companies_source_idx ON public.artist_companies(source_id);
CREATE INDEX IF NOT EXISTS chob_event_companies_company_idx ON public.event_companies(company_id);
CREATE INDEX IF NOT EXISTS chob_event_companies_source_idx ON public.event_companies(source_id);
CREATE INDEX IF NOT EXISTS chob_venues_source_idx ON public.venues(source_id);
CREATE INDEX IF NOT EXISTS chob_companies_source_idx ON public.companies(source_id);
CREATE TABLE IF NOT EXISTS public.entity_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL CHECK(entity_type IN ('event','artist','venue','company','extraction')),
 event_id uuid REFERENCES public.events(id), source_id uuid REFERENCES public.sources(id),
 reason text NOT NULL, candidates jsonb NOT NULL DEFAULT '[]', evidence jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
 resolution text, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chob_reviews_queue_idx ON public.entity_reviews(status,created_at);
CREATE INDEX IF NOT EXISTS chob_reviews_event_idx ON public.entity_reviews(event_id);
CREATE INDEX IF NOT EXISTS chob_reviews_source_idx ON public.entity_reviews(source_id);
-- Tables are private to approved Web editors. Public projection below excludes raw evidence and user IDs.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sources','venues','companies','event_sources','event_changes','artist_companies','event_companies','entity_reviews'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('DROP POLICY IF EXISTS chob_editor_read ON public.%I',t);
 EXECUTE format('CREATE POLICY chob_editor_read ON public.%I FOR SELECT TO authenticated USING(chob_private.can_edit_events() AND NOT chob_private.is_wechat_session())',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION chob_private.require_provenance_editor() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT chob_private.can_edit_events() OR chob_private.is_wechat_session() THEN
 RAISE EXCEPTION '仅获批 Web 编辑者可管理来源与实体' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION chob_private.require_provenance_editor() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.chob_add_source(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result uuid; BEGIN
 PERFORM chob_private.require_provenance_editor();
 IF jsonb_typeof(payload)<>'object' OR NOT payload ? 'raw_evidence' THEN RAISE EXCEPTION '请保留原始证据'; END IF;
 INSERT INTO public.sources(url,platform,account,source_type,priority,published_at,fetched_at,verification,verified_at,raw_evidence,created_by)
 VALUES(payload->>'url',coalesce(payload->>'platform',''),coalesce(payload->>'account',''),coalesce(payload->>'source_type','unknown'),
 coalesce((payload->>'priority')::smallint,5),nullif(payload->>'published_at','')::timestamptz,
 coalesce(nullif(payload->>'fetched_at','')::timestamptz,now()),'unverified',NULL,payload->'raw_evidence',auth.uid())
 ON CONFLICT(url,evidence_hash) DO NOTHING RETURNING id INTO result;
 IF result IS NULL THEN SELECT id INTO result FROM public.sources WHERE url=payload->>'url' AND evidence_hash=md5((payload->'raw_evidence')::text); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.chob_verify_source(target uuid, verification text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM chob_private.require_provenance_editor();
 UPDATE public.sources SET verification=chob_verify_source.verification,verified_at=now() WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION '来源不存在'; END IF;
END $$;
-- Keep compatibility with the existing bundle: new attributes are mirrored to proper FK columns.
CREATE OR REPLACE FUNCTION chob_private.event_entity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE item record; sid uuid:=nullif(current_setting('chob.change_source',true),'')::uuid; BEGIN
 IF NEW.attributes ? 'venue_id' THEN NEW.venue_id:=nullif(NEW.attributes->>'venue_id','')::uuid; END IF;
 IF NEW.attributes ? 'parent_event_id' THEN NEW.parent_event_id:=nullif(NEW.attributes->>'parent_event_id','')::uuid; END IF;
 IF NEW.attributes ? 'field_states' THEN NEW.field_states:=NEW.attributes->'field_states'; END IF;
 IF jsonb_typeof(NEW.field_states) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '未知状态格式无效'; END IF;
 FOR item IN SELECT * FROM jsonb_each_text(NEW.field_states) LOOP
 IF item.key NOT IN ('date','time','location','artist_ids','ticket_url') OR item.value NOT IN ('known','tba','missing') THEN RAISE EXCEPTION '未知状态字段无效'; END IF;
 END LOOP;
 IF (TG_OP='INSERT' OR NEW.field_states IS DISTINCT FROM OLD.field_states OR (NEW.status='published' AND OLD.status IS DISTINCT FROM 'published'))
 AND EXISTS(SELECT 1 FROM jsonb_each_text(NEW.field_states) WHERE value='tba') AND NOT EXISTS(
 SELECT 1 FROM public.sources s WHERE s.verification='verified' AND s.priority<=3 AND
 (s.id=sid OR EXISTS(SELECT 1 FROM public.event_sources x WHERE x.event_id=NEW.id AND x.source_id=s.id))) THEN
 RAISE EXCEPTION '尚未公布状态需要已核验的官方来源'; END IF;
 IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') AND EXISTS(SELECT 1 FROM public.entity_reviews r WHERE r.event_id=NEW.id AND r.status='pending') THEN
 RAISE EXCEPTION '请先处理关联的实体匹配异常'; END IF;
 IF NEW.parent_event_id IS NOT NULL THEN
 -- Serialize hierarchy mutations to prevent concurrent cycles.
 PERFORM pg_advisory_xact_lock(hashtext('chob-parent-events'));
 IF NEW.parent_event_id=NEW.id OR EXISTS(WITH RECURSIVE parents AS (
 SELECT id,parent_event_id FROM public.events WHERE id=NEW.parent_event_id UNION
 SELECT e.id,e.parent_event_id FROM public.events e JOIN parents p ON e.id=p.parent_event_id
 ) SELECT 1 FROM parents WHERE id=NEW.id) THEN RAISE EXCEPTION '上级活动不能形成循环'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION chob_private.capture_company_relation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.event_changes(event_id,field,old_value,new_value,source_id,changed_by)
 VALUES(coalesce(NEW.event_id,OLD.event_id),'company_relation',CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
 CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END,coalesce(NEW.source_id,OLD.source_id),auth.uid());
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS chob_company_relation_history ON public.event_companies;
CREATE TRIGGER chob_company_relation_history AFTER INSERT OR UPDATE OR DELETE ON public.event_companies FOR EACH ROW EXECUTE FUNCTION chob_private.capture_company_relation();
DROP TRIGGER IF EXISTS chob_entity_guard ON public.events;
CREATE TRIGGER chob_entity_guard BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION chob_private.event_entity_guard();
CREATE OR REPLACE FUNCTION chob_private.capture_event_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f text; a jsonb; b jsonb; sid uuid:=nullif(current_setting('chob.change_source',true),'')::uuid;
BEGIN
 a:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END; b:=to_jsonb(NEW);
 FOREACH f IN ARRAY ARRAY['title','date','time','location','location_region','artist_ids','ticket_url','status','cancelled_at','venue_id','parent_event_id','field_states','company','description','participation_condition','event_type_id'] LOOP
 IF a->f IS DISTINCT FROM b->f THEN
 INSERT INTO public.event_changes(event_id,field,old_value,new_value,source_id,changed_by) VALUES(NEW.id,f,a->f,b->f,sid,auth.uid()); END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['time_text','end_date','event_status','picture_urls','postponed_to_date','artist_selections','admin_deleted_at'] LOOP
 IF a->'attributes'->f IS DISTINCT FROM b->'attributes'->f THEN
 INSERT INTO public.event_changes(event_id,field,old_value,new_value,source_id,changed_by) VALUES(NEW.id,f,a->'attributes'->f,b->'attributes'->f,sid,auth.uid()); END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chob_event_changes ON public.events;
CREATE TRIGGER chob_event_changes AFTER INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION chob_private.capture_event_changes();
CREATE OR REPLACE FUNCTION chob_private.capture_task_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f text; a jsonb:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 b jsonb:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 eid uuid:=coalesce(NEW.event_id,OLD.event_id); tid uuid:=coalesce(NEW.id,OLD.id);
 sid uuid:=nullif(current_setting('chob.change_source',true),'')::uuid;
BEGIN
 FOREACH f IN ARRAY ARRAY['title','task_type','start_date','end_date','start_time','end_time','action_url','status','description'] LOOP
 IF a->f IS DISTINCT FROM b->f THEN
 INSERT INTO public.event_changes(event_id,field,old_value,new_value,source_id,changed_by)
 VALUES(eid,'task:'||tid::text||':'||f,a->f,b->f,sid,auth.uid()); END IF;
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS chob_task_changes ON public.tasks;
CREATE TRIGGER chob_task_changes AFTER INSERT OR UPDATE OR DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION chob_private.capture_task_changes();
-- Approved retention change: audit-bearing trash stays hidden after its 3-day restore window.
-- Legacy expired rows without audit/dependencies keep the original purge behavior.
CREATE OR REPLACE FUNCTION chob_private.purge_event_trash() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ids uuid[]; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('chob_event_batch_import'));
 SELECT array_agg(id) INTO ids FROM (
 SELECT e.id FROM public.events e WHERE e.attributes->>'admin_deleted_at' IS NOT NULL AND e.trash_expires_at<=clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM public.event_changes x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.event_sources x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.event_companies x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.entity_reviews x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.events x WHERE x.parent_event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.tasks x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.chob_corrections x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.chob_messages x WHERE x.event_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM public.chob_submission_reviews x WHERE x.event_id=e.id)
 ORDER BY e.id FOR UPDATE) expired;
 IF ids IS NULL THEN RETURN 0; END IF;
 DELETE FROM public.tasks WHERE event_id=ANY(ids);
 DELETE FROM public.chob_corrections WHERE event_id=ANY(ids);
 UPDATE public.chob_announcements SET event_id=NULL WHERE event_id=ANY(ids);
 UPDATE public.chob_messages SET event_id=NULL WHERE event_id=ANY(ids);
 DELETE FROM public.events WHERE id=ANY(ids);
 RETURN cardinality(ids);
END $$;
REVOKE ALL ON FUNCTION chob_private.purge_event_trash() FROM PUBLIC,anon,authenticated;
-- Reuse the existing manual merge, including its existing ownership/favorite behavior.
-- Copy provenance to the kept event; originals/history remain attached to the withdrawn row.
DO $$ DECLARE original text; revised text; BEGIN
 SELECT pg_get_functiondef('public.chob_review_duplicates(uuid[],uuid,text)'::regprocedure) INTO original;
 IF strpos(original,'chob-provenance-merge')=0 THEN
 revised:=replace(original,'UPDATE public.tasks SET event_id=keep_id WHERE event_id=id_value;',
 '-- chob-provenance-merge
 INSERT INTO public.event_sources(event_id,source_id,role,is_primary) SELECT keep_id,source_id,role,false FROM public.event_sources WHERE event_id=id_value ON CONFLICT DO NOTHING;
 INSERT INTO public.event_companies(event_id,company_id,role,source_id) SELECT keep_id,company_id,role,source_id FROM public.event_companies WHERE event_id=id_value ON CONFLICT DO NOTHING;
 INSERT INTO public.event_changes(event_id,field,old_value,new_value,changed_by) SELECT keep_id,''merged_from'',to_jsonb(e.title),to_jsonb(k.title),auth.uid() FROM public.events e JOIN public.events k ON k.id=keep_id WHERE e.id=id_value;
 INSERT INTO public.entity_reviews(entity_type,event_id,reason,candidates,evidence)
 SELECT ''event'',keep_id,''Manual merge contains conflicting venue/parent relationships'',jsonb_build_array(id_value,keep_id),jsonb_build_object(''old_venue'',e.venue_id,''kept_venue'',k.venue_id,''old_parent'',e.parent_event_id,''kept_parent'',k.parent_event_id)
 FROM public.events e JOIN public.events k ON k.id=keep_id WHERE e.id=id_value AND
 ((e.venue_id IS NOT NULL AND k.venue_id IS NOT NULL AND e.venue_id<>k.venue_id) OR (e.parent_event_id IS NOT NULL AND k.parent_event_id IS NOT NULL AND e.parent_event_id<>k.parent_event_id));
 UPDATE public.tasks SET event_id=keep_id WHERE event_id=id_value;');
 IF revised=original THEN RAISE EXCEPTION '034: manual merge version mismatch; migration rolled back'; END IF;
 EXECUTE revised;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.chob_save_event_architecture(payload jsonb,task_payload jsonb,expected_updated_at text DEFAULT NULL,notice_payload jsonb DEFAULT NULL,provenance jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; sid uuid; entry jsonb; eid uuid:=(payload->>'id')::uuid; previous text:=current_setting('chob.change_source',true);
BEGIN
 PERFORM chob_private.require_provenance_editor();
 payload:=jsonb_set(payload,'{attributes,field_states}',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(coalesce(payload->'attributes'->'field_states','{}')) WHERE value<>'""'::jsonb),'{}'));
 IF payload->>'status'='published' AND EXISTS(SELECT 1 FROM public.entity_reviews r WHERE r.event_id=eid AND r.status='pending') THEN RAISE EXCEPTION '请先处理关联的实体匹配异常'; END IF;
 IF provenance ? 'new_source' THEN sid:=public.chob_add_source(provenance->'new_source');
 ELSE sid:=nullif(provenance->>'source_id','')::uuid; END IF;
 IF sid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sources WHERE id=sid) THEN RAISE EXCEPTION '来源不存在'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(coalesce(payload->'attributes'->'field_states','{}')) WHERE value='tba') AND sid IS NULL THEN
 RAISE EXCEPTION '官方尚未公布需关联公告证据'; END IF;
 PERFORM set_config('chob.change_source',coalesce(sid::text,''),true);
 IF notice_payload IS NOT NULL THEN result:=public.chob_save_event_with_notice(payload,task_payload,expected_updated_at,notice_payload);
 ELSE result:=public.chob_save_event_bundle_v2(payload,task_payload,expected_updated_at); END IF;
 IF sid IS NOT NULL THEN
 IF coalesce((provenance->>'is_primary')::boolean,false) THEN UPDATE public.event_sources SET is_primary=false WHERE event_id=eid; END IF;
 INSERT INTO public.event_sources(event_id,source_id,role,is_primary) VALUES(eid,sid,coalesce(provenance->>'role','announcement'),coalesce((provenance->>'is_primary')::boolean,false))
 ON CONFLICT(event_id,source_id) DO UPDATE SET role=excluded.role,is_primary=excluded.is_primary;
 END IF;
 IF provenance ? 'companies' THEN
 FOR entry IN SELECT value FROM jsonb_array_elements(provenance->'companies') LOOP
 INSERT INTO public.event_companies(event_id,company_id,role,source_id) VALUES(eid,(entry->>'company_id')::uuid,entry->>'role',sid) ON CONFLICT DO NOTHING;
 END LOOP;
 END IF;
 PERFORM set_config('chob.change_source',coalesce(previous,''),true);
 RETURN (SELECT to_jsonb(e) FROM public.events e WHERE id=eid);
END $$;
-- Explicit unknowns can be saved without fabricated calendar dates or venues.
-- All other validation and all Auth/UUID ownership logic remain in the existing RPC.
DO $$ DECLARE original text; revised text; BEGIN
 SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) INTO original;
 IF strpos(original,'chob-explicit-unknown')=0 THEN
 revised:=replace(original,'IF nullif(payload->>''date'','''') IS NULL THEN',
 'IF nullif(payload->>''date'','''') IS NULL AND NOT (coalesce(payload->''attributes''->''field_states''->>''date'','''')=''tba'' OR (payload->>''status''=''draft'' AND coalesce(payload->''attributes''->''field_states''->>''date'','''')=''missing'')) THEN');
 revised:=replace(revised,'IF nullif(btrim(payload->>''location''),'''') IS NULL THEN',
 'IF nullif(btrim(payload->>''location''),'''') IS NULL AND NOT (coalesce(payload->''attributes''->''field_states''->>''location'','''')=''tba'' OR (payload->>''status''=''draft'' AND coalesce(payload->''attributes''->''field_states''->>''location'','''')=''missing'')) THEN');
 revised:=replace(revised,'IF coalesce(array_length(artist_ids_value,1),0)=0',
 'IF coalesce(array_length(artist_ids_value,1),0)=0 AND NOT (coalesce(payload->''attributes''->''field_states''->>''artist_ids'','''')=''tba'' OR (payload->>''status''=''draft'' AND coalesce(payload->''attributes''->''field_states''->>''artist_ids'','''')=''missing''))');
 IF revised=original THEN RAISE EXCEPTION '034: event validation version mismatch; migration rolled back'; END IF;
 revised:=replace(revised,'-- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。','-- chob-explicit-unknown
 -- 锁定活动，阻止两份旧表单覆盖彼此的活动与事项。');
 EXECUTE revised;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.chob_add_entity(kind text,payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result uuid; BEGIN
 PERFORM chob_private.require_provenance_editor();
 IF kind='venue' THEN INSERT INTO public.venues(name,city,region,address,aliases,source_id)
 VALUES(payload->>'name',payload->>'city',payload->>'region',payload->>'address',ARRAY(SELECT jsonb_array_elements_text(coalesce(payload->'aliases','[]'))),nullif(payload->>'source_id','')::uuid) RETURNING id INTO result;
 ELSIF kind='company' THEN INSERT INTO public.companies(name,aliases,source_id)
 VALUES(payload->>'name',ARRAY(SELECT jsonb_array_elements_text(coalesce(payload->'aliases','[]'))),nullif(payload->>'source_id','')::uuid) RETURNING id INTO result;
 ELSE RAISE EXCEPTION '实体类型无效'; END IF; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.chob_link_artist_company(artist uuid,company uuid,company_role text,source uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM chob_private.require_provenance_editor();
 INSERT INTO public.artist_companies VALUES(artist,company,company_role,source) ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION public.chob_add_entity_review(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result uuid; BEGIN
 PERFORM chob_private.require_provenance_editor();
 INSERT INTO public.entity_reviews(entity_type,event_id,source_id,reason,candidates,evidence)
 VALUES(payload->>'entity_type',nullif(payload->>'event_id','')::uuid,nullif(payload->>'source_id','')::uuid,payload->>'reason',coalesce(payload->'candidates','[]'),coalesce(payload->'evidence','{}')) RETURNING id INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.chob_resolve_entity_review(target uuid,decision text,note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM chob_private.require_provenance_editor();
 IF decision NOT IN ('resolved','rejected') OR length(btrim(coalesce(note,'')))=0 THEN RAISE EXCEPTION '请填写审核结论'; END IF;
 UPDATE public.entity_reviews SET status=decision,resolution=note,reviewed_at=now(),reviewed_by=auth.uid() WHERE id=target AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION '该异常已处理或不存在'; END IF;
END $$;
-- The old public feed remains the authority for visibility, scheduling and cancelled events.
DO $$ BEGIN
 IF to_regprocedure('public.chob_public_feed_legacy034()') IS NULL THEN
 ALTER FUNCTION public.chob_public_feed() RENAME TO chob_public_feed_legacy034;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.chob_public_feed_legacy034() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.chob_public_feed() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE base jsonb; rows jsonb; BEGIN
 base:=public.chob_public_feed_legacy034();
 SELECT coalesce(jsonb_agg(r.value || jsonb_build_object(
 'field_states',e.field_states,'venue_entity',(SELECT jsonb_build_object('id',v.id,'name',v.name,'city',v.city) FROM public.venues v WHERE v.id=e.venue_id),
 'parent_event',(SELECT jsonb_build_object('id',p.id,'title',p.title) FROM public.events p WHERE p.id=e.parent_event_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(base->'records') q WHERE q->>'id'=p.id::text AND q->>'kind'='event')),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'url',s.url,'platform',s.platform,'account',s.account,'priority',s.priority,'verification',s.verification,'verified_at',s.verified_at,'role',x.role,'is_primary',x.is_primary) ORDER BY x.is_primary DESC,s.priority,s.created_at) FROM public.event_sources x JOIN public.sources s ON s.id=x.source_id WHERE x.event_id=e.id),'[]'),
 'last_verified_at',(SELECT max(s.verified_at) FROM public.event_sources x JOIN public.sources s ON s.id=x.source_id WHERE x.event_id=e.id AND s.verification='verified'),
 'changes',coalesce((SELECT jsonb_agg(jsonb_build_object('field',h.field,'old_value',h.old_value,'new_value',h.new_value,'changed_at',h.changed_at,'source_id',h.source_id) ORDER BY h.changed_at DESC) FROM (SELECT * FROM public.event_changes h WHERE h.event_id=e.id AND h.old_value IS NOT NULL AND h.field NOT IN ('admin_deleted_at','status') ORDER BY h.changed_at DESC LIMIT 30) h),'[]'),
 'companies',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'role',x.role,'source_id',x.source_id)) FROM public.event_companies x JOIN public.companies c ON c.id=x.company_id JOIN public.sources s ON s.id=x.source_id WHERE x.event_id=e.id AND s.verification='verified' AND s.priority<=4),'[]')
 )), '[]') INTO rows FROM jsonb_array_elements(base->'records') r(value)
 LEFT JOIN public.events e ON e.id=nullif(CASE WHEN r.value->>'kind'='task' THEN r.value->>'event_id' ELSE r.value->>'id' END,'')::uuid;
 RETURN jsonb_set(base,'{records}',rows);
END $$;
REVOKE ALL ON FUNCTION public.chob_public_feed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chob_public_feed() TO anon,authenticated;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['chob_add_source(jsonb)','chob_verify_source(uuid,text)','chob_save_event_architecture(jsonb,jsonb,text,jsonb,jsonb)','chob_add_entity(text,jsonb)','chob_link_artist_company(uuid,uuid,text,uuid)','chob_add_entity_review(jsonb)','chob_resolve_entity_review(uuid,text,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC,anon';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION chob_private.event_entity_guard(),chob_private.capture_event_changes(),chob_private.capture_company_relation(),chob_private.capture_task_changes() FROM PUBLIC,anon,authenticated;
INSERT INTO chob_private.migrations(version) VALUES('034') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
