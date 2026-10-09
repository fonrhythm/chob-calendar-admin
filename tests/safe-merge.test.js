import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('merge only updates affected favorites, items and tags; tasks, sources and permissions survive',async()=>{
 const db=new PGlite();const admin='00000000-0000-4000-8000-000000000001',fan='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000009';
 try {
 const fixture=fs.readFileSync(new URL('./events.test.js',import.meta.url),'utf8');
 await db.exec(fixture.match(/await db\.exec\(`([\s\S]*?)`\)/)[1].replaceAll('${admin}',admin).replaceAll('${fan}',fan));
 const wechat=fs.readFileSync(new URL('./fixtures/automation-wechat-setup.txt',import.meta.url),'utf8');
 const extra=wechat.match(/await db\.exec\(`([\s\S]*?)`\);/)[1].replaceAll('${fan}',fan).replaceAll('${other}','00000000-0000-4000-8000-000000000009');
 await db.exec(extra);
 for(const name of ['004_event_form_import.sql','006_community.sql','007_task_categories.sql','009_activity_categories.sql','012_group_save_display.sql','013_artist_selection.sql','014_activity_labels.sql','015_scheduling_import_drafts.sql','016_event_updates_and_details.sql','017_event_bulk_management.sql','018_backend_access_approval.sql','019_editor_permissions.sql','020_fashion_week.sql','021_announcement_deletion.sql','022_artist_participation_corrections.sql','023_invitation_participation.sql'])await db.exec(fs.readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/025_activity_dates_display.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/030_event_trash.sql',import.meta.url),'utf8'));
 await db.exec("create function chob_private.is_wechat_session() returns boolean language sql stable as $$select coalesce(current_setting('test.wechat',true),'false')='true'$$; create table public.chob_submission_reviews(event_id uuid); insert into participation_conditions values(gen_random_uuid(),'ticket','购票'); insert into artists(id,name) values('00000000-0000-4000-8000-000000000010','A');");
 const sql=fs.readFileSync(new URL('../supabase/034_provenance_entities.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);

 const migration=fs.readFileSync(new URL('../supabase/036_safe_duplicate_merge.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 async function as(id){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
 const call=async(name,args=[])=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;
 await as(admin);
 const first=await call('chob_add_source',[{url:'https://example.org/first',source_type:'organizer',priority:1,raw_evidence:{text:'Official first'}}]);
 const second=await call('chob_add_source',[{url:'https://example.org/second',source_type:'organizer',priority:1,raw_evidence:{text:'Official second'}}]);
 const keep='00000000-0000-4000-8000-000000000040',drop='00000000-0000-4000-8000-000000000041';
 const payload={title:'Same show',date:'2026-10-08',location:'Hall',location_region:'Bangkok',artist_ids:['00000000-0000-4000-8000-000000000010'],participation_condition:'ticket',status:'published',attributes:{region:'泰国',picture_urls:[]}};
 await call('chob_save_event_architecture',[{...payload,id:keep},[],null,null,{source_id:first}]);
 const task={id:'00000000-0000-4000-8000-000000000050',title:'Registration',task_type:'registration',status:'draft',start_date:'2026-10-01',end_date:'2026-10-02'};
 await call('chob_save_event_architecture',[{...payload,id:drop},[task],null,null,{source_id:second}]);
 await db.exec('reset role');
 await db.query('insert into chob_personal(id,favorites,items,tags) values($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)',[fan,['supabase:'+drop],[],{['supabase:'+drop]:['saved']},other,[],['supabase:'+drop],{},admin,['unrelated'],[],{unrelated:['untouched']}]);
 await db.exec(`create table public.personal_update_audit(id uuid);
 create function public.audit_affected_personal() returns trigger language plpgsql as $$begin
 if not (('supabase:${drop}')=any(old.favorites) or ('supabase:${drop}')=any(old.items) or old.tags ? 'supabase:${drop}') then raise exception 'unrelated personal row updated';end if;
 insert into public.personal_update_audit values(old.id);return new;end$$;
 create trigger personal_audit before update on public.chob_personal for each row execute function public.audit_affected_personal();`);
 await as(fan);await assert.rejects(()=>call('chob_review_duplicates',[[keep,drop],keep,'merge']),/admin only/);
 await as(admin);await call('chob_review_duplicates',[[keep,drop],keep,'merge']);
 await db.exec('reset role');
 const rows=(await db.query('select * from chob_personal order by id')).rows;
 assert.deepEqual(rows.find(r=>r.id===fan).favorites,['supabase:'+keep]);
 assert.deepEqual(rows.find(r=>r.id===fan).tags,{['supabase:'+keep]:['saved']});
 assert.deepEqual(rows.find(r=>r.id===other).items,['supabase:'+keep]);
 assert.deepEqual(rows.find(r=>r.id===admin).favorites,['unrelated']);
 assert.deepEqual(rows.find(r=>r.id===admin).tags,{unrelated:['untouched']});
 assert.deepEqual((await db.query('select id from personal_update_audit order by id')).rows.map(r=>r.id),[fan,other]);
 assert.equal((await db.query('select event_id from tasks where id=$1',[task.id])).rows[0].event_id,keep);
 assert.equal((await db.query('select status from events where id=$1',[drop])).rows[0].status,'withdrawn');
 assert.equal((await db.query('select source_id from event_sources where event_id=$1',[keep])).rows.length,2);
 assert.equal((await db.query("select count(*)::int as n from chob_private.migrations where version='036'")).rows[0].n,1);
 }finally{await db.close();}
});