-- Additive Drama V1 storage. Existing Schedule tables and policies are untouched.
-- All content remains administrator-only; no public release path in this migration.
create table public.drama_release (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.drama_release(singleton,enabled) values(true,false);
create table public.drama_platforms(id text primary key,name text not null,logo text not null default '');
insert into public.drama_platforms(id,name) values('youtube','YouTube'),('iqiyi','爱奇艺');
create table public.drama_series(
 id uuid primary key default gen_random_uuid(), data jsonb not null,
 version integer not null default 1 check(version>0), state text not null default 'ready' check(state in ('ready','archived')),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(jsonb_typeof(data)='object'),
 check(coalesce(nullif(btrim(data->>'titleZh'),''),nullif(btrim(data->>'titleEn'),''),nullif(btrim(data->>'titleTh'),'')) is not null)
);
create table public.drama_cast(
 series_id uuid not null references public.drama_series(id) on delete cascade,
 artist_id uuid not null references public.artists(id),role_name text not null default '',is_lead boolean not null default false,
 primary key(series_id,artist_id,role_name)
);
create index drama_cast_artist_idx on public.drama_cast(artist_id);
create table public.drama_rules(
 series_id uuid not null references public.drama_series(id) on delete cascade,id text not null,
 platform_id text not null references public.drama_platforms(id),data jsonb not null,
 primary key(series_id,id)
);
create index drama_rules_platform_idx on public.drama_rules(platform_id);
create table public.drama_airings(
 id text primary key,series_id uuid not null references public.drama_series(id) on delete cascade,
 rule_id text not null,episode integer not null check(episode between 1 and 1000),platform_id text not null references public.drama_platforms(id),
 air_date date not null,air_time time not null,timezone text not null,
 status text not null default 'scheduled' check(status in ('scheduled','changed')),
 confidence text not null default 'calculated' check(confidence in ('confirmed','calculated')),
 replaces_id text references public.drama_airings(id),announcement_id uuid,
 foreign key(series_id,rule_id) references public.drama_rules(series_id,id)
);
create index drama_airings_series_date_idx on public.drama_airings(series_id,air_date);
create index drama_airings_rule_idx on public.drama_airings(series_id,rule_id);
create index drama_airings_platform_idx on public.drama_airings(platform_id);
create index drama_airings_replaces_idx on public.drama_airings(replaces_id);
create table public.drama_notices(
 id uuid primary key default gen_random_uuid(),series_id uuid not null references public.drama_series(id) on delete cascade,
 episode integer not null check(episode between 1 and 1000),content text not null check(length(btrim(content))>0),
 change jsonb not null,created_at timestamptz not null default now()
);
create index drama_notices_series_idx on public.drama_notices(series_id);
alter table public.drama_airings add constraint drama_airing_notice_fk foreign key(announcement_id) references public.drama_notices(id);
create index drama_airings_notice_idx on public.drama_airings(announcement_id);
create table public.drama_event_links(
 id uuid primary key default gen_random_uuid(),series_id uuid not null references public.drama_series(id),
 event_id uuid references public.events(id),data jsonb not null,version integer not null default 1,
 unique(series_id,event_id)
);
create index drama_event_links_series_idx on public.drama_event_links(series_id);
create index drama_event_links_event_idx on public.drama_event_links(event_id);
create table public.drama_drafts(
 id uuid primary key,owner_id uuid not null default auth.uid() references auth.users(id),data jsonb not null,
 updated_at timestamptz not null default now()
);
create index drama_drafts_owner_idx on public.drama_drafts(owner_id);
do $$ declare t text; begin
 foreach t in array array['drama_release','drama_platforms','drama_series','drama_cast','drama_rules','drama_airings','drama_notices','drama_event_links','drama_drafts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('create policy drama_admin_only on public.%I for all to authenticated using ((select chob_private.is_admin())) with check ((select chob_private.is_admin()))',t);
 end loop;
end $$;
create or replace function public.chob_drama_save(payload jsonb,expected_version integer default 0) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sid uuid := coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid()); current_row public.drama_series; c jsonb;r jsonb;ep integer;total integer;per_release integer;interval_days integer;first_day date;rule_id text;tz text;tm time;weekly boolean;days jsonb;phase jsonb;candidate date;release_day boolean;batch integer;phase_dates text[];
begin
 if not chob_private.is_admin() then raise exception '仅管理员可以执行此操作' using errcode='42501';end if;
 select * into current_row from public.drama_series where id=sid for update;
 if found then
  if current_row.version is distinct from expected_version then raise exception '资料已被更新，请刷新后重试' using errcode='40001'; end if;
  if exists(select 1 from public.drama_notices where series_id=sid) and coalesce(current_row.data->'rules','[]'::jsonb)<>coalesce(payload->'rules','[]'::jsonb) then raise exception '已有变动历史，请使用单集调整，不能覆盖排期规则';end if;
 else
  if expected_version is distinct from 0 then raise exception '记录不存在，请刷新' using errcode='40001';end if;
 end if;
 if jsonb_typeof(coalesce(payload->'types','[]'::jsonb))<>'array' or exists(select 1 from jsonb_array_elements_text(coalesce(payload->'types','[]'::jsonb)) x where x not in ('Boys Love','Girls Love','BG','Bromance','群像','其他')) then raise exception '类型无效';end if;
 if jsonb_typeof(coalesce(payload->'cast','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(payload->'rules','[]'::jsonb))<>'array' then raise exception '卡司或排期格式无效';end if;
 insert into public.drama_series(id,data) values(sid,payload||jsonb_build_object('id',sid))
 on conflict(id) do update set data=excluded.data,version=public.drama_series.version+1,updated_at=now();
 delete from public.drama_cast where series_id=sid;
 for c in select value from jsonb_array_elements(coalesce(payload->'cast','[]'::jsonb)) loop
  insert into public.drama_cast(series_id,artist_id,role_name,is_lead) values(sid,(c->>'artistId')::uuid,coalesce(c->>'role',''),coalesce((c->>'lead')::boolean,false));
 end loop;
 if not exists(select 1 from public.drama_notices where series_id=sid) then
  delete from public.drama_airings where series_id=sid;
  delete from public.drama_rules where series_id=sid;
  for r in select value from jsonb_array_elements(coalesce(payload->'rules','[]'::jsonb)) loop
   rule_id:=r->>'id'; if coalesce(rule_id,'')='' then raise exception '排期规则缺少 ID';end if;
   insert into public.drama_rules(series_id,id,platform_id,data) values(sid,rule_id,r->>'platformId',r);
   if coalesce(r->>'premiere','')='' then continue;end if;
   first_day:=(r->>'premiere')::date;total:=(r->>'totalEpisodes')::integer;per_release:=coalesce((r->>'episodesPerRelease')::integer,1);interval_days:=coalesce((r->>'intervalDays')::integer,7);
   if total is null or total not between 1 and 1000 or per_release not between 1 and 1000 or interval_days not between 1 and 1000 then raise exception '集数和周期必须在 1–1000 之间';end if;
   tz:=r->>'timezone';tm:=(r->>'time')::time;
   if tm is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception '时间或时区无效';end if;
   weekly:=r ? 'weekdays';
   if weekly then
    days:=r->'weekdays';
    if jsonb_typeof(days)<>'array' then raise exception '请选择播出日';end if;
    if jsonb_array_length(days)=0 or exists(select 1 from jsonb_array_elements(days) d where d::text not in ('0','1','2','3','4','5','6')) then raise exception '播出日无效';end if;
    
   end if;
   if jsonb_typeof(coalesce(r->'phases','[]'::jsonb))<>'array' then raise exception '播出阶段格式无效';end if;
   phase_dates:=array[]::text[];
   for phase in select value from jsonb_array_elements(coalesce(r->'phases','[]'::jsonb)) loop
    if not weekly or coalesce(phase->>'from','')='' or (phase->>'from')::date<first_day or phase->>'from'=any(phase_dates) then raise exception '调整生效日不能早于首播日且不能重复';end if;
    phase_dates:=array_append(phase_dates,phase->>'from');
    if jsonb_typeof(phase->'weekdays') is distinct from 'array' then raise exception '调整播出日无效';end if;
    if jsonb_array_length(phase->'weekdays')=0 or exists(select 1 from jsonb_array_elements(phase->'weekdays') d where d::text not in ('0','1','2','3','4','5','6')) then raise exception '调整播出日无效';end if;
   end loop;
   if weekly then
    days:=r->'weekdays';
    select value into phase from jsonb_array_elements(coalesce(r->'phases','[]'::jsonb)) where (value->>'from')::date=first_day limit 1;
    if found then days:=phase->'weekdays';end if;
    if not days @> jsonb_build_array(extract(dow from first_day)::integer) then raise exception '首播日期必须属于选定的播出日';end if;
   end if;
   ep:=1;candidate:=first_day;
   while ep<=total loop
    if weekly then
     days:=r->'weekdays';
     select value into phase from jsonb_array_elements(coalesce(r->'phases','[]'::jsonb)) where (value->>'from')::date<=candidate order by (value->>'from')::date desc limit 1;
     if found then days:=phase->'weekdays';end if;
     release_day:=days @> jsonb_build_array(extract(dow from candidate)::integer);
    else release_day:=true;end if;
    if release_day then
     for batch in 1..per_release loop
      exit when ep>total;
      insert into public.drama_airings(id,series_id,rule_id,episode,platform_id,air_date,air_time,timezone,confidence)
      values(sid::text||':'||rule_id||':'||ep,sid,rule_id,ep,r->>'platformId',candidate,tm,tz,case when ep=1 then 'confirmed' else 'calculated' end);
      ep:=ep+1;
     end loop;
    end if;
    candidate:=candidate+case when weekly then 1 else interval_days end;
   end loop;
  end loop;
 end if;
 return (select jsonb_build_object('id',id,'version',version,'data',data) from public.drama_series where id=sid);
end $$;
revoke all on function public.chob_drama_save(jsonb,integer) from public,anon;
grant execute on function public.chob_drama_save(jsonb,integer) to authenticated;
create or replace function public.chob_drama_change(airing_id text,new_date date,new_time time,content text,expected_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old public.drama_airings; s public.drama_series;nid uuid:=gen_random_uuid();new_id text;original_json jsonb;replacement_json jsonb;notice_json jsonb;result jsonb;
begin
 if not chob_private.is_admin() then raise exception '仅管理员可以执行此操作' using errcode='42501';end if;
 select * into old from public.drama_airings where id=airing_id;
 if not found then raise exception '播出记录不存在';end if;
 select * into s from public.drama_series where id=old.series_id for update;
 if s.version is distinct from expected_version then raise exception '资料已被更新，请刷新' using errcode='40001';end if;
 select * into old from public.drama_airings where id=airing_id for update;
 if old.status<>'scheduled' then raise exception '原记录已调整，请选择最新播出记录';end if;
 if new_date is null or new_time is null or coalesce(btrim(content),'')='' then raise exception '请填写新日期、时间和变动说明';end if;
 new_id:=old.id||':change:'||nid;
 original_json:=jsonb_build_object('id',old.id,'dramaId',old.series_id,'ruleId',old.rule_id,'episode',old.episode,'platformId',old.platform_id,'date',old.air_date,'time',left(old.air_time::text,5),'timezone',old.timezone,'confidence',old.confidence,'status','changed','announcementId',nid);
 replacement_json:=original_json||jsonb_build_object('id',new_id,'date',new_date,'time',left(new_time::text,5),'status','scheduled','confidence','confirmed','replacesId',old.id);
 notice_json:=jsonb_build_object('id',nid,'content',content,'dramaId',old.series_id,'affectedEpisodes',jsonb_build_array(old.episode),'originalDate',old.air_date,'updatedDate',new_date);
 result:=jsonb_build_object('original',original_json,'replacement',replacement_json,'announcement',notice_json);
 insert into public.drama_notices(id,series_id,episode,content,change) values(nid,old.series_id,old.episode,content,result);
 update public.drama_airings set status='changed',announcement_id=nid where id=old.id;
 insert into public.drama_airings(id,series_id,rule_id,episode,platform_id,air_date,air_time,timezone,status,confidence,replaces_id,announcement_id)
 values(new_id,old.series_id,old.rule_id,old.episode,old.platform_id,new_date,new_time,old.timezone,'scheduled','confirmed',old.id,nid);
 update public.drama_series set version=version+1,updated_at=now() where id=old.series_id;
 return result;
end $$;
revoke all on function public.chob_drama_change(text,date,time,text,integer) from public,anon;
grant execute on function public.chob_drama_change(text,date,time,text,integer) to authenticated;



create index drama_series_created_by_idx on public.drama_series(created_by);
