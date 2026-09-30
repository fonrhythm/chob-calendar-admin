-- 为活动、公开投稿和导入统一增加“时装周”，并保留已启用的见面会及发布会分类。
BEGIN;
CREATE OR REPLACE FUNCTION public.chob_activity_category(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN lower(btrim(value))='brand' THEN 'interaction'
 WHEN lower(btrim(value)) IN ('music','screen','meet','press','fashion','interaction','awards','broadcast','other') THEN lower(btrim(value))
 WHEN value ~* '时装周|fashion[[:space:]]*week' THEN 'fashion'
 WHEN value ~* '发布会|记者会|新闻发布|press.?conference' THEN 'press'
 WHEN value ~* '见面会|签售|fan.?meet|fan.?sign' THEN 'meet'
 WHEN value ~* '颁奖|红毯|award|red.?carpet' THEN 'awards'
 WHEN value ~* '互动|粉丝|品牌|商务|站台|代言|brand' THEN 'interaction'
 WHEN value ~* '音乐|演唱|演出|舞台|音乐节|concert|festival|livehouse|stage' THEN 'music'
 WHEN value ~* '影视|剧集|电影|首映|series|screen|premiere' THEN 'screen'
 WHEN value ~* '节目|直播|广播|电台|broadcast|live|radio|综艺' THEN 'broadcast'
 ELSE 'other' END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
