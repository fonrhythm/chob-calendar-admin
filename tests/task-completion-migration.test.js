import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const source = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const utc = value => /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + 'Z';
const taskId = id(102), eventId = id(101), parentId = id(100);

async function setup() {
  const db = new PGlite();
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE SCHEMA auth; CREATE SCHEMA chob_private;
   CREATE TABLE chob_private.migrations(version text PRIMARY KEY);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE FUNCTION chob_private.is_wechat_session() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.wechat',true),'')='true' $$;
   CREATE TABLE public.users(id uuid PRIMARY KEY,role text,backend_approved boolean,is_active boolean,email_verified boolean);
   CREATE FUNCTION chob_private.can_edit_events() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN ('admin','collaborator_fan') AND backend_approved AND is_active AND email_verified)
   $$;
   CREATE TABLE public.artists(id uuid PRIMARY KEY);
   CREATE TABLE public.events(id uuid PRIMARY KEY,title text,date date,time time,location text,location_region text,
    company text,artist_ids uuid[],event_type_id uuid,participation_condition text,description text,ticket_url text,
    status text,created_by uuid,created_at timestamp,updated_at timestamp,attributes jsonb DEFAULT '{}',
    field_states jsonb DEFAULT '{}',cancelled_at timestamp,parent_event_id uuid);
   CREATE TABLE public.tasks(id uuid PRIMARY KEY,event_id uuid,title text,task_type text,description text,
    start_date date,end_date date,start_time time,end_time time,action_url text,status text,
    created_by uuid,created_at timestamp,updated_at timestamp);
   CREATE FUNCTION public.chob_public_feed() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    WITH event_rows AS (SELECT e.id,jsonb_build_object('id',e.id,'kind','event','date',e.date,'name',e.title,
     'note',coalesce(e.attributes->>'note',e.description,''),'participation_rules',e.description) record
     FROM public.events e WHERE e.status='published' AND NOT e.attributes ? 'admin_deleted_at'),
    records AS (SELECT record FROM event_rows UNION ALL
     SELECT e.record || jsonb_build_object('id',t.id,'kind','task','event_id',t.event_id,'task_type',t.task_type,
      'date',t.start_date,'end_date',t.end_date,'end_time',t.end_time,'description',t.description)
     FROM public.tasks t JOIN event_rows e ON e.id=t.event_id WHERE t.status='published')
    SELECT jsonb_build_object('records',coalesce((SELECT jsonb_agg(record) FROM records),'[]'::jsonb),'metadata','preserve');
   $$;
  `);
  const bundleSql = await source('007_task_categories.sql');
  await db.exec(bundleSql.slice(bundleSql.indexOf('CREATE OR REPLACE FUNCTION public.chob_save_event_bundle('), bundleSql.indexOf('REVOKE ALL ON FUNCTION public.chob_save_event_bundle(')));
  // Apply the real previous completion extension, then model the current 034 wrapper.
  await db.exec(await source('027_task_closure.sql'));
  await db.exec(`
   ALTER FUNCTION public.chob_public_feed() RENAME TO chob_public_feed_legacy034;
   REVOKE ALL ON FUNCTION public.chob_public_feed_legacy034() FROM PUBLIC,anon,authenticated;
   CREATE FUNCTION public.chob_public_feed() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
   DECLARE base jsonb; rows jsonb; BEGIN
    base:=public.chob_public_feed_legacy034();
    SELECT coalesce(jsonb_agg(r.value || jsonb_build_object(
     'field_states',e.field_states,'parent_event',(SELECT jsonb_build_object('id',p.id,'title',p.title)
      FROM public.events p WHERE p.id=e.parent_event_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(base->'records') q WHERE q->>'id'=p.id::text AND q->>'kind'='event')),
     'unrelated','preserve'
    )),'[]') INTO rows FROM jsonb_array_elements(base->'records') r(value)
    LEFT JOIN public.events e ON e.id=nullif(CASE WHEN r.value->>'kind'='task' THEN r.value->>'event_id' ELSE r.value->>'id' END,'')::uuid;
    RETURN jsonb_set(base,'{records}',rows);
   END $$;
   REVOKE ALL ON FUNCTION public.chob_public_feed() FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.chob_public_feed() TO service_role;
   REVOKE ALL ON FUNCTION public.chob_save_event_bundle(jsonb,jsonb,text) FROM PUBLIC,anon;
   GRANT EXECUTE ON FUNCTION public.chob_save_event_bundle(jsonb,jsonb,text) TO authenticated;
   INSERT INTO public.users VALUES
    ('${id(1)}','admin',true,true,true),('${id(2)}','collaborator_fan',true,true,true),
    ('${id(3)}','collaborator_fan',false,true,true),('${id(4)}','collaborator_fan',true,false,true),
    ('${id(5)}','collaborator_fan',true,true,false),('${id(6)}','other',true,true,true);
   INSERT INTO public.artists VALUES('${id(99)}');
   INSERT INTO public.events(id,title,date,time,status,updated_at,attributes) VALUES
    ('${parentId}','Series','2099-10-21','10:00','published','2026-01-01','{}'),
    ('${eventId}','Activity','2099-10-21','10:00','published','2026-01-01','{"note":"keep","rich_text":{"version":1}}');
   UPDATE public.events SET parent_event_id='${parentId}' WHERE id='${eventId}';
   INSERT INTO public.tasks(id,event_id,title,task_type,start_date,status,updated_at) VALUES
    ('${taskId}','${eventId}','Tickets','ticketing','2026-01-01','published','2026-01-01');
  `);
  await db.exec(await source('040_rich_text_details.sql'));
  return db;
}
const row = async (db, table, key) => (await db.query(`SELECT to_jsonb(x) value FROM public.${table} x WHERE id=$1`, [key])).rows[0].value;
const state = async (db, at) => (await db.query('SELECT chob_private.task_completion_state(t,e,$2) value FROM public.tasks t JOIN public.events e ON e.id=t.event_id WHERE t.id=$1', [taskId, at])).rows[0].value;
const as = async (db, user, wechat = false) => {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('test.wechat',$2,false)", [user ? id(user) : '', String(wechat)]);
  await db.exec('SET ROLE authenticated');
};
async function close(db, next, taskVersion, eventVersion) {
  return (await db.query('SELECT public.chob_set_task_completion($1,$2,$3,$4) value', [taskId, next, taskVersion && utc(taskVersion), eventVersion && utc(eventVersion)])).rows[0].value;
}

test('completion derives Bangkok task/event deadlines without mutating manual states or parent snapshots', async () => {
  const db = await setup();
  try {
    await db.exec(await source('041_task_completion.sql'));
    const set = async (attributes = {}, fields = {}) => {
      await db.query('UPDATE public.events SET date=$2,attributes=$3,field_states=$4,cancelled_at=$5 WHERE id=$1',
        [eventId, fields.date === undefined ? '2026-10-21' : fields.date, JSON.stringify(attributes), JSON.stringify(fields.field_states || {}), fields.cancelled_at || null]);
      await db.query('UPDATE public.tasks SET is_closed=$2,closure_reason=$3,end_date=$4,end_time=$5 WHERE id=$1',
        [taskId, fields.is_closed || false, fields.closure_reason || '', fields.end_date || null, fields.end_time || null]);
    };
    await set();
    assert.equal((await state(db, '2026-10-21T16:59:59Z')).is_closed, false);
    let value = await state(db, '2026-10-21T17:00:00Z');
    assert.equal(value.closure_reason, 'event_ended');
    assert.equal(Date.parse(value.auto_close_at), Date.parse('2026-10-21T17:00:00Z'));
    await set({ end_date: '2026-10-23' });
    assert.equal((await state(db, '2026-10-23T16:59:59Z')).is_closed, false);
    assert.equal((await state(db, '2026-10-23T17:00:00Z')).closure_reason, 'event_ended');
    for (const end_date of ['2026-02-30', 'invalid', '2026-10-01']) {
      await set({ end_date });
      assert.equal(Date.parse((await state(db, '2026-10-21T17:00:00Z')).auto_close_at), Date.parse('2026-10-21T17:00:00Z'));
    }
    await set({}, { end_date: '2026-10-20', end_time: '16:30' });
    assert.equal((await state(db, '2026-10-20T09:29:59Z')).is_closed, false);
    assert.equal((await state(db, '2026-10-20T09:30:00Z')).closure_reason, 'task_ended');
    await set({}, { end_date: '2026-10-20' });
    assert.equal((await state(db, '2026-10-20T17:00:00Z')).closure_reason, 'task_ended');
    await set({}, { end_date: '2026-10-25' });
    assert.equal((await state(db, '2026-10-21T17:00:00Z')).closure_reason, 'event_ended');
    for (const [attributes, fields] of [
      [{ event_status: 'postponed' }, {}], [{ event_status: 'postponed', postponed_to_date: 'invalid' }, {}],
      [{ field_states: { date: 'tba' } }, {}], [{}, { field_states: { date: 'tba' } }], [{}, { date: null }],
    ]) {
      await set(attributes, fields);
      value = await state(db, '2030-10-21T17:00:00Z');
      assert.equal(value.is_closed, false);
      assert.equal(value.auto_close_at, null);
    }
    await set({ event_status: 'postponed', postponed_to_date: '2026-12-01' });
    assert.equal((await state(db, '2026-11-01T00:00:00Z')).is_closed, false);
    assert.equal(Date.parse((await state(db, '2026-11-01T00:00:00Z')).auto_close_at), Date.parse('2026-12-01T17:00:00Z'));
    await set({ event_status: 'postponed' }, { end_date: '2026-10-20' });
    assert.equal((await state(db, '2026-10-20T17:00:00Z')).closure_reason, 'task_ended');
    await set({ event_status: 'cancelled' });
    assert.equal((await state(db, '2026-01-01T00:00:00Z')).closure_reason, 'event_cancelled');
    await set({}, { cancelled_at: '2026-01-01' });
    assert.equal((await state(db, '2026-01-01T00:00:00Z')).closure_reason, 'event_cancelled');
    await set({ event_status: 'cancelled' }, { is_closed: true, closure_reason: 'results_published' });
    assert.equal((await state(db, '2026-01-01T00:00:00Z')).closure_reason, 'results_published');
    await set({}, { is_closed: true });
    assert.equal((await state(db, '2026-01-01T00:00:00Z')).closure_reason, 'sold_out');
    await set({}, { date: '2000-01-01' });
    await db.exec('SET ROLE service_role');
    const feed = (await db.query('SELECT public.chob_public_feed() feed')).rows[0].feed;
    await db.exec('RESET ROLE');
    const task = feed.records.find(item => item.id === taskId);
    assert.equal(task.is_closed, true);
    assert.equal(task.closure_reason, 'event_ended');
    assert.deepEqual(task.parent_event, { id: parentId, title: 'Series' });
    assert.equal(feed.metadata, 'preserve');
    const stored = await row(db, 'tasks', taskId);
    assert.equal(stored.is_closed, false);
    assert.equal(stored.closure_reason, '');
    assert.equal(feed.records.find(item => item.id === eventId).auto_close_at, undefined);
  } finally { await db.close(); }
});

test('only approved Web editors can persist completion; two versions prevent stale bundles and permit reopening', async () => {
  const db = await setup();
  try {
    await db.exec(await source('041_task_completion.sql'));
    const originalTask = await row(db, 'tasks', taskId), originalEvent = await row(db, 'events', eventId);
    await db.exec('SET ROLE anon');
    await assert.rejects(() => close(db, 'sold_out', originalTask.updated_at, originalEvent.updated_at), /permission denied/);
    for (const [user, wechat] of [[3, false], [4, false], [5, false], [6, false], [null, false], [1, true], [2, true]]) {
      await as(db, user, wechat);
      await assert.rejects(() => close(db, 'sold_out', originalTask.updated_at, originalEvent.updated_at), /仅获批 Web/);
    }
    await as(db, 1);
    await assert.rejects(() => db.query('UPDATE public.tasks SET is_closed=true WHERE id=$1', [taskId]), /permission denied/);
    await assert.rejects(() => close(db, 'bad', originalTask.updated_at, originalEvent.updated_at), /状态无效/);
    await assert.rejects(() => close(db, 'sold_out', null, originalEvent.updated_at), /版本缺失/);
    await assert.rejects(() => close(db, 'sold_out', originalTask.updated_at, null), /版本缺失/);
    // The database stores UTC-naive timestamps. Comparison must not depend on
    // the editor connection's timezone when explicit UTC versions are passed.
    await db.exec("SET timezone='America/New_York'");
    const first = await close(db, 'sold_out', originalTask.updated_at, originalEvent.updated_at);
    assert.equal(first.task.is_closed, true);
    assert.equal(first.task.closure_reason, 'sold_out');
    assert.notEqual(first.task.updated_at, originalTask.updated_at);
    assert.notEqual(first.event_updated_at, originalEvent.updated_at);
    await assert.rejects(() => close(db, 'open', originalTask.updated_at, first.event_updated_at), /已被修改/);
    await assert.rejects(() => close(db, 'open', first.task.updated_at, originalEvent.updated_at), /已被修改/);
    await as(db, 2);
    const second = await close(db, 'results_published', first.task.updated_at, first.event_updated_at);
    assert.equal(second.task.closure_reason, 'results_published');
    const third = await close(db, 'open', second.task.updated_at, second.event_updated_at);
    assert.equal(third.task.is_closed, false);
    assert.equal(third.task.closure_reason, '');
    await db.exec('RESET ROLE');
    const payload = { id: eventId, title: 'Activity', date: '2099-10-21', location: 'Hall', location_region: 'Bangkok', participation_condition: 'ticket',
      artist_ids: [id(99)], status: 'published', description: 'Keep details', attributes: { region: 'thailand', picture_urls: [] } };
    const task = { ...third.task, start_date: '2026-01-01', is_closed: true, result_url: 'https://example.invalid/results' };
    delete task.closure_reason;
    const save = async (version, taskPayload) => (await db.query('SELECT public.chob_save_event_bundle($1,$2,$3) saved', [JSON.stringify(payload), JSON.stringify([taskPayload]), version])).rows[0].saved;
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
    await assert.rejects(() => save(originalEvent.updated_at, task), /已被修改/);
    let event = await save(third.event_updated_at, task);
    assert.equal((await row(db, 'tasks', taskId)).closure_reason, 'sold_out');
    event = await save(event.updated_at, { ...task, closure_reason: 'results_published' });
    assert.equal((await row(db, 'tasks', taskId)).closure_reason, 'results_published');
    event = await save(event.updated_at, task);
    assert.equal((await row(db, 'tasks', taskId)).closure_reason, 'results_published');
    event = await save(event.updated_at, { ...task, is_closed: false });
    assert.equal((await row(db, 'tasks', taskId)).is_closed, false);
    assert.equal((await row(db, 'tasks', taskId)).closure_reason, '');
    await assert.rejects(() => save(event.updated_at, { ...task, closure_reason: 'event_ended' }), /结束原因无效/);
    assert.equal((await row(db, 'tasks', taskId)).closure_reason, '');
    await assert.rejects(() => db.query("UPDATE public.tasks SET closure_reason='event_ended' WHERE id=$1", [taskId]), /chob_task_closure_reason_check/);
  } finally { await db.close(); }
});

test('completion migration is repeatable, retains old function identities/ACL and rolls unknown definitions back', async () => {
  const db = await setup();
  try {
    const migration = await source('041_task_completion.sql');
    const signatures = ['public.chob_public_feed()', 'public.chob_save_event_bundle(jsonb,jsonb,text)'];
    const identity = async () => (await db.query('SELECT oid,proacl::text acl,prosecdef,provolatile,proconfig FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [signatures])).rows;
    const before = await identity();
    const feedDefinition = (await db.query("SELECT pg_get_functiondef('public.chob_public_feed()'::regprocedure) definition")).rows[0].definition;
    const bad = feedDefinition.replace('base:=public.chob_public_feed_legacy034();', "base:='{}'::jsonb;");
    await db.exec(bad);
    await assert.rejects(() => db.exec(migration), /unknown public feed definition/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='tasks' AND column_name='closure_reason'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT to_regprocedure('public.chob_set_task_completion(uuid,text,timestamptz,timestamptz)') found")).rows[0].found, null);
    assert.equal((await db.query("SELECT count(*)::int n FROM chob_private.migrations WHERE version='041_task_completion'")).rows[0].n, 0);
    await db.exec(feedDefinition);
    const saveDefinition = (await db.query("SELECT pg_get_functiondef('public.chob_save_event_bundle(jsonb,jsonb,text)'::regprocedure) definition")).rows[0].definition;
    await db.exec(saveDefinition.replace('UPDATE public.tasks SET is_closed=', 'UPDATE public.tasks SET is_closed ='));
    await assert.rejects(() => db.exec(migration), /unknown bundle save definition/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='tasks' AND column_name='closure_reason'")).rows[0].n, 0);
    await db.exec(saveDefinition);
    await db.exec("INSERT INTO chob_private.migrations VALUES('041')");
    await db.exec(migration);
    assert.deepEqual(await identity(), before);
    await db.exec(migration);
    assert.deepEqual(await identity(), before);
    assert.equal((await db.query("SELECT count(*)::int n FROM chob_private.migrations WHERE version='041_task_completion'")).rows[0].n, 1);
    for (const [role, allowed] of [['anon', false], ['authenticated', true]]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.chob_set_task_completion(uuid,text,timestamptz,timestamptz)','execute') allowed", [role])).rows[0].allowed, allowed);
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.chob_public_feed()','execute') allowed", [role])).rows[0].allowed, false);
      assert.equal((await db.query("SELECT has_function_privilege($1,'chob_private.task_completion_state(public.tasks,public.events,timestamptz)','execute') allowed", [role])).rows[0].allowed, false);
    }
    for (const signature of signatures) {
      const definition = (await db.query('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
      const marker = signature.includes('public_feed') ? 'chob-task-completion-feed-v1' : 'chob-task-completion-save-v1';
      assert.equal(definition.split(marker).length - 1, 1);
    }
  } finally { await db.close(); }
});
