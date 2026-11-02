import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('image storage accepts only editor-owned inserts; unapproved and WeChat sessions cannot upload or overwrite',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role authenticated;create schema storage;create schema auth;create schema chob_private;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 create function auth.uid() returns uuid language sql as $$select current_setting('test.uid')::uuid$$;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 create function chob_private.can_edit_events() returns boolean language sql as $$select current_setting('test.editor')='true' and current_setting('test.wechat')='false'$$;
 grant usage on schema storage,auth,chob_private to authenticated;grant insert,select on storage.objects to authenticated;`);
 const sql=fs.readFileSync(new URL('../supabase/event-images-policy.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 await db.exec(`set role authenticated;set test.uid='00000000-0000-4000-8000-000000000001';set test.editor='true';set test.wechat='false';`);
 await db.exec(`insert into storage.objects values('chob-event-images','00000000-0000-4000-8000-000000000001/image.jpg')`);
 await assert.rejects(db.exec(`insert into storage.objects values('chob-event-images','other/image.jpg')`),/row-level security/);
 await db.exec("set test.editor='false'");await assert.rejects(db.exec(`insert into storage.objects values('chob-event-images','00000000-0000-4000-8000-000000000001/other.jpg')`),/row-level security/);
 await db.exec("set test.editor='true';set test.wechat='true'");await assert.rejects(db.exec(`insert into storage.objects values('chob-event-images','00000000-0000-4000-8000-000000000001/other.jpg')`),/row-level security/);
 await assert.rejects(db.exec('delete from storage.objects'),/permission denied/);
 }finally{await db.close();}
});
