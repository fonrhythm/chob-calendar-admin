import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  compareTasks,
  taskActiveOn,
  validateTasks,
  bangkokDate,
} from '../src/lib/tasks.js';

test('事项日期包含首尾；曼谷日期不受电脑时区影响；分类优先于截止日期', () => {
  assert.equal(bangkokDate(new Date('2026-10-01T17:01:00Z')), '2026-10-02');
  const t = {
    status: 'published',
    start_date: '2026-10-01',
    end_date: '2026-10-25',
  };
  assert.equal(taskActiveOn(t, '2026-10-01'), true);
  assert.equal(taskActiveOn(t, '2026-10-25'), true);
  assert.equal(taskActiveOn(t, '2026-10-26'), false);
  assert.equal(taskActiveOn({ ...t, status: 'draft' }, '2026-10-01'), false);
  const ordered = [
    'notification',
    'shopping',
    'booking',
    'registration',
    'ticketing',
  ]
    .map((task_type, i) => ({ task_type, end_date: `2026-10-0${i + 1}` }))
    .sort(compareTasks);
  assert.deepEqual(
    ordered.map((t) => t.task_type),
    ['shopping', 'registration', 'ticketing', 'notification', 'booking'],
  );
});
test('事项校验拒绝日期倒置、危险链接和没有起止日期的发布', () => {
  const t = {
    title: '订桌',
    task_type: 'booking',
    status: 'published',
    start_date: '2026-10-01',
    end_date: '2026-10-20',
  };
  assert.equal(validateTasks([t]), '');
  assert.match(validateTasks([{ ...t, end_date: '' }]), /开始和结束/);
  assert.match(validateTasks([{ ...t, end_date: '2026-09-01' }]), /早于/);
  assert.match(
    validateTasks([{ ...t, action_url: 'javascript:alert(1)' }]),
    /链接/,
  );
  assert.match(
    validateTasks([
      { ...t, end_date: t.start_date, start_time: '12:00', end_time: '11:00' },
    ]),
    /早于/,
  );
});

