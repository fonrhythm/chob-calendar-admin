BEGIN;
CREATE OR REPLACE FUNCTION public.chob_import_catalog(entity text, rows jsonb, file_name text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; total integer; a uuid; b uuid; label text;
BEGIN
  PERFORM chob_private.require_admin();
  IF entity IS NULL OR entity NOT IN ('cp','group') THEN RAISE EXCEPTION '不支持的导入类型'; END IF;
  IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '导入格式无效'; END IF;
  total := jsonb_array_length(rows);
  IF total NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '每批导入1至200条'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chob_catalog_import'));
  FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '资料格式无效'; END IF;
    label := btrim(coalesce(CASE WHEN entity='cp' THEN item->>'cp_name' ELSE item->>'name' END,''));
    IF length(label) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION '名称必填，最多150字'; END IF;
    IF entity='cp' THEN
      a := (item->>'artist_1_id')::uuid; b := (item->>'artist_2_id')::uuid;
      PERFORM 1 FROM public.artists WHERE id IN (a,b) ORDER BY id FOR UPDATE;
      IF a IS NULL OR b IS NULL OR a=b OR (SELECT count(*) FROM public.artists WHERE id IN (a,b) AND deleted_at IS NULL AND NOT coalesce(group_kind IN ('group','band'),false))<>2 THEN
        RAISE EXCEPTION 'CP必须选择两位不同且未删除的个人艺人';
      END IF;
      IF EXISTS(SELECT 1 FROM public.cp_pairs WHERE deleted_at IS NULL AND (lower(btrim(cp_name))=lower(label) OR (artist_1_id=a AND artist_2_id=b) OR (artist_1_id=b AND artist_2_id=a))) THEN
        RAISE EXCEPTION '已有同名CP或相同成员配对';
      END IF;
      PERFORM public.chob_save_cp(item);
    ELSE
      IF EXISTS(SELECT 1 FROM public.artists WHERE deleted_at IS NULL AND lower(btrim(name))=lower(label)) THEN RAISE EXCEPTION '已有同名艺人或组合'; END IF;
      PERFORM public.chob_save_group_v2(item);
    END IF;
  END LOOP;
  INSERT INTO public.import_logs(uploaded_by,file_name,imported_count) VALUES(auth.uid(),left(file_name,255),total);
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.chob_import_catalog(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chob_import_catalog(text,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
