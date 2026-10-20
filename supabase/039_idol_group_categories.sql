-- GROUP previously meant idol groups. Rename existing values once, then reserve
-- IDOL for singing/dancing idols and GROUP for musical groups. group_kind remains
-- structural identity and is deliberately not a source of the GROUP category.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('chob-039-idol-group'));

CREATE TABLE IF NOT EXISTS chob_private.idol_group_category_backup (
 entity text NOT NULL, record_id uuid NOT NULL, old_value jsonb NOT NULL,
 backed_up_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entity,record_id)
);
REVOKE ALL ON chob_private.idol_group_category_backup FROM PUBLIC,anon,authenticated;
ALTER TABLE chob_private.idol_group_category_backup ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION chob_private.artist_category_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE lower(btrim(value))
 WHEN 'idol' THEN 'IDOL' WHEN '男女团' THEN 'IDOL'
 WHEN 'group' THEN 'GROUP' WHEN 'goup' THEN 'IDOL' WHEN 'ensemble' THEN 'GROUP' WHEN '组合' THEN 'GROUP'
 WHEN 'band' THEN 'BAND' WHEN '乐队' THEN 'BAND'
 WHEN 'actor' THEN 'ACTOR' WHEN '演员' THEN 'ACTOR'
 WHEN 'singer' THEN 'SINGER' WHEN '歌手' THEN 'SINGER'
 WHEN 'bl' THEN 'BL' WHEN 'bl演员' THEN 'BL' WHEN '泰腐' THEN 'BL'
 WHEN 'gl' THEN 'GL' WHEN 'gl演员' THEN 'GL' WHEN '泰百' THEN 'GL'
 WHEN 'music' THEN 'MUSIC' WHEN '音乐' THEN 'MUSIC'
 WHEN 'cp' THEN 'CP' WHEN 'other' THEN 'OTHER' WHEN '其他' THEN 'OTHER' ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION chob_private.event_artist_types(ids uuid[], attrs jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH requested AS (
  SELECT value id FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(attrs->'artist_selections')='array' THEN
   CASE WHEN jsonb_array_length(attrs->'artist_selections')>0 THEN attrs->'artist_selections' ELSE to_jsonb(coalesce(ids,'{}'::uuid[])) END
   ELSE to_jsonb(coalesce(ids,'{}'::uuid[])) END)
 ), chosen AS (
  SELECT a.* FROM public.artists a WHERE a.id::text IN(SELECT id FROM requested)
 ), chosen_cp AS (
  SELECT c.* FROM public.cp_pairs c WHERE 'cp:'||c.id::text IN(SELECT id FROM requested)
 ), members AS (
  SELECT unnest(group_member_ids) id FROM chosen
  UNION SELECT artist_1_id FROM chosen_cp UNION SELECT artist_2_id FROM chosen_cp
 ), direct AS (
  SELECT * FROM chosen WHERE id NOT IN(SELECT id FROM members)
 ), catalog_values AS (
  SELECT unnest(coalesce(a.categories,'{}'::text[]) || CASE WHEN a.group_kind='band' THEN ARRAY['BAND'] ELSE '{}'::text[] END) value
  FROM direct a
  UNION ALL SELECT value FROM public.artists a JOIN members m ON m.id=a.id
   CROSS JOIN LATERAL unnest(coalesce(a.categories,'{}'::text[]) || CASE WHEN a.group_kind='band' THEN ARRAY['BAND'] ELSE '{}'::text[] END) value
   WHERE chob_private.artist_category_key(value) NOT IN ('IDOL','GROUP')
 ), stored_values AS (
  SELECT jsonb_array_elements_text(CASE jsonb_typeof(attrs->'artist_types') WHEN 'array' THEN attrs->'artist_types' WHEN 'string' THEN jsonb_build_array(attrs->>'artist_types') ELSE '[]'::jsonb END) value
  UNION ALL SELECT attrs->>'artist_type' WHERE nullif(btrim(attrs->>'artist_type'),'') IS NOT NULL
 ), all_values AS (
  SELECT value FROM catalog_values WHERE chob_private.artist_category_key(value) NOT IN ('','CP')
  UNION ALL SELECT value FROM stored_values
  WHERE (NOT EXISTS(SELECT 1 FROM chosen) AND NOT EXISTS(SELECT 1 FROM chosen_cp)) OR (
   NOT EXISTS(SELECT 1 FROM catalog_values WHERE chob_private.artist_category_key(value) NOT IN ('','CP'))
   AND chob_private.artist_category_key(value) NOT IN ('','CP','IDOL','GROUP')
  )
 ), labels AS (
  SELECT CASE chob_private.artist_category_key(value)
  WHEN 'IDOL' THEN '男女团' WHEN 'GROUP' THEN '组合' WHEN 'BAND' THEN '乐队'
  WHEN 'ACTOR' THEN '演员' WHEN 'SINGER' THEN '歌手' WHEN 'BL' THEN 'BL' WHEN 'GL' THEN 'GL'
  WHEN 'CP' THEN 'CP' WHEN 'OTHER' THEN '其他' WHEN 'MUSIC' THEN '音乐' ELSE btrim(value) END label FROM all_values
 ) SELECT coalesce(jsonb_agg(DISTINCT label) FILTER(WHERE label<>''),'[]'::jsonb) FROM labels;
