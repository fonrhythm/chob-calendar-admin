-- 补齐组合/乐队管理。沿用 artists 的 ID，活动无需另存一套组合编号。
-- 可重复执行；不删除或重新导入已有艺人。
BEGIN;
ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS group_kind text;
ALTER TABLE public.artists ADD COLUMN IF NOT EXISTS group_member_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION chob_private.artist_is_group(cats text[], kind text, legacy_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(kind IN ('group','band'),false) OR EXISTS(
    SELECT 1 FROM unnest(coalesce(cats,'{}') || regexp_split_to_array(coalesce(legacy_type,''),'[;/|]')) AS c(value)
    WHERE lower(btrim(value)) IN ('group','band','组合','乐队','组合/乐队')
  );
$$;

CREATE OR REPLACE FUNCTION public.chob_save_group(
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

-- 保护成员关系：不能删除仍被有效组合使用的成员；恢复组合前需恢复成员。
CREATE OR REPLACE FUNCTION chob_private.guard_group_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF chob_private.artist_is_group(NEW.categories,NEW.group_kind,NEW.type) AND EXISTS(
    SELECT 1 FROM public.artists g WHERE g.deleted_at IS NULL AND NEW.id=ANY(g.group_member_ids)
  ) THEN RAISE EXCEPTION '该艺人仍是组合成员，不能改成组合类型。'; END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.artists g WHERE g.deleted_at IS NULL AND OLD.id=ANY(g.group_member_ids)
  ) THEN RAISE EXCEPTION '该艺人仍是组合或乐队成员，请先从组合移除。'; END IF;
  IF NEW.deleted_at IS NULL AND EXISTS(
    SELECT 1 FROM unnest(NEW.group_member_ids) AS m(id)
    WHERE m.id=NEW.id OR NOT EXISTS(SELECT 1 FROM public.artists a WHERE a.id=m.id AND a.deleted_at IS NULL AND NOT chob_private.artist_is_group(a.categories,a.group_kind,a.type))
  ) THEN RAISE EXCEPTION '请先恢复有效的个人成员，再保存或恢复组合。'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chob_guard_group_members ON public.artists;
CREATE TRIGGER chob_guard_group_members BEFORE UPDATE OF deleted_at,group_member_ids,categories,group_kind,type ON public.artists
FOR EACH ROW EXECUTE FUNCTION chob_private.guard_group_members();

REVOKE ALL ON FUNCTION chob_private.artist_is_group(text[],text,text),chob_private.guard_group_members() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chob_save_group(jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_save_group(jsonb,uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
