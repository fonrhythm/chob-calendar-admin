BEGIN;
CREATE OR REPLACE FUNCTION public.chob_activity_category(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN lower(value)='brand' THEN 'interaction'
 WHEN lower(value) IN ('interaction','music','awards','screen','broadcast','other') THEN lower(value)
 WHEN value ~* '颁奖|红毯|award|red.?carpet' THEN 'awards'
 WHEN value ~* '见面|互动|签售|粉丝|fan.?meet|fan.?sign|品牌|商务|站台|代言|brand' THEN 'interaction'
 WHEN value ~* '音乐|演唱|演出|舞台|音乐节|concert|festival|livehouse|stage' THEN 'music'
 WHEN value ~* '影视|剧集|电影|首映|series|screen|premiere' THEN 'screen'
 WHEN value ~* '节目|直播|广播|电台|broadcast|live|radio|综艺' THEN 'broadcast' ELSE 'other' END;
$$;
-- Keep original type records and event references; update the public category only.
UPDATE public.events SET attributes=attributes || jsonb_build_object('activity_category','interaction')
 WHERE attributes->>'activity_category'='brand';
NOTIFY pgrst,'reload schema';
COMMIT;
