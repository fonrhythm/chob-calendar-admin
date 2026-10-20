import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('039 separates IDOL and musical GROUP, migrates once, and preserves group protections', async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const admin = id(1), fan = id(2);
  const source = file => readFile(new URL('../supabase/' + file, import.meta.url), 'utf8');
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;`);
    const schema = JSON.parse(await readFile(new URL('./fixtures/schema.json', import.meta.url), 'utf8'));
    for (const table of schema.rls) {
      const columns = schema.columns.filter(c => c.table_name === table.table_name).map(c =>
        `"${c.column_name}" ${c.data_type === 'ARRAY' ? 'uuid[]' : c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}${c.column_default ? ' default ' + c.column_default : ''}`);
      await db.exec(`create table public.${table.table_name}(${columns.join(',')});alter table public.${table.table_name} enable row level security;`);
    }
    for (const constraint of [...schema.constraints].sort((a, b) => Number(a.definition.startsWith('FOREIGN')) - Number(b.definition.startsWith('FOREIGN')))) {
      await db.exec(`alter table public.${constraint.table_name} add constraint ${constraint.conname} ${constraint.definition}`);
    }
    await db.query("insert into auth.users values($1,'admin@example.invalid',now(),'{}')", [admin]);
    await db.exec(await source('001_foundation.sql'));
    await db.exec((await source('002_first_admin.sql')).replace('请替换为你的网站登录邮箱', 'admin@example.invalid'));
    await db.query("insert into auth.users values($1,'fan@example.invalid',now(),'{}')", [fan]);
    for (const file of ['005_groups.sql', '008_artist_names.sql', '010_independent_groups.sql', '012_group_save_display.sql']) await db.exec(await source(file));
    await db.exec("alter table public.events add column attributes jsonb not null default '{}';");
    await db.exec(`create function public.chob_public_feed_legacy034() returns jsonb language sql stable security definer set search_path='' as $$
      with published as (select e.*,coalesce(e.attributes,'{}'::jsonb) attrs from public.events e)
      select jsonb_build_object('records',coalesce(jsonb_agg(jsonb_build_object('id',e.id,
      'category',coalesce(e.attrs->>'category',CASE e.attrs->>'artist_type' WHEN 'BL演员' THEN 'bl' WHEN 'GL演员' THEN 'gl' WHEN '歌手' THEN 'singer' WHEN '乐队' THEN 'band' WHEN '组合' THEN 'group' WHEN '演员' THEN 'actor' ELSE 'other' END))),'[]'::jsonb)) from published e;
      $$;
      create function public.chob_public_feed() returns jsonb language plpgsql stable security definer set search_path='' as $$
      begin return public.chob_public_feed_legacy034()||jsonb_build_object('wrapped','preserve');end $$;
      revoke all on function public.chob_public_feed(),public.chob_public_feed_legacy034() from public,anon,authenticated;
      grant execute on function public.chob_public_feed() to service_role;`);
    const feedDefinitions = async () => (await db.query("select oid::text,proacl::text from pg_proc where oid in ('public.chob_public_feed()'::regprocedure,'public.chob_public_feed_legacy034()'::regprocedure) order by oid")).rows;
    const feedPermissionsBefore = await feedDefinitions();
    const seedArtist = (n, name, categories, kind = null, members = [], legacyType = categories.join(' / '), deleted = false) =>
      db.query('insert into public.artists(id,name,base_name,categories,type,group_kind,group_member_ids,updated_at,deleted_at) values($1,$2::text,$2::text,$3,$4,$5,$6,now(),case when $7 then now() else null end)',
        [id(n), name, categories, legacyType, kind, members.map(id), deleted]);
    await seedArtist(102, 'Solo', ['gOuP', 'ACTOR']);
    await seedArtist(101, 'Idol Team', ['GROUP', 'SINGER'], 'group', [102]);
    await seedArtist(103, 'Music Duo', ['ENSEMBLE', 'SINGER'], 'group', [102]);
    await seedArtist(104, 'Band', ['BAND'], 'band');
    await seedArtist(105, 'Unclassified Team', ['ACTOR'], 'group');
    await seedArtist(106, 'Deleted Idol', ['group'], 'group', [], 'group', true);
    await seedArtist(107, 'Legacy Type', [], null, [], 'GROUP / ACTOR');
    await seedArtist(110, 'Empty Category Team', [], 'group');
    await db.query('insert into public.cp_pairs(id,cp_name,artist_1_id,artist_2_id) values($1,$2,$3,$4)', [id(301), 'Solo Pair', id(102), id(107)]);
    const seedEvent = (n, artists, attributes) => db.query(
      'insert into public.events(id,title,artist_ids,created_by,attributes,updated_at) values($1,$2,$3,$4,$5,now())',
      [id(n), 'Event ' + n, artists.map(id), admin, JSON.stringify(attributes)]);
    await seedEvent(201, [101], { artist_types: ['组合', '歌手'], artist_type: '组合', category: 'group', note: 'preserve' });
    await seedEvent(202, [103], { artist_types: ['组合'], artist_type: '组合', category: 'ensemble' });
    await seedEvent(203, [102], { artist_types: ['组合'] });
    await seedEvent(204, [105], { artist_types: ['组合'] });
    await seedEvent(205, [], { artist_types: ['GROUP', '演员'], category: 'group' });
    await seedEvent(206, [], { artist_types: ['组合'], artist_type: '组合', note: 'ambiguous legacy label' });
    await seedEvent(207, [102], { artist_types: ['组合'], artist_selections: [id(101)] });
    await db.exec("insert into chob_private.migrations(version) values('038')");
    const migration = await source('039_idol_group_categories.sql');
    await db.exec(migration);
    assert.deepEqual(await feedDefinitions(), feedPermissionsBefore);
    const artist = async n => (await db.query('select to_jsonb(a.*) artist from public.artists a where id=$1', [id(n)])).rows[0].artist;
    const attrs = async n => (await db.query('select attributes from public.events where id=$1', [id(n)])).rows[0].attributes;
    const types = async (artists, attributes = {}) => (await db.query(
      'select chob_private.event_artist_types($1,$2) as types', [artists.map(id), JSON.stringify(attributes)])).rows[0].types;
    assert.deepEqual(new Set((await artist(101)).categories), new Set(['IDOL', 'SINGER']));
    assert.equal((await artist(101)).type, 'IDOL / SINGER');
    assert.equal((await artist(101)).group_kind, 'group');
    assert.deepEqual((await artist(101)).group_member_ids, [id(102)]);
    assert.deepEqual(new Set((await artist(102)).categories), new Set(['IDOL', 'ACTOR']));
    assert.deepEqual(new Set((await artist(103)).categories), new Set(['GROUP', 'SINGER']));
    assert.deepEqual((await artist(104)).categories, ['BAND']);
    assert.deepEqual((await artist(106)).categories, ['IDOL']);
    assert.ok((await artist(106)).deleted_at);
    assert.ok((await artist(107)).categories.includes('IDOL'));
    assert.equal((await attrs(201)).category, 'idol');
    assert.equal((await attrs(201)).artist_type, '男女团');
    assert.equal((await attrs(201)).note, 'preserve');
    assert.ok((await attrs(201)).artist_types.includes('男女团'));
    assert.ok(!(await attrs(201)).artist_types.includes('组合'));
    assert.equal((await attrs(202)).category, 'group');
    assert.equal((await attrs(202)).artist_type, '组合');
    assert.deepEqual(new Set((await attrs(202)).artist_types), new Set(['组合', '歌手', '演员']));
    assert.ok(!(await attrs(203)).artist_types.includes('组合'));
    assert.deepEqual((await attrs(204)).artist_types, ['演员']);
    assert.equal((await attrs(205)).category, 'idol');
    assert.deepEqual(new Set((await attrs(205)).artist_types), new Set(['男女团', '演员']));
    assert.deepEqual((await attrs(206)).artist_types, ['组合']);
    assert.equal((await attrs(206)).note, 'ambiguous legacy label');
    assert.ok((await attrs(207)).artist_types.includes('男女团'));
    assert.ok(!(await types([101], { artist_types: ['GROUP', '组合'] })).includes('组合'));
    assert.ok(!(await types([103], { artist_types: ['IDOL', '男女团'] })).includes('男女团'));
    assert.deepEqual(await types([105]), ['演员']);
    assert.deepEqual(await types([104]), ['乐队']);
    assert.ok(!(await types([103, 102])).includes('男女团'));
    assert.ok((await types([103, 102])).includes('组合'));
    assert.ok(!(await types([103, 102], { artist_selections: [id(102)] })).includes('组合'));
    assert.ok((await types([103, 102], { artist_selections: [id(102)] })).includes('男女团'));
    assert.deepEqual(await types([102, 107], { artist_selections: ['cp:' + id(301)] }), ['演员']);
    assert.deepEqual(await types([110], { artist_types: ['组合', 'IDOL', '乐队'] }), ['乐队']);

    const backupsBefore = (await db.query('select entity,record_id,old_value from chob_private.idol_group_category_backup order by entity,record_id')).rows;
    assert.equal(backupsBefore.filter(r => r.entity === 'artists').length, 5);
    assert.deepEqual(backupsBefore.find(r => r.record_id === id(101)).old_value.categories, ['GROUP', 'SINGER']);
    // A new musical GROUP and its metadata survive every subsequent execution.
    await seedArtist(108, 'New Music Group', ['GROUP'], 'group');
    await seedEvent(208, [108], { artist_types: ['组合'], category: 'group' });
    for (const [n, type] of [[209, '男女团'], [210, 'IDOL'], [211, 'idol'], [212, 'GROUP'], [213, 'group']]) await seedEvent(n, [], { artist_type: type });
    await db.exec(migration);
    assert.deepEqual(await feedDefinitions(), feedPermissionsBefore);
    const feed = (await db.query('select public.chob_public_feed() feed')).rows[0].feed;
    assert.equal(feed.wrapped, 'preserve');
    for (const [n, expected] of [[209, 'idol'], [210, 'idol'], [211, 'idol'], [212, 'group'], [213, 'group']]) assert.equal(feed.records.find(r => r.id === id(n)).category, expected);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await db.query(
      `select has_function_privilege('${role}','public.chob_public_feed()','execute') allowed`)).rows[0].allowed, role === 'service_role');
    await db.exec('set role anon');
    await assert.rejects(() => db.query('select public.chob_public_feed()'), /permission denied/);
    await db.exec('reset role');
    assert.deepEqual((await artist(108)).categories, ['GROUP']);
    assert.equal((await attrs(208)).category, 'group');
    assert.deepEqual((await db.query('select entity,record_id,old_value from chob_private.idol_group_category_backup order by entity,record_id')).rows, backupsBefore);
    assert.equal((await db.query("select count(*)::int n from chob_private.migrations where version='039'")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from chob_private.migrations where version='038'")).rows[0].n, 1);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}','chob_private.idol_group_category_backup','select') allowed`)).rows[0].allowed, false);
      assert.equal((await db.query(`select has_function_privilege('${role}','chob_private.event_artist_types(uuid[],jsonb)','execute') allowed`)).rows[0].allowed, false);
      for (const name of ['chob_save_group', 'chob_save_group_v2']) assert.equal((await db.query(
        `select has_function_privilege('${role}','public.${name}(jsonb,uuid,text)','execute') allowed`)).rows[0].allowed, role === 'authenticated');
    }
    const as = async user => {
      await db.exec('reset role;set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    };
    const save = async (payload, record = null, version = null, name = 'chob_save_group_v2') => (await db.query(
      `select public.${name}($1,$2,$3) saved`, [JSON.stringify(payload), record, version])).rows[0].saved;
    await as(fan);
    await assert.rejects(() => save({ name: 'Unauthorized', type: 'IDOL', members: [] }), /仅管理员/);
    await as(admin);
    const oldIdol = await artist(101);
    const preserved = await save({ name: 'Idol Team', type: '组合', members: [id(102)] }, oldIdol.id, oldIdol.updated_at, 'chob_save_group');
    assert.ok(preserved.categories.includes('IDOL'));
    assert.ok(!preserved.categories.includes('GROUP'));
    await assert.rejects(() => save({ name: 'Idol Team', type: '组合', members: [] }, oldIdol.id, oldIdol.updated_at), /资料已被修改/);
    for (const [type, expected, kind] of [['男女团', 'IDOL', 'group'], ['IDOL', 'IDOL', 'group'], ['GROUP', 'GROUP', 'group'], ['组合', 'GROUP', 'group'], ['BAND', 'BAND', 'band'], ['乐队', 'BAND', 'band']]) {
      const saved = await save({ name: 'New ' + type, type, members: [] });
      assert.deepEqual(saved.categories, [expected]);
      assert.equal(saved.group_kind, kind);
    }
    const changed = await save({ name: 'Idol Team', type: '组合', artist_category: 'GROUP', members: [id(102)] }, preserved.id, preserved.updated_at);
    assert.ok(changed.categories.includes('GROUP'));
    assert.ok(!changed.categories.includes('IDOL'));
    assert.ok(changed.categories.includes('SINGER'));
    await assert.rejects(() => save({ name: 'Invalid category', type: '组合', artist_category: 'ACTOR', members: [] }), /艺人类别须/);
    await assert.rejects(() => save({ name: 'Invalid band', type: '乐队', artist_category: 'IDOL', members: [] }), /不一致/);
    await assert.rejects(() => save({ name: 'Nested group', type: 'IDOL', members: [id(103)] }), /个人艺人/);
    await assert.rejects(() => save({ name: 'Idol Team', type: 'IDOL', members: [changed.id] }, changed.id, changed.updated_at), /自己/);
    await db.exec('reset role');
    await db.exec("create or replace function public.chob_public_feed_legacy034() returns jsonb language sql stable security definer set search_path='' as $$select '{}'::jsonb$$;");
    await assert.rejects(() => db.exec(migration), /公开feed版本不符/);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
