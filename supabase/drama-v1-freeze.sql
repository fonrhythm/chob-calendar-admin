-- Emergency access freeze only: retain all Drama data and leave Schedule unchanged.
begin;
update public.drama_release set enabled=false,updated_at=now() where singleton;
revoke all on function public.chob_drama_save(jsonb,integer) from authenticated;
revoke all on function public.chob_drama_change(text,date,time,text,integer) from authenticated;
do $$ declare t text;begin foreach t in array array['drama_release','drama_platforms','drama_series','drama_cast','drama_rules','drama_airings','drama_notices','drama_event_links','drama_drafts'] loop execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
commit;