$$;
REVOKE ALL ON FUNCTION chob_private.artist_category_key(text),chob_private.event_artist_types(uuid[],jsonb) FROM PUBLIC,anon,authenticated;

-- Only this data conversion is guarded. Re-running the file may safely repair
-- function definitions without converting newly created musical GROUP records.
DO $migration$
DECLARE a record; e record; cats text[]; legacy_tokens text[]; next_type text;
 next_attrs jsonb; labels jsonb; catalog_labels jsonb; scalar_value text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM chob_private.migrations WHERE version='039') THEN
  FOR a IN SELECT * FROM public.artists WHERE EXISTS(
   SELECT 1 FROM unnest(coalesce(categories,'{}') || regexp_split_to_array(coalesce(type,''),'[;；/|,，]')) v
   WHERE lower(btrim(v)) IN ('group','goup','男女团','ensemble')
  ) FOR UPDATE LOOP
   INSERT INTO chob_private.idol_group_category_backup(entity,record_id,old_value)
   VALUES('artists',a.id,to_jsonb(a)) ON CONFLICT DO NOTHING;
   legacy_tokens:=ARRAY(SELECT btrim(v) FROM unnest(regexp_split_to_array(coalesce(a.type,''),'[;；/|,，]')) v
    WHERE lower(btrim(v)) IN ('group','goup','男女团','ensemble'));
   SELECT coalesce(array_agg(value ORDER BY first_position),'{}') INTO cats FROM (
    SELECT value,min(position) first_position FROM (
     SELECT CASE lower(btrim(v)) WHEN 'group' THEN 'IDOL' WHEN 'goup' THEN 'IDOL'
      WHEN '男女团' THEN 'IDOL' WHEN 'ensemble' THEN 'GROUP' ELSE btrim(v) END value,position
     FROM unnest(coalesce(a.categories,'{}') || legacy_tokens) WITH ORDINALITY source(v,position)
    ) normalized WHERE value<>'' GROUP BY value
   ) unique_values;
   SELECT string_agg(CASE lower(btrim(v)) WHEN 'group' THEN 'IDOL' WHEN 'goup' THEN 'IDOL'
    WHEN '男女团' THEN 'IDOL' WHEN 'ensemble' THEN 'GROUP' ELSE btrim(v) END,' / ' ORDER BY position)
   INTO next_type FROM unnest(regexp_split_to_array(coalesce(a.type,''),'[;；/|,，]')) WITH ORDINALITY source(v,position);
   UPDATE public.artists SET categories=cats,type=next_type,updated_at=clock_timestamp() WHERE id=a.id;
  END LOOP;

  FOR e IN SELECT * FROM public.events WHERE
   lower(btrim(coalesce(attributes->>'category',''))) IN ('group','goup','ensemble','男女团') OR
   lower(btrim(coalesce(attributes->>'artist_type',''))) IN ('group','goup','ensemble','组合','男女团') OR
   EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE jsonb_typeof(attributes->'artist_types')
    WHEN 'array' THEN attributes->'artist_types' WHEN 'string' THEN jsonb_build_array(attributes->>'artist_types') ELSE '[]'::jsonb END) v
    WHERE lower(btrim(v)) IN ('group','goup','ensemble','组合','男女团'))
   FOR UPDATE LOOP
   next_attrs:=coalesce(e.attributes,'{}'::jsonb);
   -- English GROUP is unambiguously the old idol value. Chinese 组合 can
   -- describe either kind: the catalog resolves it when artist IDs are known.
   IF next_attrs ? 'artist_types' THEN
    SELECT coalesce(jsonb_agg(CASE lower(btrim(value)) WHEN 'group' THEN '男女团'
     WHEN 'goup' THEN '男女团' WHEN 'ensemble' THEN '组合' ELSE value END),'[]'::jsonb)
    INTO labels FROM jsonb_array_elements_text(CASE jsonb_typeof(next_attrs->'artist_types')
     WHEN 'array' THEN next_attrs->'artist_types' WHEN 'string' THEN jsonb_build_array(next_attrs->>'artist_types') ELSE '[]'::jsonb END);
    next_attrs:=jsonb_set(next_attrs,'{artist_types}',labels);
   END IF;
   labels:=chob_private.event_artist_types(e.artist_ids,next_attrs);
   catalog_labels:=chob_private.event_artist_types(e.artist_ids,next_attrs-'artist_types'-'artist_type');
   IF next_attrs ? 'artist_types' THEN next_attrs:=jsonb_set(next_attrs,'{artist_types}',labels); END IF;
   scalar_value:=lower(btrim(coalesce(next_attrs->>'artist_type','')));
   IF scalar_value IN ('group','goup','ensemble','组合','男女团') THEN
    next_attrs:=jsonb_set(next_attrs,'{artist_type}',to_jsonb(CASE
     WHEN scalar_value='ensemble' THEN '组合'
     WHEN catalog_labels ? '组合' AND NOT catalog_labels ? '男女团' THEN '组合'
     WHEN catalog_labels ? '男女团' THEN '男女团'
     WHEN scalar_value IN ('group','goup','男女团') THEN '男女团'
     ELSE next_attrs->>'artist_type' END));
   END IF;
   scalar_value:=lower(btrim(coalesce(next_attrs->>'category','')));
   IF scalar_value IN ('group','goup','ensemble','男女团') THEN
    next_attrs:=jsonb_set(next_attrs,'{category}',to_jsonb(CASE WHEN scalar_value='ensemble' THEN 'group'
     WHEN catalog_labels ? '组合' AND NOT catalog_labels ? '男女团' THEN 'group' ELSE 'idol' END));
   END IF;
   IF NOT next_attrs ? 'category' AND (catalog_labels ? '男女团' OR catalog_labels ? '组合') THEN
    next_attrs:=jsonb_set(next_attrs,'{category}',to_jsonb(CASE
     WHEN catalog_labels ? '组合' AND NOT catalog_labels ? '男女团' THEN 'group' ELSE 'idol' END));
   END IF;
   IF next_attrs IS DISTINCT FROM e.attributes THEN
    INSERT INTO chob_private.idol_group_category_backup(entity,record_id,old_value)
    VALUES('events',e.id,to_jsonb(e)) ON CONFLICT DO NOTHING;
    UPDATE public.events SET attributes=next_attrs,updated_at=clock_timestamp() WHERE id=e.id;
   END IF;
  END LOOP;
  INSERT INTO chob_private.migrations(version) VALUES('039');
 END IF;
