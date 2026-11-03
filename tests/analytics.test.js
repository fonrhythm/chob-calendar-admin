import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {csvCell,percent} from '../src/lib/analytics.js';
test('analytics isolates identities, deduplicates, filters states and rejects non-admins',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create schema chob_private;
 create function chob_private.is_admin() returns boolean language sql as $$select current_setting('test.admin',true)='yes'$$;
 create table artists(id text,name text,group_kind text,categories text[],deleted_at timestamp,group_member_ids text[]);
 create table cp_pairs(id text,cp_name text,deleted_at timestamp,artist_1_id text,artist_2_id text);
 create table events(id text,title text,date date,location_region text,status text,cancelled_at timestamp,attributes jsonb,participation_condition text);
 insert into artists(id,name,group_kind,categories,deleted_at) values('a','A',null,array['SINGER'],null),('b','B',null,array['SINGER'],null),('g','Group','group',array['GROUP'],null);
 insert into cp_pairs values('p','A+B',null,'a','b');
 insert into events(id,title,date,location_region,status,cancelled_at,attributes) values
 ('1','CP','2026-11-01','Bangkok','published',null,'{"activity_category":"meet","region":"THAILAND","artist_selections":["cp:p"]}'),
 ('2','Group','2026-11-02','Bangkok','published',null,'{"activity_category":"music","region":"泰国","artist_selections":["g"]}'),
 ('3','Same stage','2026-11-03','Bangkok','published',null,'{"activity_category":"music","region":"泰国","artist_selections":["a","a","b"]}'),
 ('4','Cancelled','2026-11-04','Bangkok','published',null,'{"event_status":"cancelled","artist_selections":["a"]}'),
 ('5','Merged','2026-11-04','Bangkok','published',null,'{"merged_into":"3","artist_selections":["a"]}');`);
 await db.exec(fs.readFileSync(new URL('../supabase/analytics.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/analytics-expanded.sql',import.meta.url),'utf8'));
 await assert.rejects(db.query('select chob_analytics()'),/仅管理员/);
 await db.exec("set test.admin='yes'");
 const query=async(filters={},subject=null)=>(await db.query('select chob_analytics($1,$2,0) d',[JSON.stringify(filters),subject])).rows[0].d;
 const personal=await query();assert.equal(personal.total,3);assert.equal(personal.participating,2);assert.equal(personal.active,2);assert.deepEqual(personal.rankings.map(r=>r.n),[1,1]);
 assert.equal((await query({},'a')).detail_total,1);
 const cp=await query({kind:'cp'});assert.equal(cp.rankings[0].n,1);assert.equal(cp.rankings[0].id,'cp:p');
 assert.equal((await query({kind:'group'})).rankings[0].id,'g');
 assert.equal((await query({genre:'singer'})).total,1);
 assert.equal((await query({category:'music'})).total,2);
 assert.equal((await query({start:'2027-01-01'})).total,0);
 assert.equal((await query({status:'all'})).total,4);
 assert.equal((await query({kind:'cp',genre:'singer'})).rankings[0].id,'cp:p');
 assert.equal((await query({genre:'singer'})).total,1,'CP member categories do not leak CP-only events into personal rankings');
 const profile=await query({},'a');assert.equal(profile.subject_name,'A');assert.equal(profile.categories[0].n,1);assert.equal(profile.months[0].n,1);
 assert.equal(personal.matrix.filter(x=>x.id==='a').reduce((n,x)=>n+Number(x.n),0),1);
 assert.equal(personal.regions[0].n,3);
 const cpProfile=await query({kind:'cp'},'cp:p');assert.equal(cpProfile.detail_total,1);assert.equal(cpProfile.members.length,2);assert.equal(cpProfile.member_same_stage,1);assert.deepEqual(cpProfile.members.map(m=>m.n),[1,1]);assert.equal((await query({kind:'cp',genre:'singer'},'cp:p')).member_same_stage,1);
 await db.exec(`insert into events(id,title,date,location_region,status,attributes,participation_condition) values ('prior','Previous','2026-10-31','Bangkok','published','{"activity_category":"music","region":"泰国","artist_selections":["a"]}','ticket');`);
 const compared=await query({start:'2026-11-01',end:'2026-11-03'});assert.equal(compared.comparison.previous_total,1);assert.equal(compared.comparison.start,'2026-10-29');assert.equal(compared.rankings.find(r=>r.id==='a').previous_n,1);
 assert.equal((await query({participation:'ticket'})).total,1);
 assert.equal((await query({start:'2026-11-01',end:'2026-11-03'},'a')).subject_previous,1);
 await assert.rejects(query({start:'2026-12-01',end:'2026-01-01'}),/筛选范围/);
 }finally{await db.close();}
});
test('CSV quotes unsafe text and handles empty denominators',()=>{assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('a"b'),'"a""b"');assert.equal(percent(1,0),'—');});
