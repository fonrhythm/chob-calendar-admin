-- 第一阶段：适用于用户确认的 7 张空业务表。请整段执行；任何错误都会回滚。
begin;
create schema if not exists chob_private;
revoke all on schema chob_private from public, anon, authenticated;
create table if not exists chob_private.migrations (version text primary key, applied_at timestamptz default now());
revoke all on all tables in schema chob_private from public,anon,authenticated;
do $$ begin
  if not exists (select 1 from chob_private.migrations where version = '001') and
    (exists(select 1 from public.users) or exists(select 1 from public.artists) or
     exists(select 1 from public.events) or exists(select 1 from public.tasks) or
     exists(select 1 from public.invitations) or exists(select 1 from public.login_sessions) or
     exists(select 1 from public.password_resets)) then
    raise exception '初始化前检测到业务资料，请停止并核对；本脚本不会删除资料。';
  end if;
end $$;

alter table public.users alter column id drop default;
alter table public.users alter column role set default 'collaborator_fan';
do $$ begin
 if not exists(select 1 from pg_constraint where conname='chob_users_auth_fk' and conrelid='public.users'::regclass) then
  alter table public.users add constraint chob_users_auth_fk foreign key(id) references auth.users(id);
  alter table public.users add constraint chob_users_role_check check(role in ('admin','official_account','company_staff','collaborator_fan'));
 end if;
end $$;

create or replace function chob_private.sync_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.email is null then return new; end if;
 insert into public.users(id,email,nickname,role,email_verified)
 values(new.id,new.email,split_part(new.email,'@',1),'collaborator_fan',new.email_confirmed_at is not null)
 on conflict(id) do update set email=excluded.email,email_verified=excluded.email_verified,updated_at=now();
 return new;
end $$;
drop trigger if exists chob_auth_profile on auth.users;
create trigger chob_auth_profile after insert or update of email,email_confirmed_at on auth.users
for each row execute function chob_private.sync_auth_profile();
-- 已有 Auth 账号只补为普通角色；管理员在独立步骤明确指定。
insert into public.users(id,email,nickname,role,email_verified)
select id,email,split_part(email,'@',1),'collaborator_fan',email_confirmed_at is not null
from auth.users where email is not null on conflict(id) do nothing;

create or replace function chob_private.active_member() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where id=auth.uid() and is_active is true and email_verified is true);
$$;
create or replace function chob_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where id=auth.uid() and role='admin' and is_active is true and email_verified is true);
$$;
create or replace function chob_private.require_admin() returns void
language plpgsql security definer set search_path='' as $$ begin
 if not chob_private.is_admin() then raise exception '仅管理员可以执行此操作' using errcode='42501'; end if;
end $$;