END $migration$;

CREATE OR REPLACE FUNCTION public.chob_save_group_v2(
 payload jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved jsonb; previous public.artists; kind text; member_ids uuid[]; categories_value text[];
 group_id uuid; artist_payload jsonb; type_code text; category_code text;
BEGIN
 PERFORM chob_private.require_admin();
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '组合资料格式不正确。'; END IF;
 type_code:=chob_private.artist_category_key(coalesce(payload->>'type','组合'));
 IF type_code NOT IN ('IDOL','GROUP','BAND') THEN RAISE EXCEPTION '请选择男女团、音乐组合或乐队。'; END IF;
 IF jsonb_typeof(payload->'members') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '成员列表格式不正确。'; END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO member_ids FROM jsonb_array_elements_text(payload->'members');
 IF cardinality(member_ids)>200 THEN RAISE EXCEPTION '成员数量不能超过 200。'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('chob_groups_write'));
 PERFORM 1 FROM public.artists WHERE id=ANY(member_ids) ORDER BY id FOR UPDATE;
 IF record_id=ANY(member_ids) THEN RAISE EXCEPTION '组合不能选择自己作为成员。'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(member_ids) AS m(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.artists a WHERE a.id=m.id AND a.deleted_at IS NULL
  AND NOT chob_private.artist_is_group(a.categories,a.group_kind,a.type)
 )) THEN RAISE EXCEPTION '成员必须是未删除的个人艺人，不能选择组合或乐队。'; END IF;
 IF record_id IS NOT NULL THEN
  SELECT * INTO previous FROM public.artists WHERE id=record_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT chob_private.artist_is_group(previous.categories,previous.group_kind,previous.type) THEN
   RAISE EXCEPTION '组合不存在或已删除，请刷新列表。'; END IF;
 END IF;
 category_code:=chob_private.artist_category_key(payload->>'artist_category');
 IF payload ? 'artist_category' AND category_code NOT IN ('IDOL','GROUP','BAND') THEN
  RAISE EXCEPTION '艺人类别须为 IDOL、GROUP 或 BAND。'; END IF;
 IF NOT payload ? 'artist_category' THEN
  category_code:=CASE WHEN type_code='GROUP' AND EXISTS(SELECT 1 FROM unnest(coalesce(previous.categories,'{}')) c
   WHERE chob_private.artist_category_key(c)='IDOL') THEN 'IDOL' ELSE type_code END;
 END IF;
 IF (type_code='BAND')<>(category_code='BAND') THEN RAISE EXCEPTION '乐队类型与艺人类别不一致。'; END IF;
 kind:=CASE WHEN category_code='BAND' THEN 'band' ELSE 'group' END;
 SELECT coalesce(array_agg(c),'{}') INTO categories_value FROM unnest(coalesce(previous.categories,'{}')) c
 WHERE chob_private.artist_category_key(c) NOT IN ('IDOL','GROUP','BAND');
 categories_value:=array_append(categories_value,category_code);
 artist_payload:=jsonb_build_object('name',payload->>'name',
  'en_name',coalesce(payload->>'en_name',previous.en_name,''),'company',coalesce(payload->>'company',previous.company,''),
  'full_name',coalesce(payload->>'full_name',previous.full_name,''),'categories',to_jsonb(categories_value),
  'aliases',coalesce(payload->'aliases',to_jsonb(previous.aliases),'[]'::jsonb));
 saved:=public.chob_save_artist(artist_payload,record_id,expected_updated_at);
 group_id:=(saved->>'id')::uuid;
 UPDATE public.artists SET group_kind=kind,group_member_ids=member_ids,updated_at=clock_timestamp()
 WHERE id=group_id RETURNING to_jsonb(artists.*) INTO saved;
 RETURN saved;
