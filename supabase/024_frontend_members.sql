-- Review before applying. Transactional, additive; no Auth users are imported here.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS backend_access_requested boolean NOT NULL DEFAULT false;
-- Preserve the meaning of accounts that existed before this separation.
UPDATE public.users SET backend_access_requested=true
WHERE NOT EXISTS (SELECT 1 FROM chob_private.migrations WHERE version='024');

CREATE OR REPLACE FUNCTION chob_private.sync_auth_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.email IS NULL THEN RETURN new; END IF;
 INSERT INTO public.users(id,email,nickname,role,email_verified,backend_access_requested)
 VALUES(new.id,new.email,split_part(new.email,'@',1),'collaborator_fan',new.email_confirmed_at IS NOT NULL,
   coalesce(new.raw_user_meta_data->>'backend_access_requested','false')='true')
 ON CONFLICT(id) DO UPDATE SET email=excluded.email,email_verified=excluded.email_verified,updated_at=now();
 RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.chob_request_backend_access() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请先登录。' USING ERRCODE='42501'; END IF;
 -- Requesting access never approves an account or resets an earlier decision.
 UPDATE public.users SET backend_access_requested=true,updated_at=now()
 WHERE id=auth.uid() AND backend_access_requested=false;
END $$;
REVOKE ALL ON FUNCTION public.chob_request_backend_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_request_backend_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.chob_review_backend_user(target_user_id uuid,decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reviewed public.users%ROWTYPE;
BEGIN
 IF NOT chob_private.can_review_users() THEN RAISE EXCEPTION '仅管理员可以审核后台账号。' USING ERRCODE='42501'; END IF;
 IF decision IS NULL OR decision NOT IN ('approved','rejected','revoked') THEN RAISE EXCEPTION '审核决定无效。'; END IF;
 SELECT * INTO reviewed FROM public.users WHERE id=target_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '账号不存在。'; END IF;
 IF reviewed.role='admin' OR target_user_id=auth.uid() THEN RAISE EXCEPTION '不能在此处修改管理员账号。'; END IF;
 IF NOT reviewed.backend_access_requested THEN RAISE EXCEPTION '该用户尚未申请后台访问。'; END IF;
 IF decision='approved' AND (reviewed.email_verified IS NOT TRUE OR reviewed.is_active IS NOT TRUE) THEN
   RAISE EXCEPTION '账号需启用并完成邮箱验证后才能批准。';
 END IF;
 UPDATE public.users SET backend_approved=(decision='approved'),backend_review_status=decision,updated_at=now()
 WHERE id=target_user_id RETURNING * INTO reviewed;
 RETURN jsonb_build_object('id',reviewed.id,'backend_approved',reviewed.backend_approved,'backend_review_status',reviewed.backend_review_status);
END $$;
REVOKE ALL ON FUNCTION public.chob_review_backend_user(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_review_backend_user(uuid,text) TO authenticated;

ALTER TABLE public.chob_personal ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
ALTER TABLE public.chob_personal ADD COLUMN IF NOT EXISTS avatar_style text NOT NULL DEFAULT 'initials';
ALTER TABLE public.chob_personal ADD COLUMN IF NOT EXISTS avatar_color text NOT NULL DEFAULT '#5b8c72';
ALTER TABLE public.chob_personal ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.chob_admin_list_members(search_text text DEFAULT '',page_number integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; total bigint; q text:=left(btrim(coalesce(search_text,'')),100); offset_rows integer;
BEGIN
 IF NOT chob_private.can_review_users() THEN RAISE EXCEPTION '仅管理员可以查看用户。' USING ERRCODE='42501'; END IF;
 IF page_number IS NULL OR page_number<1 OR page_number>100000 THEN RAISE EXCEPTION '页码无效。'; END IF;
 offset_rows:=(page_number-1)*50;
 SELECT count(*) INTO total FROM public.users u LEFT JOIN public.chob_personal p ON p.id=u.id
 WHERE u.role<>'admin' AND u.backend_access_requested=false AND (q='' OR strpos(lower(u.email),lower(q))>0 OR strpos(lower(coalesce(p.nickname,u.nickname)),lower(q))>0);
 SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO result FROM (
 SELECT u.id,u.email,coalesce(nullif(p.nickname,''),u.nickname) AS nickname,u.email_verified,u.is_active,u.created_at,
 u.backend_access_requested,u.backend_approved,coalesce(p.bio,'') AS bio,
 coalesce(cardinality(p.favorites),0) AS event_favorites,coalesce(cardinality(p.artist_favorites),0) AS artist_favorites
 FROM public.users u LEFT JOIN public.chob_personal p ON p.id=u.id
 WHERE u.role<>'admin' AND u.backend_access_requested=false AND (q='' OR strpos(lower(u.email),lower(q))>0 OR strpos(lower(coalesce(p.nickname,u.nickname)),lower(q))>0)
 ORDER BY u.created_at DESC NULLS LAST,u.id LIMIT 50 OFFSET offset_rows
 ) t;
 RETURN jsonb_build_object('items',result,'total',total,'page',page_number);
END $$;
REVOKE ALL ON FUNCTION public.chob_admin_list_members(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_admin_list_members(text,integer) TO authenticated;

-- Preserve all existing validations in the deployed save function.
DO $migration$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.chob_save_personal(jsonb)'::regprocedure) INTO original;
 IF strpos(original,'个人简介最多500字')=0 THEN
  revised:=replace(original,'RETURN to_jsonb(result);',
  'IF length(coalesce(payload->>''bio'',''''))>500 THEN RAISE EXCEPTION ''个人简介最多500字。''; END IF;
   IF payload ? ''avatar_color'' AND coalesce(payload->>''avatar_color'','''') !~ ''^#[0-9A-Fa-f]{6}$'' THEN RAISE EXCEPTION ''头像颜色无效。''; END IF;
   IF payload ? ''avatar_style'' AND coalesce(payload->>''avatar_style'','''') NOT IN (''initials'',''circle'',''square'') THEN RAISE EXCEPTION ''头像样式无效。''; END IF;
   UPDATE public.chob_personal SET bio=coalesce(payload->>''bio'',bio),avatar_color=coalesce(payload->>''avatar_color'',avatar_color),avatar_style=coalesce(payload->>''avatar_style'',avatar_style)
   WHERE id=auth.uid() RETURNING * INTO result;
   RETURN to_jsonb(result);');
  IF revised=original THEN RAISE EXCEPTION '个人资料保存接口版本不符，停止变更。'; END IF;
  EXECUTE revised;
 END IF;
END $migration$;
INSERT INTO chob_private.migrations(version) VALUES('024') ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
