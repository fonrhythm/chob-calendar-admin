-- Requires 001 and 005; compatible with 006–009. Does not clear existing records.
BEGIN;
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
COMMIT;
