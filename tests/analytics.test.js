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
 create table artists(id text,name text,group_kind text,categories text[],deleted_at timestamp);
 create table cp_pairs(id text,cp_name text,deleted_at timestamp);
 create table events(id text,title text,date date,location_region text,status text,cancelled_at timestamp,attributes jsonb);
 insert into artists values('a','A',null,array['SINGER'],null),('b','B',null,array['SINGER'],null),('g','Group','group',array['GROUP'],null);
 insert into cp_pairs values('p','A+B',null);
 insert into events values
 ('1','CP','2026-11-01','Bangkok','published',null,'{"activity_category":"meet","region":"THAILAND","artist_selections":["cp:p"]}'),
 ('2','Group','2026-11-02','Bangkok','published',null,'{"activity_category":"music","region":"泰国","artist_selections":["g"]}'),
 ('3','Same stage','2026-11-03','Bangkok','published',null,'{"activity_category":"music","region":"泰国","artist_selections":["a","a","b"]}'),
 ('4','Cancelled','2026-11-04','Bangkok','published',null,'{"event_status":"cancelled","artist_selections":["a"]}'),
 ('5','Merged','2026-11-04','Bangkok','published',null,'{"merged_into":"3","artist_selections":["a"]}');`);
 await db.exec(fs.readFileSync(new URL('../supabase/analytics.sql',import.meta.url),'utf8'));
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
 await assert.rejects(query({start:'2026-12-01',end:'2026-01-01'}),/筛选范围/);
 }finally{await db.close();}
});
test('CSV quotes unsafe text and handles empty denominators',()=>{assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('a"b'),'"a""b"');assert.equal(percent(1,0),'—');});