alter table public.artists add column if not exists en_name text not null default '';
alter table public.artists add column if not exists aliases text[] not null default '{}';
alter table public.artists add column if not exists categories text[] not null default '{}';
alter table public.artists add column if not exists deleted_at timestamptz;
create unique index if not exists chob_artist_unique_name on public.artists(lower(btrim(name))) where deleted_at is null;
create table if not exists public.cp_pairs (
 id uuid primary key default gen_random_uuid(), cp_name text not null,
 artist_1_id uuid not null references public.artists(id), artist_2_id uuid not null references public.artists(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 check(artist_1_id<>artist_2_id), check(length(btrim(cp_name)) between 1 and 150)
);
create unique index if not exists chob_cp_unique_name on public.cp_pairs(lower(btrim(cp_name))) where deleted_at is null;
create table if not exists public.operation_logs (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
 action text not null, table_name text not null, record_id uuid not null,
 old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);
create table if not exists public.import_logs (
 id uuid primary key default gen_random_uuid(), uploaded_by uuid not null references public.users(id),
 file_name text not null, imported_count integer not null, created_at timestamptz not null default now()
);
create or replace function chob_private.audit_row() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 insert into public.operation_logs(user_id,action,table_name,record_id,old_value,new_value)
 values(auth.uid(),case when tg_op='INSERT' then 'create'
   when old.deleted_at is null and new.deleted_at is not null then 'delete'
   when old.deleted_at is not null and new.deleted_at is null then 'restore' else 'update' end,
   tg_table_name,new.id,case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
drop trigger if exists chob_artist_audit on public.artists;
create trigger chob_artist_audit after insert or update on public.artists for each row execute function chob_private.audit_row();
drop trigger if exists chob_cp_audit on public.cp_pairs;
create trigger chob_cp_audit after insert or update on public.cp_pairs for each row execute function chob_private.audit_row();

-- 所有写入由受控函数执行，不授予浏览器直接写表权限。
revoke all on public.users,public.artists,public.events,public.tasks,public.invitations,public.login_sessions,public.password_resets,
 public.cp_pairs,public.operation_logs,public.import_logs from public,anon,authenticated;
grant select on public.users,public.artists,public.cp_pairs,public.operation_logs,public.import_logs to authenticated;
alter table public.cp_pairs enable row level security;
alter table public.operation_logs enable row level security;
alter table public.import_logs enable row level security;
drop policy if exists chob_self_profile on public.users;
create policy chob_self_profile on public.users for select to authenticated using(id=auth.uid());
drop policy if exists chob_artist_read on public.artists;
create policy chob_artist_read on public.artists for select to authenticated using(chob_private.active_member() and (deleted_at is null or chob_private.is_admin()));
drop policy if exists chob_cp_read on public.cp_pairs;
create policy chob_cp_read on public.cp_pairs for select to authenticated using(chob_private.active_member() and (deleted_at is null or chob_private.is_admin()));
drop policy if exists chob_logs_read on public.operation_logs;
create policy chob_logs_read on public.operation_logs for select to authenticated using(chob_private.is_admin());
drop policy if exists chob_imports_read on public.import_logs;
create policy chob_imports_read on public.import_logs for select to authenticated using(chob_private.is_admin());

create or replace function public.chob_save_artist(payload jsonb, record_id uuid default null, expected_updated_at text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.artists; previous public.artists; cats text[]; names text[];
begin
 perform chob_private.require_admin();
 if coalesce(length(btrim(payload->>'name')),0) not between 1 and 150 then raise exception '艺人名称必填，最多150字'; end if;
 if jsonb_typeof(payload->'categories') is distinct from 'array' or jsonb_typeof(payload->'aliases') is distinct from 'array' then raise exception '类别和别名必须是数组'; end if;
 select coalesce(array_agg(distinct btrim(value)) filter(where btrim(value)<>''),'{}') into cats from jsonb_array_elements_text(payload->'categories');
 select coalesce(array_agg(distinct btrim(value)) filter(where btrim(value)<>''),'{}') into names from jsonb_array_elements_text(payload->'aliases');
 if cardinality(cats)>20 or cardinality(names)>30 then raise exception '类别或别名数量过多'; end if;
 if record_id is null then
  insert into public.artists(name,en_name,company,type,categories,aliases) values
   (btrim(payload->>'name'),coalesce(payload->>'en_name',''),coalesce(payload->>'company',''),array_to_string(cats,' / '),cats,names) returning * into result;
 else
  select * into previous from public.artists where id=record_id and deleted_at is null for update;
  if not found then raise exception '艺人不存在或已删除'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at::timestamp then raise exception '资料已被修改，请刷新后重试'; end if;
  update public.artists set name=btrim(payload->>'name'),en_name=coalesce(payload->>'en_name',''),company=coalesce(payload->>'company',''),
   categories=cats,type=array_to_string(cats,' / '),aliases=names,updated_at=clock_timestamp() where id=record_id returning * into result;
 end if;
 return to_jsonb(result);
end $$;

create or replace function public.chob_import_artists(rows jsonb, file_name text) returns integer
language plpgsql security definer set search_path='' as $$
declare item jsonb; count_rows integer;
begin
 perform chob_private.require_admin();
 if jsonb_typeof(rows) is distinct from 'array' then raise exception '导入格式无效'; end if;
 count_rows:=jsonb_array_length(rows);
 if count_rows not between 1 and 200 then raise exception '每批导入1至200位艺人'; end if;
 for item in select value from jsonb_array_elements(rows) loop perform public.chob_save_artist(item); end loop;
 insert into public.import_logs(uploaded_by,file_name,imported_count) values(auth.uid(),left(file_name,255),count_rows);
 return count_rows;
end $$;

create or replace function public.chob_save_cp(payload jsonb, record_id uuid default null, expected_updated_at text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.cp_pairs; previous public.cp_pairs; a uuid; b uuid;
begin
 perform chob_private.require_admin();
 a:=(payload->>'artist_1_id')::uuid; b:=(payload->>'artist_2_id')::uuid;
 -- 锁住成员，避免保存 CP 与删除艺人并发造成无效关联。
 perform 1 from public.artists where id in(a,b) order by id for update;
 if a=b or (select count(*) from public.artists where id in(a,b) and deleted_at is null)<>2 then raise exception '请选择两位不同且未删除的艺人'; end if;
 if record_id is null then
  insert into public.cp_pairs(cp_name,artist_1_id,artist_2_id) values(btrim(payload->>'cp_name'),a,b) returning * into result;
 else
  select * into previous from public.cp_pairs where id=record_id and deleted_at is null for update;
  if not found then raise exception 'CP不存在或已删除'; end if;
  if expected_updated_at is null or previous.updated_at is distinct from expected_updated_at::timestamptz then raise exception '资料已被修改，请刷新后重试'; end if;
  update public.cp_pairs set cp_name=btrim(payload->>'cp_name'),artist_1_id=a,artist_2_id=b,updated_at=clock_timestamp() where id=record_id returning * into result;
 end if;
 return to_jsonb(result);
end $$;

create or replace function public.chob_set_deleted(entity text, record_id uuid, deleted boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform chob_private.require_admin();
 if entity='artists' then
  perform 1 from public.artists where id=record_id for update;
  if not found then raise exception '艺人不存在'; end if;
  if deleted and (exists(select 1 from public.cp_pairs where deleted_at is null and (artist_1_id=record_id or artist_2_id=record_id))
   or exists(select 1 from public.events where record_id=any(artist_ids)) or exists(select 1 from public.tasks where record_id=any(related_artist_ids))) then
   raise exception '这位艺人已有关联记录，请先处理CP、活动或事项'; end if;
  update public.artists set deleted_at=case when deleted then now() else null end,updated_at=clock_timestamp() where id=record_id;
 elsif entity='cp_pairs' then
  if not deleted then
   perform 1 from public.artists where id in
    (select artist_1_id from public.cp_pairs where id=record_id union select artist_2_id from public.cp_pairs where id=record_id)
    order by id for update;
  end if;
  if not deleted and exists(select 1 from public.cp_pairs c join public.artists a on a.id in(c.artist_1_id,c.artist_2_id) where c.id=record_id and a.deleted_at is not null) then raise exception '请先恢复CP成员'; end if;
  update public.cp_pairs set deleted_at=case when deleted then now() else null end,updated_at=clock_timestamp() where id=record_id;
  if not found then raise exception 'CP不存在'; end if;
 else raise exception '不支持的记录类型'; end if;
end $$;

-- 默认的函数 EXECUTE 权限必须显式收紧；私有写入函数不开放。
revoke all on all functions in schema chob_private from public,anon,authenticated;
grant usage on schema chob_private to authenticated;
grant execute on function chob_private.active_member(),chob_private.is_admin() to authenticated;
revoke all on function public.chob_save_artist(jsonb,uuid,text),public.chob_import_artists(jsonb,text),public.chob_save_cp(jsonb,uuid,text),public.chob_set_deleted(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.chob_save_artist(jsonb,uuid,text),public.chob_import_artists(jsonb,text),public.chob_save_cp(jsonb,uuid,text),public.chob_set_deleted(text,uuid,boolean) to authenticated;
insert into chob_private.migrations(version) values('001') on conflict do nothing;
commit;
