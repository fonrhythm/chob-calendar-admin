BEGIN;
CREATE OR REPLACE FUNCTION public.chob_save_group_v2(
  payload jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  saved jsonb; previous public.artists; kind text; member_ids uuid[]; categories_value text[];
  group_id uuid; artist_payload jsonb;
BEGIN
  PERFORM chob_private.require_admin();
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '组合资料格式不正确。'; END IF;
  kind:=CASE lower(btrim(coalesce(payload->>'type','组合'))) WHEN '乐队' THEN 'band' WHEN 'band' THEN 'band' WHEN '组合' THEN 'group' WHEN 'group' THEN 'group' ELSE NULL END;
  IF kind IS NULL THEN RAISE EXCEPTION '请选择组合或乐队。'; END IF;
  IF jsonb_typeof(payload->'members') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '成员列表格式不正确。'; END IF;
  SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO member_ids FROM jsonb_array_elements_text(payload->'members');
  IF cardinality(member_ids)>200 THEN RAISE EXCEPTION '成员数量不能超过 200。'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chob_groups_write'));
  PERFORM 1 FROM public.artists WHERE id=ANY(member_ids) ORDER BY id FOR UPDATE;
  IF record_id=ANY(member_ids) THEN RAISE EXCEPTION '组合不能选择自己作为成员。'; END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(member_ids) AS m(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.artists a WHERE a.id=m.id AND a.deleted_at IS NULL AND NOT chob_private.artist_is_group(a.categories,a.group_kind,a.type))
  ) THEN RAISE EXCEPTION '成员必须是未删除的个人艺人，不能选择组合或乐队。'; END IF;
  IF record_id IS NOT NULL THEN
    SELECT * INTO previous FROM public.artists WHERE id=record_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT chob_private.artist_is_group(previous.categories,previous.group_kind,previous.type) THEN RAISE EXCEPTION '组合不存在或已删除，请刷新列表。'; END IF;
  END IF;
  SELECT coalesce(array_agg(c),'{}') INTO categories_value FROM unnest(coalesce(previous.categories,'{}')) AS c
    WHERE lower(btrim(c)) NOT IN ('group','band','组合','乐队','组合/乐队');
  categories_value:=array_append(categories_value,kind);
  artist_payload:=jsonb_build_object(
    'name',payload->>'name',
    'en_name',coalesce(payload->>'en_name',previous.en_name,''),
    'company',coalesce(payload->>'company',previous.company,''),
    'categories',to_jsonb(categories_value),
    'aliases',coalesce(payload->'aliases',to_jsonb(previous.aliases),'[]'::jsonb)
  );
  saved:=public.chob_save_artist(artist_payload,record_id,expected_updated_at);
  group_id:=(saved->>'id')::uuid;
  UPDATE public.artists SET group_kind=kind,group_member_ids=member_ids,updated_at=clock_timestamp()
    WHERE id=group_id RETURNING to_jsonb(artists.*) INTO saved;
  RETURN saved;
END;
$$;


REVOKE ALL ON FUNCTION public.chob_save_group_v2(jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_group_v2(jsonb,uuid,text) TO authenticated;
-- Preserve strict identity after legacy 005 re-runs.
CREATE OR REPLACE FUNCTION chob_private.artist_is_group(cats text[], kind text, legacy_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT coalesce(kind IN ('group','band'),false); $$;
-- Display names use the existing optional en_name field; canonical identity remains unchanged.
DO $migration$
DECLARE definition text;
BEGIN
 IF to_regprocedure('public.chob_public_feed()') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO definition;
  definition:=replace(definition,'string_agg(a.name,','string_agg(coalesce(nullif(btrim(a.en_name),''''),a.name),');
  definition:=replace(definition,'jsonb_agg(a.name)','jsonb_agg(coalesce(nullif(btrim(a.en_name),''''),a.name))');
  definition:=replace(definition,'''name'',a.name,','''name'',coalesce(nullif(btrim(a.en_name),''''),a.name),');
  EXECUTE definition;
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
