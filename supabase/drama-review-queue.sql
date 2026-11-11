-- Independent Drama intake; does not publish or change Schedule records.
create table public.drama_submissions (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 kind text not null check(kind in ('addition','correction')),
 series_id uuid references public.drama_series(id), payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reply text not null default '', resolved_by uuid references auth.users(id),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 check(jsonb_typeof(payload)='object'), check(octet_length(payload::text)<=100000),
 check(kind='addition' or series_id is not null)
);
create index drama_submissions_owner_idx on public.drama_submissions(owner_id,created_at desc);
create index drama_submissions_pending_idx on public.drama_submissions(status,created_at);
alter table public.drama_submissions enable row level security;
revoke all on public.drama_submissions from public,anon,authenticated;
grant select,update on public.drama_submissions to authenticated;
create policy drama_submission_read on public.drama_submissions for select to authenticated
 using ((select chob_private.is_admin()) or (owner_id=(select auth.uid()) and (select chob_private.active_member())));
create policy drama_submission_review on public.drama_submissions for update to authenticated
 using ((select chob_private.is_admin())) with check ((select chob_private.is_admin()));

-- Definer is required only for the restricted insert path: callers cannot choose owner/status.
create function public.chob_submit_drama(request_id uuid, submission_kind text, proposal jsonb, target_series uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.drama_submissions;
begin
 if auth.uid() is null or not chob_private.active_member() then raise exception '请先登录有效账号' using errcode='42501'; end if;
 if not chob_private.is_admin() and not exists(select 1 from public.drama_release where enabled) then raise exception 'Drama 尚未开放投稿' using errcode='42501'; end if;
 if request_id is null or submission_kind is null or submission_kind not in ('addition','correction') or proposal is null or jsonb_typeof(proposal)<>'object' or octet_length(proposal::text)>100000 then raise exception '投稿内容无效'; end if;
 if submission_kind='correction' and (target_series is null or not exists(select 1 from public.drama_series where id=target_series and state='ready') or length(btrim(coalesce(proposal->>'message','')))=0) then raise exception '请填写有效的剧集与纠错说明'; end if;
 if submission_kind='addition' and coalesce(nullif(btrim(proposal->>'titleZh'),''),nullif(btrim(proposal->>'titleEn'),''),nullif(btrim(proposal->>'titleTh'),'')) is null then raise exception '至少填写一种剧名'; end if;
 select * into existing from public.drama_submissions where id=request_id;
 if found then
  if existing.owner_id=auth.uid() and existing.kind=submission_kind and existing.payload=proposal and existing.series_id is not distinct from target_series then return request_id; end if;
  raise exception '此投稿编号已使用，请重新提交';
 end if;
 insert into public.drama_submissions(id,owner_id,kind,series_id,payload) values(request_id,auth.uid(),submission_kind,target_series,proposal);
 return request_id;
end $$;
revoke all on function public.chob_submit_drama(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.chob_submit_drama(uuid,text,jsonb,uuid) to authenticated;

-- Save approved series and resolve queue entry in one transaction. Release flag is untouched.
create function public.chob_review_drama(target uuid, decision text, response text default '', approved_payload jsonb default null, expected_version integer default 0)
returns void language plpgsql security invoker set search_path='' as $$
declare item public.drama_submissions;
begin
 if not chob_private.is_admin() then raise exception '仅管理员可审核' using errcode='42501'; end if;
 if decision is null or decision not in ('approved','rejected') or response is null or length(response)>4000 then raise exception '审核结果无效'; end if;
 select * into item from public.drama_submissions where id=target for update;
 if not found or item.status<>'pending' then raise exception '投稿已处理或不存在'; end if;
 if decision='approved' then
  if approved_payload is null or (item.kind='correction' and approved_payload->>'id' is distinct from item.series_id::text) then raise exception '请先编辑并确认审核资料'; end if;
  perform public.chob_drama_save(approved_payload,expected_version);
 end if;
 update public.drama_submissions set status=decision,reply=response,resolved_by=auth.uid(),resolved_at=now() where id=target;
end $$;
revoke all on function public.chob_review_drama(uuid,text,text,jsonb,integer) from public,anon;
grant execute on function public.chob_review_drama(uuid,text,text,jsonb,integer) to authenticated;
