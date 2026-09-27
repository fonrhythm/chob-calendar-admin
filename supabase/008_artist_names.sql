BEGIN;
ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS base_name text;
ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';
UPDATE public.artists SET base_name=name WHERE base_name IS NULL;
DO $$ BEGIN
 IF to_regprocedure('public.chob_save_artist_original(jsonb,uuid,text)') IS NULL THEN
  ALTER FUNCTION public.chob_save_artist(jsonb,uuid,text) RENAME TO chob_save_artist_original;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.chob_save_artist(payload jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE base text:=btrim(payload->>'name'); company_value text:=btrim(coalesce(payload->>'company','')); full_value text:=btrim(coalesce(payload->>'full_name','')); display_value text; existing public.artists; saved jsonb; conflicts boolean;
BEGIN
 PERFORM chob_private.require_admin();
 PERFORM pg_advisory_xact_lock(hashtext('chob_artist_names'));
 IF coalesce(length(base),0) NOT BETWEEN 1 AND 150 OR length(full_value)>150 THEN RAISE EXCEPTION '请填写有效艺人名称或全名。'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.artists WHERE deleted_at IS NULL AND id IS DISTINCT FROM record_id AND lower(btrim(coalesce(base_name,name)))=lower(base)) INTO conflicts;
 display_value:=base;
 IF conflicts THEN
  IF company_value='' THEN RAISE EXCEPTION '同名艺人必须填写公司作为后缀。'; END IF;
  FOR existing IN SELECT * FROM public.artists WHERE deleted_at IS NULL AND id IS DISTINCT FROM record_id AND lower(btrim(coalesce(base_name,name)))=lower(base) ORDER BY id FOR UPDATE LOOP
   IF coalesce(btrim(existing.company),'')='' THEN RAISE EXCEPTION '请先为已有同名艺人补充公司。'; END IF;
   IF lower(btrim(existing.company))=lower(company_value) AND (full_value='' OR existing.full_name='' OR lower(existing.full_name)=lower(full_value)) THEN RAISE EXCEPTION '同公司同名艺人需分别补全不同的全名，请先编辑已有艺人。'; END IF;
   UPDATE public.artists SET name=coalesce(nullif(full_name,''),base_name,name)||' ('||btrim(company)||')',updated_at=clock_timestamp() WHERE id=existing.id;
  END LOOP;
  display_value:=coalesce(nullif(full_value,''),base)||' ('||company_value||')';
 END IF;
 saved:=public.chob_save_artist_original(payload||jsonb_build_object('name',display_value),record_id,expected_updated_at);
 UPDATE public.artists SET base_name=base,full_name=full_value WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(artists.*) INTO saved;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.chob_save_artist_original(jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chob_save_artist(jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_artist(jsonb,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
