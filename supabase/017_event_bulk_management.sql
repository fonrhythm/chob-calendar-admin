-- 后台批量导入、发布与可恢复删除。先在 Supabase SQL Editor 执行整份脚本。
BEGIN;

CREATE OR REPLACE FUNCTION public.chob_import_event_bundles_v2(bundles jsonb, publish_now boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  bundle jsonb;
  event_data jsonb;
  tasks_data jsonb;
  row_number integer := 0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='admin' AND is_active IS TRUE AND email_verified IS TRUE) THEN
    RAISE EXCEPTION '仅管理员可以导入活动。' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(bundles) IS DISTINCT FROM 'array' OR jsonb_array_length(bundles) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '每次导入 1–200 条活动。';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chob_event_batch_import'));
  FOR bundle IN SELECT value FROM jsonb_array_elements(bundles) LOOP
    row_number := row_number + 1;
    event_data := bundle->'event';
    IF jsonb_typeof(event_data) IS DISTINCT FROM 'object' OR jsonb_typeof(bundle->'tasks') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '第 % 条活动或事项格式无效。', row_number;
    END IF;
    IF EXISTS(SELECT 1 FROM public.events WHERE id=(event_data->>'id')::uuid) THEN
      RAISE EXCEPTION '第 % 条已存在，请刷新列表核对。', row_number;
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.events e
      WHERE e.attributes->>'admin_deleted_at' IS NULL
        AND e.date = nullif(event_data->>'date','')::date
        AND lower(btrim(coalesce(e.location,''))) = lower(btrim(coalesce(event_data->>'location','')))
        AND lower(btrim(coalesce(e.location_region,''))) = lower(btrim(coalesce(event_data->>'location_region','')))
        AND coalesce(e.attributes->>'activity_category','other') = coalesce(event_data->'attributes'->>'activity_category','other')
        AND e.artist_ids @> ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(event_data->'artist_ids'))
        AND e.artist_ids <@ ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(event_data->'artist_ids'))
    ) THEN RAISE EXCEPTION '第 % 条与已有活动的艺人、类型、地址和日期重复。', row_number; END IF;
    IF publish_now AND jsonb_array_length(coalesce(event_data->'attributes'->'unmatched_import_names','[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION '第 % 条仍有待匹配艺人，请先导入草稿。', row_number;
    END IF;
    SELECT coalesce(jsonb_agg(value || jsonb_build_object('status',CASE WHEN publish_now THEN 'published' ELSE 'draft' END)),'[]'::jsonb)
      INTO tasks_data FROM jsonb_array_elements(bundle->'tasks');
    PERFORM public.chob_save_event_bundle_v2(
      event_data || jsonb_build_object('status',CASE WHEN publish_now THEN 'published' ELSE 'draft' END),
      tasks_data, NULL
    );
  END LOOP;
  RETURN row_number;
END;
$$;
REVOKE ALL ON FUNCTION public.chob_import_event_bundles_v2(jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_import_event_bundles_v2(jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.chob_manage_events(event_ids uuid[], operation text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  requested integer;
  matched integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='admin' AND is_active IS TRUE AND email_verified IS TRUE) THEN
    RAISE EXCEPTION '仅管理员可以管理活动。' USING ERRCODE='42501';
  END IF;
  requested := coalesce(cardinality(event_ids),0);
  IF requested NOT BETWEEN 1 AND 200 OR requested <> (SELECT count(DISTINCT id) FROM unnest(event_ids) AS id) THEN
    RAISE EXCEPTION '请选择 1–200 个不同的活动。';
  END IF;
  IF operation NOT IN ('delete','publish') THEN RAISE EXCEPTION '不支持此操作。'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chob_event_batch_import'));
  SELECT count(*) INTO matched FROM public.events WHERE id = ANY(event_ids) AND attributes->>'admin_deleted_at' IS NULL;
  IF matched <> requested THEN RAISE EXCEPTION '活动已变动，请刷新后重试。'; END IF;
  IF operation = 'publish' THEN
    IF EXISTS(SELECT 1 FROM public.events WHERE id = ANY(event_ids)
      AND (coalesce(jsonb_array_length(coalesce(attributes->'unmatched_import_names','[]'::jsonb)),0) > 0 OR coalesce(cardinality(artist_ids),0)=0)) THEN
      RAISE EXCEPTION '所选活动存在待匹配艺人，不能发布。';
    END IF;
    UPDATE public.events SET status='published', scheduled_publish_at=NULL, updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id = ANY(event_ids);
    UPDATE public.tasks SET status='published', updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE event_id = ANY(event_ids) AND status='draft';
  ELSE
    UPDATE public.events SET status='withdrawn', scheduled_publish_at=NULL,
      attributes=coalesce(attributes,'{}'::jsonb)||jsonb_build_object('admin_deleted_at',clock_timestamp()),
      updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE id = ANY(event_ids);
    UPDATE public.tasks SET status='withdrawn', updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE event_id = ANY(event_ids);
  END IF;
  RETURN requested;
END;
$$;
REVOKE ALL ON FUNCTION public.chob_manage_events(uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_manage_events(uuid[],text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
