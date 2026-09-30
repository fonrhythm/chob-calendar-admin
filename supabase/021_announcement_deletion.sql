-- 管理员删除消息/公告；仅删除公告记录，不改变关联活动。
BEGIN;
CREATE OR REPLACE FUNCTION public.chob_delete_announcements(record_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deleted_count integer;
BEGIN
  PERFORM chob_private.require_admin();
  IF record_ids IS NULL OR cardinality(record_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '每次请选择 1–100 条公告。';
  END IF;
  DELETE FROM public.chob_announcements WHERE id = ANY(record_ids);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.chob_delete_announcements(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_delete_announcements(uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
