-- 注册账号必须经管理员审核，才能进入管理后台；不改变公开网站的普通会员权限。
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS backend_approved boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS backend_review_status text NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chob_backend_review_status_check' AND conrelid='public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT chob_backend_review_status_check
      CHECK (backend_review_status IN ('pending','approved','rejected','revoked'));
  END IF;
END $$;
-- 已有管理员保留访问；原有普通注册账号需要重新审核。
UPDATE public.users SET backend_approved=true, backend_review_status='approved'
WHERE role='admin' AND (backend_approved=false OR backend_review_status<>'approved');

CREATE OR REPLACE FUNCTION chob_private.can_review_users() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id=auth.uid() AND role='admin' AND is_active IS TRUE
      AND email_verified IS TRUE AND backend_approved IS TRUE
  );
$$;
REVOKE ALL ON FUNCTION chob_private.can_review_users() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION chob_private.can_review_users() TO authenticated;

DROP POLICY IF EXISTS chob_admin_users_read ON public.users;
CREATE POLICY chob_admin_users_read ON public.users FOR SELECT TO authenticated
USING (chob_private.can_review_users());

CREATE OR REPLACE FUNCTION public.chob_review_backend_user(target_user_id uuid, decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reviewed public.users%ROWTYPE;
BEGIN
  IF NOT chob_private.can_review_users() THEN
    RAISE EXCEPTION '仅管理员可以审核后台账号。' USING ERRCODE='42501';
  END IF;
  IF decision NOT IN ('approved','rejected','revoked') THEN
    RAISE EXCEPTION '审核决定无效。';
  END IF;
  SELECT * INTO reviewed FROM public.users WHERE id=target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '账号不存在。'; END IF;
  IF reviewed.role='admin' OR target_user_id=auth.uid() THEN
    RAISE EXCEPTION '不能在此处修改管理员账号。';
  END IF;
  UPDATE public.users SET backend_approved=(decision='approved'),
    backend_review_status=decision, updated_at=clock_timestamp()
  WHERE id=target_user_id RETURNING * INTO reviewed;
  RETURN jsonb_build_object('id',reviewed.id,'email',reviewed.email,
    'backend_approved',reviewed.backend_approved,
    'backend_review_status',reviewed.backend_review_status);
END;
$$;
REVOKE ALL ON FUNCTION public.chob_review_backend_user(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chob_review_backend_user(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
