import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const source = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rich = text => ({ version: 1, blocks: [{ type: 'p', runs: [{ text, bold: true }] }] });
const ast = { description: rich('Formatted details'), note: rich('Formatted note') };

async function setup() {
  const db = new PGlite();
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE SCHEMA chob_private; CREATE SCHEMA auth;
   CREATE TABLE chob_private.migrations(version text PRIMARY KEY);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
   $$;
   CREATE TABLE public.users(id uuid PRIMARY KEY,role text,is_active boolean,email_verified boolean);
   CREATE TABLE public.artists(id uuid PRIMARY KEY);
   CREATE TABLE public.events(
    id uuid PRIMARY KEY,title text,date date,time time,location text,location_region text,
    company text,artist_ids uuid[],event_type_id uuid,participation_condition text,
    description text,ticket_url text,status text,created_by uuid,created_at timestamp,
    updated_at timestamp,attributes jsonb,field_states jsonb DEFAULT '{}'
   );
   CREATE TABLE public.tasks(
    id uuid PRIMARY KEY,event_id uuid,title text,task_type text,description text,
    start_date date,end_date date,start_time time,end_time time,action_url text,
    status text,created_by uuid,created_at timestamp,updated_at timestamp
   );
   CREATE FUNCTION public.chob_public_feed_legacy034() RETURNS jsonb
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT jsonb_build_object('records',coalesce(jsonb_agg(value),'[]'::jsonb),'artists','[]'::jsonb,'metadata','preserve')
    FROM (
     SELECT jsonb_build_object('id',e.id,'kind','event','note',e.attributes->>'note','description',e.description) value
     FROM public.events e WHERE status='published'
     UNION ALL
     SELECT jsonb_build_object('id',t.id,'kind','task','event_id',t.event_id,'description',t.description)
     FROM public.tasks t JOIN public.events e ON e.id=t.event_id
     WHERE t.status='published' AND e.status='published'
    ) visible;
   $$;
   REVOKE ALL ON FUNCTION public.chob_public_feed_legacy034() FROM PUBLIC,anon,authenticated;
   CREATE FUNCTION public.chob_public_feed() RETURNS jsonb
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE base jsonb; rows jsonb; BEGIN
    base:=public.chob_public_feed_legacy034();
    SELECT coalesce(jsonb_agg(r.value || jsonb_build_object(
     'field_states',e.field_states,'unrelated','preserve'
    )), '[]') INTO rows FROM jsonb_array_elements(base->'records') r(value)
    LEFT JOIN public.events e ON e.id=nullif(CASE WHEN r.value->>'kind'='task' THEN r.value->>'event_id' ELSE r.value->>'id' END,'')::uuid;
    RETURN jsonb_set(base,'{records}',rows);
   END $$;
   REVOKE ALL ON FUNCTION public.chob_public_feed() FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.chob_public_feed() TO service_role;
  `);
  return db;
}

test('rich-text feed projection retains OID, ACL, old text, visibility and task isolation on reruns', async () => {
  const db = await setup();
  try {
    const migration = await source('040_rich_text_details.sql');
    await db.query(`INSERT INTO public.events(id,description,status,attributes) VALUES
     ($1,'Old plain text','published','{"note":"Old note"}'),
     ($2,'Formatted details','published',$3),
     ($4,'Private details','draft',$3)`, [id(1), id(2), JSON.stringify({ rich_text: ast, note: 'Formatted note', unrelated: 'preserve' }), id(3)]);
    await db.query(`INSERT INTO public.tasks(id,event_id,status,description) VALUES($1,$2,'published','Task text')`, [id(4), id(2)]);
    await db.exec(`INSERT INTO chob_private.migrations(version) VALUES('040')`);
    const identity = async () => (await db.query(`SELECT oid,proacl::text acl,prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='public.chob_public_feed()'::regprocedure`)).rows[0];
    const before = await identity();
    await db.exec(migration);
    assert.deepEqual(await identity(), before);
    assert.equal((await db.query(`SELECT count(*)::int n FROM chob_private.migrations WHERE version='040_rich_text_details'`)).rows[0].n, 1);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`SELECT has_function_privilege($1,'public.chob_public_feed()','execute') allowed`, [role])).rows[0].allowed, false);
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(() => db.query('SELECT public.chob_public_feed()'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    const first = (await db.query('SELECT public.chob_public_feed() feed')).rows[0].feed;
    await db.exec('RESET ROLE');
    assert.equal(first.metadata, 'preserve');
    const rows = new Map(first.records.map(row => [row.id, row]));
    assert.equal(rows.has(id(3)), false);
    assert.equal(rows.get(id(1)).description, 'Old plain text');
    assert.equal(rows.get(id(1)).note, 'Old note');
    assert.equal(rows.get(id(1)).rich_text, null);
    assert.deepEqual(rows.get(id(2)).rich_text, ast);
    assert.equal(rows.get(id(2)).unrelated, 'preserve');
    assert.equal(rows.get(id(4)).description, 'Task text');
    assert.equal(rows.get(id(4)).rich_text, null);
    await db.exec(migration);
    assert.deepEqual(await identity(), before);
    assert.deepEqual((await db.query('SELECT public.chob_public_feed() feed')).rows[0].feed, first);
    assert.equal((await db.query(`SELECT count(*)::int n FROM chob_private.migrations WHERE version='040_rich_text_details'`)).rows[0].n, 1);
    const definition = (await db.query(`SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) definition`)).rows[0].definition;
    assert.equal(definition.split('chob-rich-text-details-v1').length - 1, 1);
    assert.deepEqual((await db.query('SELECT attributes->\'rich_text\' ast FROM public.events WHERE id=$1', [id(2)])).rows[0].ast, ast);
  } finally { await db.close(); }
});

test('unknown, ambiguous or changed feed definitions abort the complete migration', async () => {
  const db = await setup();
  try {
    const migration = await source('040_rich_text_details.sql');
    const definition = (await db.query(`SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) definition`)).rows[0].definition;
    for (const bad of [
      definition.replace('base:=public.chob_public_feed_legacy034();', "base:='{}'::jsonb;"),
      definition.replace("'field_states',e.field_states", "'field_states',e.field_states,'field_states',e.field_states"),
      definition.replace("'unrelated','preserve'", "'rich_text',NULL"),
      definition.replace("'unrelated','preserve'", "'unrelated','chob-rich-text-details-v1'"),
    ]) {
      await db.exec(bad);
      const before = (await db.query(`SELECT oid,proacl::text acl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid='public.chob_public_feed()'::regprocedure`)).rows[0];
      await assert.rejects(() => db.exec(migration), /040_rich_text_details:.*migration rolled back/);
      await db.exec('ROLLBACK');
      const after = (await db.query(`SELECT oid,proacl::text acl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid='public.chob_public_feed()'::regprocedure`)).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await db.query(`SELECT count(*)::int n FROM chob_private.migrations WHERE version='040_rich_text_details'`)).rows[0].n, 0);
    }
  } finally { await db.close(); }
});

test('the existing bundle save preserves rich-text attributes and legacy text edits remain observable', async () => {
  const db = await setup();
  try {
    // Exercise the actual save function without changing its existing validation.
    const sql = await source('004_event_form_import.sql');
    const saveDefinition = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.chob_save_event_bundle('), sql.indexOf('REVOKE ALL ON FUNCTION public.chob_save_event_bundle('));
    assert.ok(saveDefinition.includes("attributes=coalesce(attributes,'{}'::jsonb) || (payload->'attributes')"));
    await db.exec(saveDefinition);
    await db.query("INSERT INTO public.users VALUES($1,'admin',true,true)", [id(10)]);
    await db.query('INSERT INTO public.artists VALUES($1)', [id(11)]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(10)]);
    const payload = { id: id(12), title: 'Event', date: '2026-10-21', location: 'Hall', location_region: 'Bangkok',
      participation_condition: 'ticket', artist_ids: [id(11)], description: 'Formatted details', status: 'published',
      attributes: { region: 'thailand', picture_urls: [], note: 'Formatted note', rich_text: ast, unrelated: 'preserve' } };
    const save = async (event, version = null) => (await db.query('SELECT public.chob_save_event_bundle($1,\'[]\'::jsonb,$2) saved', [JSON.stringify(event), version])).rows[0].saved;
    const first = await save(payload);
    assert.deepEqual(first.attributes.rich_text, ast);
    const legacy = { ...payload, description: 'Updated plain details', attributes: { region: 'thailand', picture_urls: [], note: 'Updated plain note' } };
    const second = await save(legacy, first.updated_at);
    assert.equal(second.description, 'Updated plain details');
    assert.equal(second.attributes.note, 'Updated plain note');
    assert.deepEqual(second.attributes.rich_text, ast);
    assert.equal(second.attributes.unrelated, 'preserve');
    // Renderers must reject these stale ASTs when their extracted text differs
    // from description/note; the SQL layer deliberately preserves legacy saves.
    assert.notEqual(second.description, ast.description.blocks[0].runs[0].text);
    assert.notEqual(second.attributes.note, ast.note.blocks[0].runs[0].text);
    await assert.rejects(() => save(payload, first.updated_at), /已被修改/);
  } finally { await db.close(); }
});
