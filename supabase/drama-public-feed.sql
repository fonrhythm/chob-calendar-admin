-- Public projection only: drafts, submissions and administrator metadata remain private.
create or replace function public.chob_drama_public_feed() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.drama_release where singleton and enabled) then
 jsonb_build_object(
 'dramas',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'titleZh',s.data->'titleZh','titleEn',s.data->'titleEn','titleTh',s.data->'titleTh','types',s.data->'types','production',s.data->'production','productionCompany',s.data->'productionCompany','poster',s.data->'poster','images',s.data->'images','synopsis',s.data->'synopsis','source',s.data->'source','cast',coalesce(s.data->'cast','[]'::jsonb),'rules',coalesce(s.data->'rules','[]'::jsonb))) from public.drama_series s where state='ready'),'[]'::jsonb),
 'platforms',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'logo',p.logo)) from public.drama_platforms p),'[]'::jsonb),
 'changes',coalesce((select jsonb_agg(n.change) from public.drama_notices n join public.drama_series s on s.id=n.series_id where s.state='ready'),'[]'::jsonb),
 'events','[]'::jsonb,'artists','[]'::jsonb)
 else jsonb_build_object('dramas','[]'::jsonb,'platforms','[]'::jsonb,'changes','[]'::jsonb,'events','[]'::jsonb,'artists','[]'::jsonb) end;
$$;
revoke all on function public.chob_drama_public_feed() from public;
grant execute on function public.chob_drama_public_feed() to anon,authenticated;
