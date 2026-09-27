import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { readSheet } from 'read-excel-file/node'
import { fileURLToPath } from 'node:url'
import { parseCsv, rowsToArtists, validateImport, artistPayload, searchArtist } from '../src/lib/artists.js'
import { configurationProblem } from '../src/lib/configuration.js'

test('Browser configuration rejects privileged keys',()=>{
 const url='https://example.supabase.co',jwt=role=>'a.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.b'
 assert.equal(configurationProblem(url,'sb_publishable_test'),'')
 assert.equal(configurationProblem(url,jwt('anon')),'')
 assert.ok(configurationProblem(url,jwt('service_role')))
 assert.ok(configurationProblem(url,'sb_secret_test'))
 assert.ok(configurationProblem('', ''))
})

test('CSV keeps escaped quotes, commas, line breaks and multilingual fields', () => {
  const [a]=rowsToArtists(parseCsv('\uFEFFname,company,categories,aliases\r\n"A, B","Studio\r\nTwo",歌手;演员,"A ""B"""\r\n'))
  assert.equal(a.name,'A, B');assert.equal(a.company,'Studio\r\nTwo')
  assert.deepEqual(a.categories,['歌手','演员']);assert.deepEqual(a.aliases,['A "B"'])
  assert.throws(()=>parseCsv('name\n"open'),/引号/)
  assert.throws(()=>rowsToArtists([['name','艺人名称'],['a','b']]),/重复/)
})
test('Preview checks duplicates and missing names; search understands pinyin', () => {
  const rows=[' A ','Ａ','','Existing'].map(name=>artistPayload({name}))
  assert.deepEqual(validateImport(rows,[{name:'existing'}]),['','文件中名称重复','名称必填','数据库中已有同名艺人'])
  assert.ok(searchArtist({name:'张三',aliases:['小张']},'zhangsan'))
  assert.ok(searchArtist({name:'张三',aliases:['小张']},'小张'))
  assert.ok(!searchArtist({name:'张三'},'other'))
})
test('XLSX sample reads the same import columns and multiple artist categories', async()=>{
 const rows=await readSheet(fileURLToPath(new URL('./fixtures/artists.xlsx',import.meta.url)),1)
 const [artist]=rowsToArtists(rows)
 assert.equal(artist.name,'测试艺人')
 assert.deepEqual(artist.categories,['歌手','演员'])
})
test('SQL migration and real PostgreSQL permission/transaction behavior',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`)
    const schema=JSON.parse(await readFile(new URL('./fixtures/schema.json',import.meta.url),'utf8'))
    for(const t of schema.rls){
      const cols=schema.columns.filter(c=>c.table_name===t.table_name).map(c=>`"${c.column_name}" ${c.data_type==='ARRAY'?'uuid[]':c.data_type}${c.is_nullable==='NO'?' not null':''}${c.column_default?` default ${c.column_default}`:''}`)
      await db.exec(`create table public.${t.table_name}(${cols.join(',')});alter table public.${t.table_name} enable row level security;`)
    }
    for(const c of [...schema.constraints].sort((a,b)=>Number(a.definition.startsWith('FOREIGN'))-Number(b.definition.startsWith('FOREIGN'))))
      await db.exec(`alter table public.${c.table_name} add constraint ${c.conname} ${c.definition}`)
    const admin='00000000-0000-0000-0000-000000000001',fan='00000000-0000-0000-0000-000000000002'
    await db.query(`insert into auth.users values($1,'admin@example.invalid',now(),'{}')`,[admin])
    const migration=await readFile(new URL('../supabase/001_foundation.sql',import.meta.url),'utf8')
    // A populated business table must cause a complete rollback, not be overwritten.
    await db.exec("insert into public.artists(name) values('Existing')")
    await assert.rejects(db.exec(migration),/检测到业务资料/)
    await db.exec('rollback')
    assert.equal((await db.query("select name from public.artists")).rows[0].name,'Existing')
    await db.exec("delete from public.artists")
    await db.exec(migration);await db.exec(migration)
    await db.query(`insert into auth.users values($1,'fan@example.invalid',now(),'{"role":"admin"}')`,[fan])
    assert.equal((await db.query('select role from public.users where id=$1',[fan])).rows[0].role,'collaborator_fan')
    const bootstrap=(await readFile(new URL('../supabase/002_first_admin.sql',import.meta.url),'utf8')).replace('请替换为你的网站登录邮箱','admin@example.invalid')
    await db.exec(bootstrap);await db.exec(bootstrap)
    assert.equal((await db.query('select role from public.users where id=$1',[admin])).rows[0].role,'admin')
    async function as(id,role='authenticated'){await db.exec(`reset role;set role ${role}`);await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id||''])}
    async function save(name,id=null,version=null){return(await db.query('select public.chob_save_artist($1::jsonb,$2::uuid,$3::text) as record',[JSON.stringify(artistPayload({name,company:'Company',categories:'歌手;演员'})),id,version])).rows[0].record}
    await as(null,'anon');await assert.rejects(save('Denied'),/permission denied/)
    await as(fan);await assert.rejects(save('Denied'),/仅管理员/)
    await assert.rejects(db.exec("update public.users set role='admin'"),/permission denied/)
    assert.equal((await db.query('select * from public.users')).rows.length,1)
    assert.equal((await db.query('select * from public.operation_logs')).rows.length,0)
    await as(admin)
    const a=await save('Artist A'),b=await save('Artist B')
    await assert.rejects(save(' artist a '),/duplicate key/)
    const changed=await save('Artist A updated',a.id,a.updated_at)
    await assert.rejects(save('Stale',a.id,a.updated_at),/已被修改/)
    assert.deepEqual(changed.categories.sort(),['歌手','演员'].sort())
    await assert.rejects(db.query('select public.chob_import_artists($1::jsonb,$2)',[JSON.stringify([artistPayload({name:'Rollback'}),artistPayload({name:'Artist B'})]),'bad.csv']),/duplicate key/)
    assert.equal((await db.query("select * from public.artists where name='Rollback'")).rows.length,0)
    assert.equal((await db.query('select * from public.import_logs')).rows.length,0)
    await db.query('select public.chob_import_artists($1::jsonb,$2)',[JSON.stringify([artistPayload({name:'Imported'})]),'good.csv'])
    assert.equal((await db.query('select * from public.import_logs')).rows.length,1)
    const cp=(await db.query('select public.chob_save_cp($1) as record',[JSON.stringify({cp_name:'AB',artist_1_id:a.id,artist_2_id:b.id})])).rows[0].record
    await assert.rejects(db.query("select public.chob_set_deleted('artists',$1,true)",[a.id]),/关联记录/)
    await db.query("select public.chob_set_deleted('cp_pairs',$1,true)",[cp.id])
    await db.query("select public.chob_set_deleted('artists',$1,true)",[a.id])
    await assert.rejects(db.query("select public.chob_set_deleted('cp_pairs',$1,false)",[cp.id]),/先恢复/)
    await as(fan)
    assert.equal((await db.query('select * from public.artists where id=$1',[a.id])).rows.length,0)
    await assert.rejects(db.query("select public.chob_set_deleted('artists',$1,false)",[a.id]),/仅管理员/)
    await as(admin)
    await db.query("select public.chob_set_deleted('artists',$1,false)",[a.id])
    await db.query("select public.chob_set_deleted('cp_pairs',$1,false)",[cp.id])
    assert.ok((await db.query("select * from public.operation_logs where action='restore'")).rows.length>=2)
    await db.exec('reset role');await db.query('update public.users set is_active=false where id=$1',[admin])
    await as(admin);await assert.rejects(save('Inactive'),/仅管理员/)
    assert.equal((await db.query('select * from public.artists')).rows.length,0)
  }finally{await db.close()}
})
