BEGIN;
CREATE OR REPLACE FUNCTION chob_private.event_artist_types(ids uuid[], attrs jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(DISTINCT label) FILTER(WHERE label<>''),'[]'::jsonb) FROM (
 SELECT CASE lower(btrim(value)) WHEN 'actor' THEN '演员' WHEN 'singer' THEN '歌手' WHEN 'group' THEN '组合' WHEN 'band' THEN '乐队' WHEN 'cp' THEN 'CP' WHEN 'bl' THEN 'BL' WHEN 'gl' THEN 'GL' ELSE btrim(value) END AS label
 FROM (SELECT unnest(coalesce(a.categories,'{}') || CASE WHEN a.group_kind IS NULL THEN '{}'::text[] ELSE ARRAY[a.group_kind] END) value FROM public.artists a WHERE a.id=ANY(ids)
 UNION ALL SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(attrs->'artist_types')='array' THEN attrs->'artist_types' ELSE '[]' END)) values_to_normalize
 ) labels;
$$;
CREATE OR REPLACE FUNCTION chob_private.event_artist_count(ids uuid[], attrs jsonb) RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN jsonb_typeof(attrs->'artist_selections')='array' AND jsonb_array_length(attrs->'artist_selections')>0
 THEN (SELECT count(DISTINCT v)::integer FROM jsonb_array_elements_text(attrs->'artist_selections') v)
 ELSE (WITH chosen_cp AS (SELECT * FROM public.cp_pairs c WHERE c.id::text IN (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(attrs->'cp_ids')='array' THEN attrs->'cp_ids' ELSE '[]' END))), covered AS (SELECT artist_1_id id FROM chosen_cp UNION SELECT artist_2_id FROM chosen_cp)
 SELECT ((SELECT count(*) FROM chosen_cp)+(SELECT count(DISTINCT id) FROM unnest(coalesce(ids,'{}')) id WHERE id NOT IN(SELECT id FROM covered)))::integer) END;
$$;
REVOKE ALL ON FUNCTION chob_private.event_artist_types(uuid[],jsonb),chob_private.event_artist_count(uuid[],jsonb) FROM PUBLIC,anon,authenticated;
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO definition;
 IF strpos(definition,'''artist_count''')=0 THEN
  definition:=replace(definition,'''artist_ids'',e.artist_ids', '''artist_types'',chob_private.event_artist_types(e.artist_ids,e.attrs),''artist_count'',chob_private.event_artist_count(e.artist_ids,e.attrs),''artist_selections'',coalesce(e.attrs->''artist_selections'',''[]''::jsonb),''artist_ids'',e.artist_ids');
  definition:=replace(definition,'''group_kind'',a.group_kind','''group_kind'',a.group_kind,''group_member_ids'',a.group_member_ids');
  EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.chob_submit_event(jsonb,uuid,text)'::regprocedure) INTO definition;
 IF strpos(definition,'''artist_selections''')=0 THEN
  definition:=replace(definition,'''artist_reviewed'',false', '''artist_selections'',CASE WHEN jsonb_typeof(payload->''artist_selections'')=''array'' THEN payload->''artist_selections'' ELSE ''[]''::jsonb END,''artist_types'',CASE WHEN jsonb_typeof(payload->''artist_types'')=''array'' THEN payload->''artist_types'' ELSE ''[]''::jsonb END,''roll_call'',coalesce((payload->>''roll_call'')::boolean,false),''artist_reviewed'',false');
  EXECUTE definition;
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
