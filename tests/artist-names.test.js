import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('homonyms use company suffixes and same-company homonyms require distinct full names', async () => {
  const db = new PGlite(),
    admin = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;`,
    );
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
    await db.exec(
      await readFile(
        new URL('../supabase/001_foundation.sql', import.meta.url),
        'utf8',
      ),
    );
    const names = await readFile(
      new URL('../supabase/008_artist_names.sql', import.meta.url),
      'utf8',
    );
    await db.exec(names);
    await db.exec(names);
    await db.query(
      "insert into auth.users values($1,'admin@example.invalid',now(),'{}')",
      [admin],
    );
    await db.query("update users set role='admin' where id=$1", [admin]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    async function save(company, full_name = '', id = null, stamp = null) {
      return (
        await db.query('select chob_save_artist($1,$2,$3) as r', [
          {
            name: 'Alex',
            company,
            full_name,
            categories: ['演员'],
            aliases: [],
          },
          id,
          stamp,
        ])
      ).rows[0].r;
    }
    const a = await save('A'),
      b = await save('B');
    assert.equal(b.name, 'Alex (B)');
    let list = (
      await db.query(
        'select to_jsonb(artists) as r from artists order by company',
      )
    ).rows.map((row) => row.r);
    assert.equal(list[0].name, 'Alex (A)');
    await assert.rejects(save('A', 'Alexander Two'), /补全不同的全名/);
    const updated = await save('A', 'Alexander One', a.id, list[0].updated_at);
    const second = await save('A', 'Alexander Two');
    assert.equal(second.name, 'Alexander Two (A)');
    assert.equal(
      (await db.query('select name from artists where id=$1', [a.id])).rows[0]
        .name,
      'Alexander One (A)',
    );
    await assert.rejects(save('A', 'Alexander One'), /补全不同的全名/);
    await assert.rejects(
      db.query('select chob_save_artist_original($1,null,null)', [
        { name: 'Bypass', categories: [], aliases: [] },
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
