import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('postponement preserves event identity, links and personal records and coalesces notices', async () => {
 const db = new PGlite();
 const admin='00000000-0000-4000-8000-000000000001',fan='00000000-0000-4000-8000-000000000002';
 try {
  const fixture=fs.readFileSync(new URL('./events.test.js',import.meta.url),'utf8');
  await db.exec(fixture.match(/await db\.exec\(`([\s\S]*?)`\)/)[1].replaceAll('${admin}',admin).replaceAll('${fan}',fan));
  const extra=fs.readFileSync(new URL('./fixtures/automation-wechat-setup.txt',import.meta.url),'utf8');
  await db.exec(extra.match(/await db\.exec\(`([\s\S]*?)`\);/)[1].replaceAll('${fan}',fan).replaceAll('${other}','00000000-0000-4000-8000-000000000009'));
  for(const file of ['004_event_form_import.sql','006_community.sql','007_task_categories.sql','009_activity_categories.sql',
   '012_group_save_display.sql','013_artist_selection.sql','014_activity_labels.sql','015_scheduling_import_drafts.sql',
   '016_event_updates_and_details.sql','017_event_bulk_management.sql','018_backend_access_approval.sql','019_editor_permissions.sql',
   '020_fashion_week.sql','021_announcement_deletion.sql','022_artist_participation_corrections.sql','023_invitation_participation.sql',
   '025_activity_dates_display.sql','030_event_trash.sql']) await db.exec(fs.readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8'));
  await db.exec("create function chob_private.is_wechat_session() returns boolean language sql stable as $$select false$$; create table public.chob_submission_reviews(event_id uuid); insert into participation_conditions values(gen_random_uuid(),'ticket','购票'); insert into artists(id,name) values('00000000-0000-4000-8000-000000000010','Artist');");
  await db.exec(fs.readFileSync(new URL('../supabase/034_provenance_entities.sql',import.meta.url),'utf8'));
  const migration=fs.readFileSync(new URL('../supabase/037_in_place_postponement.sql',import.meta.url),'utf8');
  await db.exec(migration); await db.exec(migration);
  const call=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;
  const as=async(id)=>{await db.exec('reset role;set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
  const eid='00000000-0000-4000-8000-000000000040';
  const task={id:'00000000-0000-4000-8000-000000000050',title:'Ticket',task_type:'registration',status:'draft',start_date:'2026-09-20',end_date:'2026-09-21'};
  const payload={id:eid,title:'Launch',date:'2026-09-30',time:'11:00',location:'Hall',location_region:'Bangkok',artist_ids:['00000000-0000-4000-8000-000000000010'],participation_condition:'ticket',status:'published',attributes:{region:'泰国',picture_urls:[],end_date:'2026-10-01'}};
  await as(admin);
  const sid=await call('chob_add_source',[{url:'https://example.org/announcement',source_type:'organizer',priority:1,raw_evidence:{text:'Notice'}}]);
  await call('chob_save_event_architecture',[payload,[task],null,null,{source_id:sid}]);
  await db.exec('reset role');
  await db.query('insert into chob_personal(id,favorites,items,tags) values($1,$2,$3,$4)',[fan,['supabase:'+eid],['supabase:'+eid],{['supabase:'+eid]:['saved']}]);
  await db.exec("create function public.reject_personal_update() returns trigger language plpgsql as $$begin raise exception 'personal records must remain untouched';end$$; create trigger personal_guard before update on chob_personal for each row execute function public.reject_personal_update();");
  await db.query("insert into chob_announcements(event_id,title,body,source_url,created_at) values($1,'Launch update','活动延期，新日期待公布','https://example.org/old','2026-09-28'),($1,'Launch update','因水灾延期到10月21日','https://example.org/new','2026-10-11'),($1,'Ticket notice','开票信息','https://example.org/ticket','2026-10-12')",[eid]);
  await as(fan); await assert.rejects(()=>call('chob_set_postponement',[eid,'2026-10-21',false,'']),/仅活动编辑/);
  await as(admin);
  assert.equal(await call('chob_set_postponement',[eid,null,false,'']),eid);
  assert.equal(await call('chob_set_postponement',[eid,'2026-10-21',false,'']),eid);
  assert.equal(await call('chob_set_postponement',[eid,'2026-10-21',true,'']),eid);
  const event=(await db.query('select to_jsonb(e) as data from events e where id=$1',[eid])).rows[0].data;
  assert.equal(event.date,'2026-10-21'); assert.equal(event.attributes.original_date,'2026-09-30');
  assert.equal(event.attributes.event_status,'active'); assert.equal(event.attributes.end_date,'2026-10-22');
  assert.equal(event.participation_condition,'ticket');
  assert.equal((await db.query('select count(*)::int n from events')).rows[0].n,1);
  const notices=(await db.query('select * from chob_announcements where event_id=$1',[eid])).rows;
  assert.equal(notices.filter(n=>n.published&&n.kind==='postponement').length,1);
  assert.equal(notices.find(n=>n.published&&n.kind==='postponement').source_url,'https://example.org/new');
  assert.match(notices.find(n=>n.published&&n.kind==='postponement').body,/2026-10-21/);
  assert.equal(notices.find(n=>n.title==='Ticket notice').published,true); assert.equal(notices.length,3);
  await as(fan); const personal=(await db.query('select * from chob_personal')).rows[0];
  assert.deepEqual(personal.items,['supabase:'+eid]); assert.deepEqual(personal.favorites,['supabase:'+eid]);
  assert.deepEqual(personal.tags,{['supabase:'+eid]:['saved']});
  await as(admin);
  assert.equal((await db.query('select event_id from tasks where id=$1',[task.id])).rows[0].event_id,eid);
  assert.equal((await db.query('select source_id from event_sources where event_id=$1',[eid])).rows[0].source_id,sid);
  const feed=await call('chob_public_feed',[]);
  assert.equal(feed.records.filter(r=>r.kind==='event').length,1);
  assert.equal(feed.records.find(r=>r.id===eid).date,'2026-10-21');
  await assert.rejects(()=>call('chob_set_postponement',[eid,'2026-10-22',false,'javascript:evil']),/有效网页/);
  assert.equal((await db.query('select date::text as date from events where id=$1',[eid])).rows[0].date,'2026-10-21');
  await call('chob_save_event_with_notice',[{...payload,date:event.date,attributes:event.attributes},[task],event.updated_at,{title:'Launch延期',body:'新日期已公布，延期至10月21日',source_url:''}]);
  assert.equal((await db.query("select count(*)::int n from chob_announcements where event_id=$1 and kind='postponement' and published",[eid])).rows[0].n,1);
  await call('chob_save_announcement',[{event_id:eid,title:'Launch更新',body:'活动延期日期已确认',source_url:'',published:true}]);
  await call('chob_publish_announcement',[{event_id:eid,title:'Launch延期',body:'更新后的延期日期',source_url:''}]);
  assert.equal((await db.query("select count(*)::int n from chob_announcements where event_id=$1 and kind='postponement' and published",[eid])).rows[0].n,1);
  assert.equal((await db.query("select source_url from chob_announcements where event_id=$1 and kind='postponement' and published",[eid])).rows[0].source_url,'https://example.org/new');
  assert.equal(await call('chob_postpone_event',[eid,'2026-10-22',false,'']),eid);
  assert.equal((await db.query('select count(*)::int n from events')).rows[0].n,1);
  await db.exec('reset role');
  await db.query("update events set attributes=attributes||'{\"event_status\":\"cancelled\"}'::jsonb where id=$1",[eid]);
  await as(admin); await assert.rejects(()=>call('chob_set_postponement',[eid,'2026-10-23',false,'']),/已取消/);
 } finally {await db.close();}
});
