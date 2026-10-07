-- Additive, repeatable upgrade after 034. No remote execution is performed by the installer.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-035'));
DO $$ BEGIN
 IF to_regclass('public.sources') IS NULL OR to_regclass('public.event_sources') IS NULL
    OR to_regclass('public.entity_reviews') IS NULL
    OR to_regprocedure('public.chob_save_event_architecture(jsonb,jsonb,text,jsonb,jsonb)') IS NULL THEN
  RAISE EXCEPTION '035 requires 034_provenance_entities.sql. Run 034 successfully in this same database, then rerun 035.';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.source_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL CHECK(platform IN ('x','facebook','instagram','ticketmelon','website')),
 account text NOT NULL CHECK(btrim(account)<>''), url text NOT NULL CHECK(url ~* '^https?://[^[:space:]]+$'),
 source_type text NOT NULL DEFAULT 'unknown' CHECK(source_type IN ('organizer','brand','event_official','company_official','artist_official','official_fc','ticketing','media','fan','unknown')),
 notes text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT false, reviewed boolean NOT NULL DEFAULT false,
 start_at timestamptz NOT NULL, cursor jsonb, lease_until timestamptz, active_run uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(platform,account)
);
CREATE TABLE IF NOT EXISTS public.automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.source_accounts(id),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, start_cursor jsonb, end_cursor jsonb,
 counts jsonb NOT NULL DEFAULT '{}', error text, status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed'))
);
CREATE TABLE IF NOT EXISTS public.automation_receipts (
 account_id uuid NOT NULL REFERENCES public.source_accounts(id), post_id text NOT NULL, content_hash text NOT NULL,
 source_id uuid NOT NULL REFERENCES public.sources(id), event_id uuid REFERENCES public.events(id), review_id uuid REFERENCES public.entity_reviews(id),
 action text NOT NULL CHECK(action IN ('created','updated','linked','review','content','excluded')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,post_id,content_hash)
);
CREATE TABLE IF NOT EXISTS public.source_contents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL UNIQUE REFERENCES public.sources(id),
 kind text NOT NULL CHECK(kind IN ('episode','trailer','mv','song','album','broadcast')),
 extraction jsonb NOT NULL, translations jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chob_automation_runs_account ON public.automation_runs(account_id,started_at DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['source_accounts','automation_runs','automation_receipts','source_contents'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('DROP POLICY IF EXISTS chob_editor_read ON public.%I',t);
 EXECUTE format('CREATE POLICY chob_editor_read ON public.%I FOR SELECT TO authenticated USING(chob_private.can_edit_events() AND NOT chob_private.is_wechat_session())',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.chob_save_source_account(payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result uuid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid()); BEGIN
 PERFORM chob_private.require_provenance_editor();
 INSERT INTO public.source_accounts(id,platform,account,url,source_type,notes,enabled,reviewed,start_at)
 VALUES(result,payload->>'platform',payload->>'account',payload->>'url',coalesce(payload->>'source_type','unknown'),coalesce(payload->>'notes',''),coalesce((payload->>'enabled')::boolean,false),coalesce((payload->>'reviewed')::boolean,false),(payload->>'start_at')::timestamptz)
 ON CONFLICT(id) DO UPDATE SET url=excluded.url,source_type=excluded.source_type,notes=excluded.notes,enabled=excluded.enabled,reviewed=excluded.reviewed,updated_at=now();
 -- Identity and initial range are immutable on editing: add another account for a new range.
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.chob_claim_scan(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE a public.source_accounts; rid uuid:=gen_random_uuid(); BEGIN
 PERFORM chob_private.require_provenance_editor();
 SELECT * INTO a FROM public.source_accounts WHERE id=target FOR UPDATE;
 IF NOT FOUND OR NOT a.enabled OR a.lease_until>now() THEN RETURN NULL; END IF;
 IF a.active_run IS NOT NULL THEN UPDATE public.automation_runs SET status='failed',finished_at=now(),error='Worker lease expired' WHERE id=a.active_run AND status='running'; END IF;
 INSERT INTO public.automation_runs(id,account_id,start_cursor,end_cursor) VALUES(rid,target,a.cursor,a.cursor);
 UPDATE public.source_accounts SET active_run=rid,lease_until=now()+interval '5 minutes' WHERE id=target;
 RETURN jsonb_build_object('id',rid,'cursor',a.cursor);
END $$;
CREATE OR REPLACE FUNCTION public.chob_checkpoint_scan(target uuid,new_cursor jsonb,metrics jsonb,scan_error text DEFAULT NULL,finished boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE a public.source_accounts; BEGIN
 PERFORM chob_private.require_provenance_editor();
 SELECT s.* INTO a FROM public.source_accounts s JOIN public.automation_runs r ON r.account_id=s.id WHERE r.id=target FOR UPDATE OF s;
 IF NOT FOUND OR a.active_run IS DISTINCT FROM target OR a.lease_until<=now() THEN RAISE EXCEPTION 'Scan lease lost'; END IF;
 UPDATE public.automation_runs SET counts=metrics,error=scan_error,end_cursor=CASE WHEN finished THEN end_cursor ELSE new_cursor END,
 status=CASE WHEN finished THEN CASE WHEN scan_error IS NULL THEN 'success' ELSE 'failed' END ELSE 'running' END,finished_at=CASE WHEN finished THEN now() END WHERE id=target;
 UPDATE public.source_accounts SET cursor=CASE WHEN finished THEN cursor ELSE new_cursor END,active_run=CASE WHEN finished THEN NULL ELSE target END,
 lease_until=CASE WHEN finished THEN NULL ELSE now()+interval '5 minutes' END,updated_at=now() WHERE id=a.id;
END $$;
-- Event, linked source, history, announcement and receipt commit in ONE transaction.
CREATE OR REPLACE FUNCTION public.chob_commit_automation(account_id uuid,post_id text,content_hash text,source_id uuid,action text,payload jsonb DEFAULT NULL,task_payload jsonb DEFAULT '[]',expected_updated_at text DEFAULT NULL,notice_payload jsonb DEFAULT NULL,review_payload jsonb DEFAULT NULL,content_payload jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.automation_receipts; result jsonb; rid uuid; eid uuid; a public.source_accounts; BEGIN
 PERFORM chob_private.require_provenance_editor();
 IF btrim(coalesce(post_id,''))='' OR content_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid post identity'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(account_id::text||':'||post_id||':'||content_hash));
 SELECT * INTO existing FROM public.automation_receipts r WHERE r.account_id=chob_commit_automation.account_id AND r.post_id=chob_commit_automation.post_id AND r.content_hash=chob_commit_automation.content_hash;
 IF FOUND THEN RETURN jsonb_build_object('action','duplicate','eventId',existing.event_id); END IF;
 SELECT * INTO a FROM public.source_accounts s WHERE s.id=account_id;
 IF NOT FOUND OR NOT a.enabled THEN RAISE EXCEPTION 'Source account disabled or missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sources s WHERE s.id=source_id AND s.account=a.account AND s.platform=a.platform AND s.source_type=a.source_type) THEN RAISE EXCEPTION 'Source account mismatch'; END IF;
 IF action IN ('created','updated','linked') THEN
   IF NOT a.reviewed OR a.source_type NOT IN ('organizer','brand','event_official','company_official','artist_official') THEN RAISE EXCEPTION 'Source cannot auto-publish'; END IF;
   IF EXISTS(SELECT 1 FROM public.sources s WHERE s.id=source_id AND s.verification='disputed') THEN RAISE EXCEPTION 'Disputed evidence requires human review'; END IF;
   IF payload IS NULL OR payload->>'status' NOT IN ('draft','published') THEN RAISE EXCEPTION 'Invalid event bundle'; END IF;
   eid:=(payload->>'id')::uuid;
   IF EXISTS(SELECT 1 FROM public.events e WHERE e.id=eid AND (e.attributes ? 'admin_deleted_at' OR e.attributes ? 'merged_into')) THEN RAISE EXCEPTION 'Event is archived'; END IF;
   PERFORM public.chob_verify_source(source_id,'verified');
   result:=public.chob_save_event_architecture(payload,task_payload,expected_updated_at,notice_payload,jsonb_build_object('source_id',source_id,'role',CASE WHEN action='created' THEN 'announcement' ELSE 'update' END,'is_primary',action='created'));
 ELSIF action='review' THEN
   rid:=public.chob_add_entity_review(coalesce(review_payload,'{}')||jsonb_build_object('source_id',source_id));
 ELSIF action='content' THEN
   INSERT INTO public.source_contents(source_id,kind,extraction,translations) VALUES(chob_commit_automation.source_id,content_payload->>'kind',content_payload->'facts',coalesce(content_payload->'translations','{}')) ON CONFLICT ON CONSTRAINT source_contents_source_id_key DO NOTHING;
 ELSIF action<>'excluded' THEN RAISE EXCEPTION 'Invalid processing action'; END IF;
 INSERT INTO public.automation_receipts(account_id,post_id,content_hash,source_id,event_id,review_id,action) VALUES(account_id,post_id,content_hash,source_id,eid,rid,action);
 RETURN jsonb_build_object('action',action,'eventId',eid,'reviewId',rid,'event',result);
END $$;
-- Human approves the edited existing form; resolving and saving roll back together on error.
CREATE OR REPLACE FUNCTION public.chob_apply_automation_review(target uuid,payload jsonb,task_payload jsonb,expected_updated_at text DEFAULT NULL,note text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE r public.entity_reviews; result jsonb; notice jsonb; BEGIN
 PERFORM chob_private.require_provenance_editor();
 SELECT * INTO r FROM public.entity_reviews WHERE id=target FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.source_id IS NULL THEN RAISE EXCEPTION 'Review is no longer pending'; END IF;
 IF btrim(note)='' THEN RAISE EXCEPTION 'Review conclusion required'; END IF;
 PERFORM public.chob_resolve_entity_review(target,'resolved',note);
 IF EXISTS(SELECT 1 FROM public.events e WHERE e.id=(payload->>'id')::uuid AND e.status='published') THEN
 notice:=jsonb_build_object('title',left((payload->>'title')||'信息更新',200),'body',note,'source_url',(SELECT s.url FROM public.sources s WHERE s.id=r.source_id));
 END IF;
 result:=public.chob_save_event_architecture(payload,task_payload,expected_updated_at,notice,jsonb_build_object('source_id',r.source_id,'role','update'));
 RETURN result;
END $$;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['chob_save_source_account(jsonb)','chob_claim_scan(uuid)','chob_checkpoint_scan(uuid,jsonb,jsonb,text,boolean)','chob_commit_automation(uuid,text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb,jsonb)','chob_apply_automation_review(uuid,jsonb,jsonb,text,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC,anon';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
 END LOOP;
END $$;
INSERT INTO chob_private.migrations(version) VALUES('035') ON CONFLICT DO NOTHING;
COMMIT;