test('原子保存、权限隔离、旧版本冲突与跨活动事项保护', async () => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000001',
    fan = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      create table public.users(id uuid primary key,role text,is_active boolean,email_verified boolean);
      create table public.artists(id uuid primary key);
      create table public.event_type_definitions(id uuid primary key,name text);
      create table public.participation_conditions(id uuid primary key,code text unique,name text);
      create table public.events(id uuid primary key,title varchar(200) not null,artist_ids uuid[],company text,date date,time time,
        location text,location_region text,event_type_id uuid references event_type_definitions(id),participation_condition text references participation_conditions(code),
        description text,ticket_url text,status text,created_by uuid not null references users(id),created_at timestamp,updated_at timestamp,
        attributes jsonb,cancelled_at timestamptz,scheduled_publish_at timestamptz);
      create table public.tasks(id uuid primary key,event_id uuid references events(id) on delete restrict,title varchar(200) not null,
        task_type text check(task_type in ('ticketing','registration','booking','shopping','notification')),
        description text,start_date date,end_date date,start_time time,end_time time,action_url text,status text not null default 'draft',
        created_by uuid not null references users(id),created_at timestamp,updated_at timestamp,
        check(status in ('draft','published','withdrawn')),
        check(status <> 'published' or (event_id is not null and task_type is not null and start_date is not null and end_date is not null)),
        check(start_date is null or end_date is null or end_date >= start_date),
        check(start_date is distinct from end_date or start_time is null or end_time is null or end_time >= start_time));
      insert into public.users values('${admin}','admin',true,true),('${fan}','collaborator_fan',true,true);
      alter table public.users enable row level security;
      create policy self_read on public.users for select to authenticated using(id=auth.uid());
      grant select on users,artists to authenticated;
      grant select on events,tasks to anon,authenticated;
      grant insert,update,delete on events,tasks to authenticated;
      alter table public.events enable row level security; alter table public.tasks enable row level security;
      create policy public_events on public.events for select to anon,authenticated using(status='published' and cancelled_at is null and (scheduled_publish_at is null or scheduled_publish_at<=now()));
      create policy admin_events on public.events for all to authenticated
        using(exists(select 1 from users where id=auth.uid() and role='admin' and is_active))
        with check(exists(select 1 from users where id=auth.uid() and role='admin' and is_active));
      create policy public_tasks on public.tasks for select to anon,authenticated using(status='published' and exists(select 1 from events e where e.id=tasks.event_id and e.status='published' and e.cancelled_at is null and (e.scheduled_publish_at is null or e.scheduled_publish_at<=now())));
      create policy admin_tasks on public.tasks for all to authenticated
        using(exists(select 1 from users where id=auth.uid() and role='admin' and is_active))
        with check(exists(select 1 from users where id=auth.uid() and role='admin' and is_active));
    `);
    const migration = await readFile(
      new URL('../supabase/003_events_tasks.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    const v2 = await readFile(
      new URL('../supabase/004_event_form_import.sql', import.meta.url),
      'utf8',
    );
    await db.exec(v2);
    await db.exec(v2);
    await db.exec(
      `insert into artists values('00000000-0000-4000-8000-000000000003'); insert into participation_conditions values('00000000-0000-4000-8000-000000000004','top_spender','消费排名');`,
    );
    async function as(id, role = 'authenticated') {
      await db.exec(`reset role;set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id || '',
      ]);
    }
    const event = (title, status = 'draft') => ({
      id: crypto.randomUUID(),
      title,
      status,
      date: '2026-11-02',
      location: 'Ekkamai',
      location_region: 'Bangkok',
      participation_condition: 'top_spender',
      artist_ids: ['00000000-0000-4000-8000-000000000003'],
      attributes: { region: '泰国', picture_urls: [], artist_type: '组合' },
    });
    const task = (title = '购买商品') => ({
      id: crypto.randomUUID(),
      title,
      task_type: 'shopping',
      status: 'published',
      start_date: '2026-10-01',
      end_date: '2026-10-25',
    });
    async function save(e, ts = [], version = null) {
      return (
        await db.query(
          'select public.chob_save_event_bundle($1,$2,$3) as result',
          [JSON.stringify(e), JSON.stringify(ts), version],
        )
      ).rows[0].result;
    }
    await as(fan);
    await assert.rejects(save(event('拒绝')), /仅启用/);
    await as(null, 'anon');
    await assert.rejects(save(event('拒绝')), /permission denied/);
    await as(admin);
    const originalTask = task(),
      published = await save(event('GELBOYS', 'published'), [originalTask]);
    const draft = await save(event('草稿'), [task()]);
    const failed = event('回滚活动', 'published');
    await assert.rejects(
      save(failed, [{ ...task(), end_date: '2026-09-01' }]),
      /check constraint/,
    );
    assert.equal(
      (await db.query('select * from events where id=$1', [failed.id])).rows
        .length,
      0,
    );
    await assert.rejects(
      save(
        { ...published, title: '不该更新' },
        [{ ...originalTask, end_date: '2026-09-01' }],
        published.updated_at,
      ),
      /check constraint/,
    );
    assert.equal(
      (await db.query('select title from events where id=$1', [published.id]))
        .rows[0].title,
      'GELBOYS',
    );
    await assert.rejects(
      save(draft, [originalTask], draft.updated_at),
      /其他活动/,
    );
    const edited = await save(
      { ...published, title: '已更新' },
      [originalTask],
      published.updated_at,
    );
    await assert.rejects(
      save(
        { ...published, title: '旧表单' },
        [originalTask],
        published.updated_at,
      ),
      /已被修改/,
    );
    await as(null, 'anon');
    assert.equal((await db.query('select * from events')).rows.length, 1);
    assert.equal((await db.query('select * from tasks')).rows.length, 1);
    await as(fan);
    assert.equal(
      (await db.query("update events set title='非法' returning id")).rows
        .length,
      0,
    );
    await as(admin);
    await save(edited, [], edited.updated_at);
    assert.equal(
      (await db.query('select * from tasks where event_id=$1', [edited.id]))
        .rows.length,
      0,
    );
    await db.query('update events set cancelled_at=now() where id=$1', [
      edited.id,
    ]);
    await as(null, 'anon');
    assert.equal((await db.query('select * from events')).rows.length, 0);
    await as(admin);
    await assert.rejects(
      save({ ...event('无场地'), location: '' }),
      /场地必填/,
    );
    await assert.rejects(
      save({ ...event('无艺人'), artist_ids: [] }),
      /至少选择/,
    );
    await assert.rejects(save({ ...event('无日期'), date: '' }), /活动日期/);
    const photo = event('图片保存');
    photo.attributes.picture_urls = ['https://example.invalid/image.jpg'];
    photo.attributes.note = '备注';
    photo.attributes.time_text = '10:00 - 21:00';
    const withPhoto = await save(photo);
    assert.deepEqual(
      withPhoto.attributes.picture_urls,
      photo.attributes.picture_urls,
    );
    assert.equal(withPhoto.attributes.note, '备注');
    await assert.rejects(
      save({
        ...event('危险图片'),
        attributes: { region: '泰国', picture_urls: ['javascript:alert(1)'] },
      }),
      /图片链接/,
    );
    await assert.rejects(
      save({
        ...event('十张图'),
        attributes: {
          region: '泰国',
          picture_urls: Array(10).fill('https://example.invalid/a.jpg'),
        },
      }),
      /最多 9/,
    );
    const importBatch = async (items) =>
      (
        await db.query('select public.chob_import_event_bundles($1) as count', [
          JSON.stringify(items),
        ])
      ).rows[0].count;
    const imported = event('批量 A', 'published'),
      bad = event('批量 B');
    await assert.rejects(
      importBatch([
        { event: imported, tasks: [] },
        { event: { ...bad, location: '' }, tasks: [] },
      ]),
      /场地必填/,
    );
    assert.equal(
      (await db.query('select * from events where id=$1', [imported.id])).rows
        .length,
      0,
    );
    assert.equal(await importBatch([{ event: imported, tasks: [task()] }]), 1);
    assert.equal(
      (await db.query('select status from events where id=$1', [imported.id]))
        .rows[0].status,
      'draft',
    );
    assert.equal(
      (
        await db.query('select status from tasks where event_id=$1', [
          imported.id,
        ])
      ).rows[0].status,
      'draft',
    );
    await assert.rejects(
      importBatch([
        { event: { ...imported, id: crypto.randomUUID() }, tasks: [] },
      ]),
      /重复/,
    );
    await assert.rejects(
      importBatch([{ event: imported, tasks: [] }]),
      /已存在/,
    );
    await as(fan);
    await assert.rejects(
      importBatch([{ event: event('非法导入'), tasks: [] }]),
      /仅管理员/,
    );
  } finally {
    await db.close();
  }
});
