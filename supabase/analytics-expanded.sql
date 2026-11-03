BEGIN;
CREATE OR REPLACE FUNCTION public.chob_analytics(filters jsonb DEFAULT '{}'::jsonb, subject text DEFAULT NULL, page_number integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; start_day date:=nullif(filters->>'start','')::date; end_day date:=nullif(filters->>'end','')::date; previous_start date; previous_end date;
BEGIN
 IF NOT coalesce(chob_private.is_admin(),false) THEN RAISE EXCEPTION '仅管理员可以查看统计' USING ERRCODE='42501'; END IF;
 IF start_day>end_day OR page_number<0 THEN RAISE EXCEPTION '筛选范围无效'; END IF;
 IF coalesce(filters->>'kind','personal') NOT IN ('personal','cp','group') THEN RAISE EXCEPTION '统计主体无效'; END IF;
 previous_start:=CASE WHEN filters->>'compare'='year' THEN (start_day-interval '1 year')::date ELSE start_day-(end_day-start_day+1) END;
 previous_end:=CASE WHEN filters->>'compare'='year' THEN (end_day-interval '1 year')::date ELSE start_day-1 END;
 WITH catalog AS MATERIALIZED (
  SELECT a.id::text id,a.name::text name,CASE WHEN nullif(a.group_kind,'') IS NULL THEN 'personal' ELSE 'group' END kind,a.categories,a.deleted_at FROM public.artists a
  UNION ALL SELECT 'cp:'||p.id::text,p.cp_name,'cp',coalesce(a.categories,'{}'::text[])||coalesce(b.categories,'{}'::text[]),p.deleted_at FROM public.cp_pairs p LEFT JOIN public.artists a ON a.id=p.artist_1_id LEFT JOIN public.artists b ON b.id=p.artist_2_id
 ), base AS MATERIALIZED (
  SELECT e.id,e.title,e.date,e.location_region city,e.status,e.cancelled_at,e.attributes,e.participation_condition,
   coalesce(nullif(e.attributes->>'activity_category',''),'unknown') category,
   CASE lower(e.attributes->>'region') WHEN 'thailand' THEN '泰国' WHEN '泰国' THEN '泰国' WHEN 'china' THEN '中国' WHEN '中国' THEN '中国' WHEN 'oversea' THEN '海外' WHEN 'overseas' THEN '海外' WHEN '海外' THEN '海外' WHEN '其他国家或地区' THEN '海外' WHEN 'philippines' THEN '海外' WHEN 'south korea' THEN '海外' ELSE '待确认' END region
  FROM public.events e WHERE nullif(e.attributes->>'admin_deleted_at','') IS NULL AND nullif(e.attributes->>'merged_into','') IS NULL
 ), eligible AS MATERIALIZED (
  SELECT b.* FROM base b WHERE (coalesce(filters->>'category','')='' OR b.category=filters->>'category')
   AND (coalesce(filters->>'region','')='' OR b.region=filters->>'region')
   AND (coalesce(filters->>'city','')='' OR b.city=filters->>'city')
   AND (coalesce(filters->>'status','effective')='all' OR (b.status='published' AND b.date IS NOT NULL AND b.cancelled_at IS NULL AND coalesce(b.attributes->>'event_status','active') NOT IN ('cancelled','postponed')))
   AND (coalesce(filters->>'genre','')='' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(b.attributes->'artist_selections','[]')) s JOIN catalog c ON c.id=s.value WHERE c.kind=coalesce(filters->>'kind','personal') AND c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM unnest(c.categories) g WHERE lower(g)=lower(filters->>'genre'))))

   AND (coalesce(filters->>'participation','')='' OR b.participation_condition=filters->>'participation')
 ), selected AS MATERIALIZED (
  SELECT * FROM eligible b WHERE (start_day IS NULL OR b.date>=start_day) AND (end_day IS NULL OR b.date<=end_day)
 ), member_scope AS MATERIALIZED (
  SELECT b.* FROM base b WHERE (coalesce(filters->>'category','')='' OR b.category=filters->>'category')
   AND (coalesce(filters->>'region','')='' OR b.region=filters->>'region')
   AND (coalesce(filters->>'city','')='' OR b.city=filters->>'city')
   AND (coalesce(filters->>'status','effective')='all' OR (b.status='published' AND b.date IS NOT NULL AND b.cancelled_at IS NULL AND coalesce(b.attributes->>'event_status','active') NOT IN ('cancelled','postponed')))

   AND (coalesce(filters->>'participation','')='' OR b.participation_condition=filters->>'participation')

 AND (start_day IS NULL OR b.date>=start_day) AND (end_day IS NULL OR b.date<=end_day)
 ), previous AS MATERIALIZED (
  SELECT * FROM eligible b WHERE start_day IS NOT NULL AND end_day IS NOT NULL AND b.date>=previous_start AND b.date<=previous_end
 ), previous_counts AS (
  SELECT s.value id,count(DISTINCT p.id) previous_n FROM previous p CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.attributes->'artist_selections','[]')) s GROUP BY s.value
 ), relations AS MATERIALIZED (
  SELECT DISTINCT b.id event_id,c.id,c.name,c.kind,c.deleted_at FROM selected b CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(b.attributes->'artist_selections','[]')) s JOIN catalog c ON c.id=s.value
  WHERE c.kind=coalesce(filters->>'kind','personal') AND (coalesce(filters->>'genre','')='' OR EXISTS(SELECT 1 FROM unnest(c.categories) g WHERE lower(g)=lower(filters->>'genre')))
 ), counts AS (
  SELECT id,name,kind,deleted_at,count(*) n FROM relations GROUP BY id,name,kind,deleted_at
 ), ranked AS MATERIALIZED (
  SELECT c.*,coalesce(p.previous_n,0) previous_n,rank() OVER(ORDER BY n DESC) position,count(*) OVER() population FROM counts c LEFT JOIN previous_counts p USING(id)
 ), detail AS MATERIALIZED (
  SELECT b.id,b.title,b.date,b.city,b.category,b.region FROM selected b WHERE (subject IS NULL OR EXISTS(SELECT 1 FROM relations r WHERE r.event_id=b.id AND r.id=subject))
 ), members AS MATERIALIZED (
  SELECT a.id::text id,a.name FROM public.cp_pairs p JOIN public.artists a ON a.id IN(p.artist_1_id,p.artist_2_id) WHERE 'cp:'||p.id::text=subject
  UNION SELECT a.id::text,a.name FROM public.artists g JOIN public.artists a ON a.id=ANY(g.group_member_ids) WHERE g.id::text=subject AND nullif(g.group_kind,'') IS NOT NULL
 ), member_counts AS (
  SELECT m.id,m.name,(SELECT count(*) FROM member_scope b WHERE coalesce(b.attributes->'artist_selections','[]') ? m.id) n FROM members m
 ), quality AS (
  SELECT b.id,b.title,b.date,
  concat_ws('；',CASE WHEN b.date IS NULL THEN '日期未定' END,CASE WHEN coalesce(b.attributes->'artist_selections','[]')='[]'::jsonb THEN '没有明确艺人关联' END,CASE WHEN b.region='待确认' THEN '地区待确认' END,CASE WHEN b.category='unknown' THEN '缺少活动分类' END) issue FROM base b
 )
 SELECT jsonb_build_object(
 'total',(SELECT count(*) FROM selected),
 'participating',(SELECT count(*) FROM counts),
 'active',(SELECT count(*) FROM ranked WHERE position<=ceil(population/2.0)),
 'catalog_total',(SELECT count(*) FROM catalog c WHERE c.deleted_at IS NULL AND c.kind=coalesce(filters->>'kind','personal') AND (coalesce(filters->>'genre','')='' OR EXISTS(SELECT 1 FROM unnest(c.categories) g WHERE lower(g)=lower(filters->>'genre')))),
 'covered',(SELECT count(*) FROM counts WHERE deleted_at IS NULL),
 'rankings',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.position,t.name,t.id) FROM (SELECT id,name,kind,n,previous_n,position,deleted_at IS NOT NULL archived FROM ranked ORDER BY n DESC,name,id LIMIT 100 OFFSET CASE WHEN subject IS NULL THEN page_number*100 ELSE 0 END)t),'[]'),
 'detail_total',(SELECT count(*) FROM detail),
 'details',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date,t.id) FROM (SELECT * FROM detail ORDER BY date NULLS LAST,id LIMIT 100 OFFSET page_number*100)t),'[]'),
 'categories',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT category,count(*) n FROM detail GROUP BY category ORDER BY count(*) DESC)t),'[]'),
 'months',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.month_key) FROM (SELECT to_char(date,'YYYY-MM') AS month_key,count(*) n FROM detail WHERE date IS NOT NULL GROUP BY 1)t),'[]'),

 'members',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM member_counts ORDER BY n DESC,name LIMIT 100)t),'[]'),
 'member_same_stage',(SELECT count(*) FROM member_scope b WHERE (SELECT count(*) FROM members)>1 AND NOT EXISTS(SELECT 1 FROM members m WHERE NOT(coalesce(b.attributes->'artist_selections','[]') ? m.id))),
 'subject_name',(SELECT name FROM catalog WHERE id=subject),
 'subject_previous',(SELECT count(*) FROM previous p WHERE subject IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p.attributes->'artist_selections','[]')) s WHERE s.value=subject)),
 'comparison',jsonb_build_object('previous_total',(SELECT count(*) FROM previous),'start',previous_start,'end',previous_end,'incomplete',end_day>=((now() AT TIME ZONE 'Asia/Bangkok')::date),'available',start_day IS NOT NULL AND end_day IS NOT NULL),
 'regions',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT region category,count(*) n FROM detail GROUP BY region ORDER BY count(*) DESC)t),'[]'),
 'cities',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT city category,count(*) n FROM detail GROUP BY city ORDER BY count(*) DESC LIMIT 100)t),'[]'),
 'matrix',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT r.id,b.category,count(*) n FROM relations r JOIN selected b ON b.id=r.event_id WHERE r.id IN(SELECT id FROM ranked ORDER BY n DESC,name,id LIMIT 100 OFFSET page_number*100) GROUP BY r.id,b.category)t),'[]'),
 'quality_total',(SELECT count(*) FROM quality WHERE issue<>''),
 'quality',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM quality WHERE issue<>'' ORDER BY date NULLS LAST,id LIMIT 100 OFFSET page_number*100)t),'[]'),
 'options',jsonb_build_object('categories',(SELECT jsonb_agg(DISTINCT category) FROM base),'participation',(SELECT jsonb_agg(DISTINCT participation_condition) FROM base WHERE nullif(participation_condition,'') IS NOT NULL),'cities',(SELECT jsonb_agg(DISTINCT city) FROM base WHERE nullif(city,'') IS NOT NULL))
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.chob_analytics(jsonb,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_analytics(jsonb,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
