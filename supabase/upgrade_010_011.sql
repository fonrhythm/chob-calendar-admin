BEGIN;

-- 010_independent_groups.sql
-- Requires 001 and 005; compatible with 006–009. Does not clear existing records.

CREATE OR REPLACE FUNCTION chob_private.artist_is_group(cats text[], kind text, legacy_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(kind IN ('group','band'),false);
$$;
CREATE OR REPLACE FUNCTION public.chob_set_group_deleted(record_id uuid, deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.artists;
BEGIN
 PERFORM chob_private.require_admin();
 PERFORM pg_advisory_xact_lock(hashtext('chob_groups_write'));
 SELECT * INTO target FROM public.artists WHERE id=record_id FOR UPDATE;
 IF NOT FOUND OR NOT chob_private.artist_is_group(target.categories,target.group_kind,target.type) THEN
  RAISE EXCEPTION '该记录是个人艺人，不是独立组合。请刷新列表，不要删除个人资料。';
 END IF;
 IF deleted AND EXISTS(SELECT 1 FROM public.cp_pairs WHERE deleted_at IS NULL AND (artist_1_id=record_id OR artist_2_id=record_id)) THEN
  RAISE EXCEPTION '这条旧记录同时被用作CP成员，请先执行组合分类清理脚本，保留个人和CP关系。';
 END IF;
 -- Retain identity and member IDs for history/recovery. Active memberships exclude deleted groups.
 -- Existing event/task references remain valid; personal member rows and CP pairs are untouched.
 UPDATE public.artists SET deleted_at=CASE WHEN deleted THEN now() ELSE NULL END,updated_at=clock_timestamp() WHERE id=record_id;
END $$;
REVOKE ALL ON FUNCTION public.chob_set_group_deleted(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_set_group_deleted(uuid,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';



-- 011_reset_legacy_groups.sql
-- One-time owner-requested reset. Run AFTER 010. Personal artists, CP pairs and events are preserved.

SELECT pg_advisory_xact_lock(hashtext('chob_groups_write'));
CREATE TABLE IF NOT EXISTS chob_private.group_reset_runs (name text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS chob_private.group_reset_backup (artist_id uuid PRIMARY KEY, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON chob_private.group_reset_runs,chob_private.group_reset_backup FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM chob_private.group_reset_runs WHERE name='reset_legacy_groups_v1') THEN
  RAISE NOTICE 'Already reset: newly added groups are unchanged.';
  RETURN;
 END IF;
 INSERT INTO chob_private.group_reset_backup(artist_id,snapshot)
 SELECT a.id,to_jsonb(a) FROM public.artists a WHERE a.deleted_at IS NULL AND (
 a.group_kind IN ('group','band') OR EXISTS(SELECT 1 FROM unnest(coalesce(a.categories,'{}') || regexp_split_to_array(coalesce(a.type,''),'[;；/|]')) c WHERE lower(btrim(c)) IN ('group','band','组合','乐队','组合/乐队')))
 ON CONFLICT(artist_id) DO NOTHING;
 -- Detach only the group-side membership lists captured in this reset.
 UPDATE public.artists SET group_member_ids='{}',updated_at=clock_timestamp()
 WHERE id IN (SELECT artist_id FROM chob_private.group_reset_backup);
 -- Real group records go to trash unless also used as a personal CP member.
 UPDATE public.artists a SET deleted_at=now(),updated_at=clock_timestamp()
 WHERE a.id IN (SELECT artist_id FROM chob_private.group_reset_backup)
 AND a.group_kind IN ('group','band')
 AND NOT EXISTS(SELECT 1 FROM public.cp_pairs c WHERE c.artist_1_id=a.id OR c.artist_2_id=a.id);
 -- Category-only records and legacy CP members remain people, with their IDs unchanged.
 UPDATE public.artists a SET group_kind=NULL,
 categories=ARRAY(SELECT c FROM unnest(coalesce(a.categories,'{}')) c WHERE lower(btrim(c)) NOT IN ('group','band','组合','乐队','组合/乐队')),
 type=array_to_string(ARRAY(SELECT btrim(c) FROM regexp_split_to_table(coalesce(a.type,''),'[;；/|]') c WHERE lower(btrim(c)) NOT IN ('group','band','组合','乐队','组合/乐队')),' / '),
 updated_at=clock_timestamp()
 WHERE a.id IN (SELECT artist_id FROM chob_private.group_reset_backup) AND a.deleted_at IS NULL;
 INSERT INTO chob_private.group_reset_runs(name) VALUES('reset_legacy_groups_v1');
END $$;

SELECT 'Group reset complete: people, CP pairs and historical activities preserved' AS result;

COMMIT;
