import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { groupRows, isGroup } from '../src/lib/groups.js';
test('group/band 与中文组合类别都能显示；保留艺人ID供活动选择', () => {
  const rows = [
    { id: 'a', name: 'One', categories: ['group'], group_kind: 'group' },
    { id: 'b', name: 'Band', categories: ['band'], group_kind: 'band', group_member_ids: ['c'] },
    { id: 'c', name: 'Solo', categories: ['歌手'] },
  ];
  assert.deepEqual(
    groupRows(rows).map((g) => g.id),
    ['a', 'b'],
  );
  assert.equal(groupRows(rows)[1].type, '乐队');
  assert.deepEqual(groupRows(rows)[1].members, ['c']);
  assert.equal(isGroup({ type: 'group / singer' }), false);
  assert.equal(isGroup({ categories: ['组合'] }), false);
});
test('组合保存、编辑、回收站、成员保护及权限', async () => {
  const db = new PGlite(),
    admin = '00000000-0000-0000-0000-000000000001',
    fan = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
    const schema = JSON.parse(
      await readFile(
        new URL('./fixtures/schema.json', import.meta.url),
        'utf8',
      ),
    );
    for (const t of schema.rls) {
      const cols = schema.columns
        .filter((c) => c.table_name === t.table_name)
        .map(
          (c) =>
            `"${c.column_name}" ${c.data_type === 'ARRAY' ? 'uuid[]' : c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}${c.column_default ? ` default ${c.column_default}` : ''}`,
        );
      await db.exec(
        `create table public.${t.table_name}(${cols.join(',')});alter table public.${t.table_name} enable row level security;`,
      );
    }
    for (const c of [...schema.constraints].sort(
      (a, b) =>
        Number(a.definition.startsWith('FOREIGN')) -
        Number(b.definition.startsWith('FOREIGN')),
    ))
      await db.exec(
        `alter table public.${c.table_name} add constraint ${c.conname} ${c.definition}`,
      );
    await db.query(
      "insert into auth.users values($1,'admin@example.invalid',now(),'{}')",
      [admin],
    );
    await db.exec(
      await readFile(
        new URL('../supabase/001_foundation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.exec(
      (
        await readFile(
          new URL('../supabase/002_first_admin.sql', import.meta.url),
          'utf8',
        )
      ).replace('请替换为你的网站登录邮箱', 'admin@example.invalid'),
    );
    await db.query(
      "insert into auth.users values($1,'fan@example.invalid',now(),'{}')",
      [fan],
    );
    const migration = await readFile(
      new URL('../supabase/005_groups.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(await readFile(new URL('../supabase/010_independent_groups.sql',import.meta.url),'utf8'));
    async function as(id, role = 'authenticated') {
      await db.exec(`reset role;set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id || '',
      ]);
    }
    async function save(payload, id = null, version = null) {
      return (
        await db.query('select public.chob_save_group($1,$2,$3) as row', [
          JSON.stringify(payload),
          id,
          version,
        ])
      ).rows[0].row;
    }
    await as(admin);
    const member = (
      await db.query('select public.chob_save_artist($1) as row', [
        JSON.stringify({ name: 'Member', categories: ['歌手'], aliases: [] }),
      ])
    ).rows[0].row;
    const payload = {
      name: 'Tilly Birds',
      type: '乐队',
      members: [member.id],
      company: 'Company',
    };
    const group = await save(payload);
    assert.equal(group.group_kind, 'band');
    assert.deepEqual(group.categories, ['band']);
    assert.deepEqual(group.group_member_ids, [member.id]);
    assert.ok(
      (await db.query('select * from artists where id=$1', [group.id])).rows
        .length,
    );
    await assert.rejects(save(payload), /duplicate key/);
    await assert.rejects(
      save(
        { ...payload, name: 'Self', members: [group.id] },
        group.id,
        group.updated_at,
      ),
      /自己/,
    );
    await assert.rejects(
      save({ ...payload, name: 'Nested', members: [group.id] }),
      /个人艺人/,
    );
    await assert.rejects(
      db.query("select public.chob_set_deleted('artists',$1,true)", [
        member.id,
      ]),
      /仍是组合/,
    );
    const updated = await save(
      { ...payload, name: 'Renamed' },
      group.id,
      group.updated_at,
    );
    await assert.rejects(save(payload, group.id, group.updated_at), /已被修改/);
    await db.query("select public.chob_set_group_deleted($1,true)", [
      group.id,
    ]);
    await db.query("select public.chob_set_deleted('artists',$1,true)", [
      member.id,
    ]);
    await assert.rejects(
      db.query("select public.chob_set_group_deleted($1,false)", [
        group.id,
      ]),
      /先恢复/,
    );
    await db.query("select public.chob_set_deleted('artists',$1,false)", [
      member.id,
    ]);
    await db.query("select public.chob_set_group_deleted($1,false)", [
      group.id,
    ]);
    const restored = (
      await db.query('select to_jsonb(a) as row from artists a where id=$1', [
        group.id,
      ])
    ).rows[0].row;
    await save({ ...payload, members: [] }, group.id, restored.updated_at);
    await db.query("select public.chob_set_deleted('artists',$1,true)", [
      member.id,
    ]);

    const person1=(await db.query('select chob_save_artist($1) as row',[JSON.stringify({name:'Tutor example',categories:['group'],aliases:[]})])).rows[0].row;
    const person2=(await db.query('select chob_save_artist($1) as row',[JSON.stringify({name:'Partner example',categories:['actor'],aliases:[]})])).rows[0].row;
    const cp=(await db.query('select chob_save_cp($1) as row',[JSON.stringify({cp_name:'Example CP',artist_1_id:person1.id,artist_2_id:person2.id})])).rows[0].row;
    const independent=await save({name:'Independent group',type:'组合',members:[person1.id,person2.id]});
    await db.query("select chob_set_deleted('cp_pairs',$1,true)",[cp.id]);
    assert.deepEqual((await db.query('select group_member_ids from artists where id=$1',[independent.id])).rows[0].group_member_ids,[person1.id,person2.id].sort());
    await db.query("select chob_set_deleted('cp_pairs',$1,false)",[cp.id]);
    await db.query('select chob_set_group_deleted($1,true)',[independent.id]);
    assert.equal((await db.query('select deleted_at from cp_pairs where id=$1',[cp.id])).rows[0].deleted_at,null);
    assert.equal((await db.query('select deleted_at from artists where id=$1',[person1.id])).rows[0].deleted_at,null);
    await db.query('select chob_set_group_deleted($1,false)',[independent.id]);
    await db.exec('reset role');
    const cleanup=await readFile(new URL('../supabase/011_reset_legacy_groups.sql',import.meta.url),'utf8');
    await db.exec(cleanup);
    assert.equal((await db.query('select deleted_at from artists where id=$1',[person1.id])).rows[0].deleted_at,null);
    assert.deepEqual((await db.query('select categories from artists where id=$1',[person1.id])).rows[0].categories,[]);
    assert.equal((await db.query('select deleted_at from cp_pairs where id=$1',[cp.id])).rows[0].deleted_at,null);
    assert.ok((await db.query('select deleted_at from artists where id=$1',[independent.id])).rows[0].deleted_at);
    await as(admin);
    const fresh=await save({name:'New after reset',type:'乐队',members:[person1.id]});
    await db.exec('reset role');
    await db.exec(cleanup);
    assert.equal((await db.query('select deleted_at from artists where id=$1',[fresh.id])).rows[0].deleted_at,null);
    await as(fan);
    await assert.rejects(
      save({ ...payload, name: 'Denied', members: [] }),
      /仅管理员/,
    );
    assert.equal(
      (await db.query('select * from artists where id=$1', [member.id])).rows
        .length,
      0,
    );
    await as(null, 'anon');
    await assert.rejects(
      save({ ...payload, name: 'Denied', members: [] }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
