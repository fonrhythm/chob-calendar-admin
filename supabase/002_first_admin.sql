-- 先运行001，再到Authentication / Users创建网站登录账号并验证邮箱。
-- 只修改下面的邮箱；Supabase平台登录账号不等于网站的Auth用户。
begin;
do $$
declare
 administrator_email text := '请替换为你的网站登录邮箱';
 administrator_id uuid;
 old_profile jsonb;
begin
 select id into administrator_id from auth.users
 where lower(email)=lower(btrim(administrator_email)) and email_confirmed_at is not null;
 if administrator_id is null then raise exception '找不到已验证邮箱的网站登录账号，请先在Authentication / Users核对。'; end if;
 if exists(select 1 from public.users where role='admin' and id<>administrator_id) then
  raise exception '已有其他管理员，此脚本只用于初始化第一位管理员。';
 end if;
 select to_jsonb(u) into old_profile from public.users u where id=administrator_id;
 if old_profile is null then raise exception '用户资料尚未建立，请先执行001脚本。'; end if;
 if old_profile->>'role'='admin' then return; end if;
 update public.users set role='admin',is_active=true,updated_at=now() where id=administrator_id;
 insert into public.operation_logs(user_id,action,table_name,record_id,old_value,new_value)
 select administrator_id,'admin_setup','users',id,old_profile,to_jsonb(u) from public.users u where id=administrator_id;
end $$;
commit;
