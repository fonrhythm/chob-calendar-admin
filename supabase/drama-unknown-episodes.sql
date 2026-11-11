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
   first_day:=(r->>'premiere')::date;total:=case when r->>'totalEpisodesUnknown'='true' then 1000 else (r->>'totalEpisodes')::integer end;per_release:=coalesce((r->>'episodesPerRelease')::integer,1);interval_days:=coalesce((r->>'intervalDays')::integer,7);
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
    exit when r->>'totalEpisodesUnknown'='true' and candidate>greatest(first_day,current_date)+90;
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
