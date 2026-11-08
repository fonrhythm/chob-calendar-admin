import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('Drama save is atomic, private, versioned; changes retain history and drafts permit incomplete data',async()=>{
const db=new PGlite();try{
await db.exec(`create role anon;create role authenticated;create schema auth;create schema chob_private;
create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-4000-8000-000000000001');
create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
create function chob_private.is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'no')='yes'$$;
create function chob_private.require_admin() returns void language plpgsql as $$begin if not chob_private.is_admin() then raise exception '仅管理员';end if;end$$;
grant usage on schema auth,chob_private to authenticated;grant execute on all functions in schema auth,chob_private to authenticated;
create table artists(id uuid primary key);create table events(id uuid primary key);
insert into artists values('00000000-0000-4000-8000-000000000002');`);
await db.exec(fs.readFileSync(new URL('../supabase/drama-v1.sql',import.meta.url),'utf8'));
const sid='00000000-0000-4000-8000-000000000003';
const payload={id:sid,titleZh:'测试',types:['Bromance','群像'],cast:[{artistId:'00000000-0000-4000-8000-000000000002',role:'Sun'}],rules:[{id:'r',platformId:'youtube',premiere:'2026-12-25',time:'21:30',timezone:'Asia/Bangkok',totalEpisodes:4,episodesPerRelease:2,intervalDays:7}]};
await db.exec('set role authenticated');
await assert.rejects(db.query('select chob_drama_save($1,0)',[payload]),/仅管理员/);
assert.equal((await db.query('select * from drama_series')).rows.length,0);
await db.exec("set test.admin='yes'");
await db.query('select chob_drama_save($1,0)',[payload]);
assert.equal((await db.query('select count(*)::int n from drama_airings')).rows[0].n,4);
assert.equal((await db.query('select air_date::text d from drama_airings where episode=3')).rows[0].d,'2027-01-01');
await assert.rejects(db.query('select chob_drama_save($1,0)',[payload]),/刷新/);
await db.query('select chob_drama_save($1,1)',[payload]);
assert.equal((await db.query('select count(*)::int n from drama_airings')).rows[0].n,4);
const invalid={...payload,cast:[{artistId:'00000000-0000-4000-8000-000000000099'}]};
await assert.rejects(db.query('select chob_drama_save($1,2)',[invalid]));
assert.equal((await db.query('select version from drama_series')).rows[0].version,2);
await db.query('select chob_drama_change($1,$2,$3,$4,2)',[sid+':r:2','2027-01-03','22:00','延期']);
assert.equal((await db.query("select count(*)::int n from drama_airings where status='changed'")).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from drama_notices')).rows[0].n,1);
await assert.rejects(db.query('select chob_drama_save($1,3)',[{...payload,rules:[]}]),/变动历史/);
await db.query('insert into drama_drafts(id,data) values($1,$2)',[sid,{titleZh:''}]);
await db.exec("set test.admin='no'");assert.equal((await db.query('select * from drama_series')).rows.length,0);assert.equal((await db.query('select * from drama_drafts')).rows.length,0);
await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from drama_series'),/permission denied/);
await db.exec('reset role');assert.equal((await db.query('select enabled from drama_release')).rows[0].enabled,false);
}finally{await db.close();}
});