END;
$$;

-- Old clients receive the same validation and cannot reintroduce structural
-- group_kind into the musical GROUP genre or overwrite an existing IDOL genre.
CREATE OR REPLACE FUNCTION public.chob_save_group(
 payload jsonb, record_id uuid DEFAULT NULL, expected_updated_at text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN public.chob_save_group_v2(payload,record_id,expected_updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.chob_save_group_v2(jsonb,uuid,text),public.chob_save_group(jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chob_save_group_v2(jsonb,uuid,text),public.chob_save_group(jsonb,uuid,text) TO authenticated;

-- Update the existing category CASE in place. Migration 034 wraps the original
-- projection, so inspect its legacy target only when the current feed calls it.
-- CREATE OR REPLACE preserves function identity, ownership, and existing ACLs;
-- no public-feed grants are introduced by this migration.
DO $feed_category$
DECLARE target regprocedure; targets regprocedure[]; definition text; case_start integer;
 case_end integer; fragment text; replacement text; checked integer:=0;
BEGIN
 target:=to_regprocedure('public.chob_public_feed()');
 IF target IS NULL THEN RAISE EXCEPTION '公开feed版本不符：缺少当前接口，请先核对部署。'; END IF;
 targets:=ARRAY[target];
 definition:=pg_get_functiondef(target);
 IF strpos(definition,'chob_public_feed_legacy034(')>0 AND to_regprocedure('public.chob_public_feed_legacy034()') IS NOT NULL THEN
  targets:=array_append(targets,to_regprocedure('public.chob_public_feed_legacy034()'));
 END IF;
 FOREACH target IN ARRAY targets LOOP
  definition:=pg_get_functiondef(target);
  case_start:=strpos(definition,'CASE e.attrs->>''artist_type''');
  IF case_start=0 THEN CONTINUE; END IF;
  case_end:=strpos(substr(definition,case_start),' END');
  IF case_end=0 THEN RAISE EXCEPTION '公开feed版本不符：艺人类别CASE不完整，请先核对部署。'; END IF;
  fragment:=substr(definition,case_start,case_end+3);
  IF strpos(fragment,'WHEN ''男女团'' THEN ''idol''')>0 AND strpos(fragment,'WHEN ''IDOL'' THEN ''idol''')>0
   AND strpos(fragment,'WHEN ''idol'' THEN ''idol''')>0 AND strpos(fragment,'WHEN ''GROUP'' THEN ''group''')>0 THEN
   checked:=checked+1;
  ELSIF strpos(fragment,'WHEN ''组合'' THEN ''group''')>0 THEN
   replacement:=replace(fragment,'WHEN ''组合'' THEN ''group''',
    'WHEN ''男女团'' THEN ''idol'' WHEN ''IDOL'' THEN ''idol'' WHEN ''idol'' THEN ''idol'' WHEN ''GROUP'' THEN ''group'' WHEN ''group'' THEN ''group'' WHEN ''组合'' THEN ''group''');
   EXECUTE replace(definition,fragment,replacement);
   checked:=checked+1;
  ELSE
   RAISE EXCEPTION '公开feed版本不符：未找到可验证的艺人类别映射，请先核对部署。';
  END IF;
 END LOOP;
 IF checked=0 THEN RAISE EXCEPTION '公开feed版本不符：未找到可验证的艺人类别映射，请先核对部署。'; END IF;
END $feed_category$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Aggregate-only verification; historical snapshots stay in the private schema.
SELECT jsonb_build_object(
 'migration','039','applied',EXISTS(SELECT 1 FROM chob_private.migrations WHERE version='039'),
 'artist_backups',(SELECT count(*) FROM chob_private.idol_group_category_backup WHERE entity='artists'),
 'event_backups',(SELECT count(*) FROM chob_private.idol_group_category_backup WHERE entity='events'),
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (
  SELECT category,count(*) artists FROM public.artists CROSS JOIN LATERAL unnest(categories) category
  GROUP BY category ORDER BY category
 ) c),
 'permissions',jsonb_build_object(
  'anon_save_group',has_function_privilege('anon','public.chob_save_group(jsonb,uuid,text)','execute'),
  'authenticated_save_group',has_function_privilege('authenticated','public.chob_save_group(jsonb,uuid,text)','execute'),
  'anon_save_group_v2',has_function_privilege('anon','public.chob_save_group_v2(jsonb,uuid,text)','execute'),
  'authenticated_save_group_v2',has_function_privilege('authenticated','public.chob_save_group_v2(jsonb,uuid,text)','execute'),
  'anon_backup_read',has_table_privilege('anon','chob_private.idol_group_category_backup','select'),
  'authenticated_backup_read',has_table_privilege('authenticated','chob_private.idol_group_category_backup','select')
 )
) AS category_migration_summary;
