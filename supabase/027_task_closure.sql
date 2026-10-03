BEGIN;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS result_url text NOT NULL DEFAULT '';
DO $migration$
DECLARE original text; revised text; marker text := 'IF NOT FOUND THEN RAISE EXCEPTION ''事项归属已改变，请重新加载。''; END IF;';
BEGIN
 SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) INTO original;
 IF strpos(original,'公示链接无效')=0 THEN
  IF strpos(original,marker)=0 THEN RAISE EXCEPTION '事项保存接口版本不符'; END IF;
  revised:=replace(original,marker,marker || '
    IF task ? ''is_closed'' AND jsonb_typeof(task->''is_closed'')<>''boolean'' THEN RAISE EXCEPTION ''结束状态无效''; END IF;
    IF nullif(task->>''result_url'','''') IS NOT NULL AND (length(task->>''result_url'')>2048 OR task->>''result_url'' !~* ''^https?://[^[:space:]]+$'') THEN RAISE EXCEPTION ''公示链接无效''; END IF;
    UPDATE public.tasks SET is_closed=coalesce((task->>''is_closed'')::boolean,is_closed),result_url=coalesce(task->>''result_url'',result_url) WHERE id=task_id_value AND event_id=event_id_value;');
  EXECUTE revised;
 END IF;
 SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) INTO original;
 IF strpos(original,'''is_closed''')=0 THEN
  IF strpos(original,'''task_type'',t.task_type')=0 THEN RAISE EXCEPTION '公开事项接口版本不符'; END IF;
  revised:=replace(original,'''task_type'',t.task_type','''task_type'',t.task_type,''is_closed'',t.is_closed,''result_url'',t.result_url');
  EXECUTE revised;
 END IF;
END $migration$;
INSERT INTO chob_private.migrations(version) VALUES('027') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
