import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('community workflow enforces ownership, edit limits, immediate flags, reply privacy and linked postponement', async () => {
  const db = new PGlite(),
    admin = '00000000-0000-4000-8000-000000000001',
    fan = '00000000-0000-4000-8000-000000000002',
    other = '00000000-0000-4000-8000-000000000009';
  try {
    const fixture = await readFile(
      new URL('./events.test.js', import.meta.url),
      'utf8',
    );
    const setup = fixture
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
      .replaceAll('${admin}', admin)
      .replaceAll('${fan}', fan);
    await db.exec(setup);
    await db.exec(`create schema chob_private; create table public.cp_pairs(id uuid primary key,cp_name text,artist_1_id uuid,artist_2_id uuid,deleted_at timestamptz);
   alter table artists add column name text, add column en_name text, add column group_member_ids uuid[] default '{}', add column company text, add column categories text[],add column group_kind text,add column deleted_at timestamptz;
   create function chob_private.active_member() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.users where id=auth.uid() and is_active and email_verified)$$;
   create function chob_private.is_admin() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.users where id=auth.uid() and role='admin' and is_active and email_verified)$$;
   create function chob_private.require_admin() returns void language plpgsql security definer set search_path='' as $$begin if not chob_private.is_admin() then raise exception '仅管理员';end if;end$$;
   grant usage on schema chob_private to authenticated;
   insert into users values('${other}','collaborator_fan',true,true);
  `);
    for (const file of [
      '004_event_form_import.sql',
      '006_community.sql',
      '007_task_categories.sql',
      '009_activity_categories.sql',
      '012_group_save_display.sql',
      '013_artist_selection.sql',
      '014_activity_labels.sql',
      '015_scheduling_import_drafts.sql',
      '016_event_updates_and_details.sql',
      '017_event_bulk_management.sql',
    ]) {
      const sql = await readFile(
        new URL('../supabase/' + file, import.meta.url),
        'utf8',
      );
      await db.exec(sql);
      await db.exec(sql);
    }
    async function as(id, role = 'authenticated') {
      await db.exec('reset role;set role ' + role);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id || '',
      ]);
    }
    async function call(name, args) {
      return (
        await db.query(
          'select ' +
            name +
            '(' +
            args.map((_, i) => '$' + (i + 1)).join(',') +
            ') as result',
          args,
        )
      ).rows[0].result;
    }
    const payload = {
      activity: 'Test event',
      date: '2026-11-02',
      region: 'thailand',
      city: 'Bangkok',
      venue: 'Hall',
      unmatched_artist: 'New artist',
      images: [],
      artist_ids: [],
      artist_selections: ['cp:test', 'group:test'],
      artist_types: ['CP', 'group', '组合'],
      roll_call: true,
    };
    await as(null, 'anon');
    await assert.rejects(
      call('chob_submit_event', [payload, null, null]),
      /permission denied/,
    );
    await as(fan);
    const id = await call('chob_submit_event', [payload, null, null]);
    let mine = await call('chob_my_submissions', []);
    assert.equal(mine[0].user_edit_count, 0);
    await as(other);
    await assert.rejects(
      call('chob_submit_event', [payload, id, mine[0].updated_at]),
      /只能编辑/,
    );
    await as(fan);
    for (let n = 0; n < 3; n++) {
      mine = await call('chob_my_submissions', []);
      await call('chob_submit_event', [
        { ...payload, note: 'edit ' + n },
        id,
        mine[0].updated_at,
      ]);
    }
    mine = await call('chob_my_submissions', []);
    assert.equal(mine[0].user_edit_count, 3);
    await assert.rejects(
      call('chob_submit_event', [payload, id, mine[0].updated_at]),
      /三次/,
    );
    const report = await call('chob_report_correction', [
      id,
      ['venue'],
      'Hall might be wrong',
    ]);
    await as(null, 'anon');
    let feed = await call('chob_public_feed', []);
    assert.deepEqual(feed.records.find((r) => r.id === id).pending_fields, [
      'venue',
    ]);
    assert.equal(feed.records.find((r) => r.id === id).created_by, undefined);
    assert.equal(feed.records.find((r) => r.id === id).artist_count, 2);
    assert.deepEqual(
      [...feed.records.find((r) => r.id === id).artist_types].sort(),
      ['CP', '组合'],
    );
    assert.equal(feed.records.find((r) => r.id === id).roll_call, true);
    await as(other);
    assert.equal(
      (await db.query('select * from chob_corrections')).rows.length,
      0,
    );
    await assert.rejects(
      call('chob_resolve_correction', [
        report,
        'changed',
        'Fixed',
        { venue: 'New Hall' },
        true,
        'https://x.com/test/status/1',
      ]),
      /仅管理员/,
    );
    await as(admin);
    await call('chob_resolve_correction', [
      report,
      'changed',
      'Fixed',
      { venue: 'New Hall' },
      true,
      'https://x.com/test/status/1',
    ]);
    await assert.rejects(
      call('chob_resolve_correction', [
        report,
        'correct',
        'Already resolved',
        {},
        false,
        '',
      ]),
      /已经处理/,
    );
    await as(null, 'anon');
    feed = await call('chob_public_feed', []);
    assert.equal(feed.records.find((r) => r.id === id).venue, 'New Hall');
    assert.deepEqual(feed.records.find((r) => r.id === id).pending_fields, []);
    assert.equal(feed.announcements.length, 1);
    await as(fan);
    assert.equal(
      (await db.query('select * from chob_messages')).rows[0].content,
      'Fixed',
    );
    await call('chob_save_personal', [
      {
        nickname: 'Fan',
        favorites: ['supabase:' + id],
        artist_favorites: [],
        items: ['supabase:' + id],
        tags: { ['supabase:' + id]: '待开票' },
      },
    ]);
    await assert.rejects(
      call('chob_save_personal', [
        {
          nickname: 'Fan',
          favorites: [],
          artist_favorites: [],
          items: ['private-note'],
          tags: {},
        },
      ]),
      /已有公开活动/,
    );
    await as(admin);
    const pendingDateId = await call('chob_set_postponement', [
      id, null, true, 'https://example.com/source',
    ]);
    assert.equal(pendingDateId, id);
    let editableNotice = (await db.query("select * from chob_announcements where event_id=$1 and kind='postponement'", [id])).rows[0];
    assert.match(editableNotice.body, /另行通知/);
    await call('chob_save_announcement', [{
      id: editableNotice.id, event_id: id, title: '延期消息更新',
      body: '新日期还未确定', source_url: '', published: true,
    }]);
    assert.equal((await db.query('select count(*)::int n from chob_announcements where id=$1', [editableNotice.id])).rows[0].n, 1);
    await call('chob_set_postponement', [id, null, true, 'https://example.com/updated']);
    editableNotice = (await db.query("select * from chob_announcements where event_id=$1 and kind='postponement'", [id])).rows[0];
    assert.equal(editableNotice.source_url, 'https://example.com/updated');
    assert.equal((await db.query("select count(*)::int n from chob_announcements where event_id=$1 and kind='postponement'", [id])).rows[0].n, 1);
    await as(null, 'anon');
    feed = await call('chob_public_feed', []);
    assert.equal(feed.records.find((r) => r.id === id).event_status, 'postponed');
    assert.equal(feed.records.find((r) => r.id === id).postponed_to_date, '');
    assert.ok(Object.hasOwn(feed.records.find((r) => r.id === id), 'participation_condition'));
    await as(admin);
    const next = await call('chob_set_postponement', [
      id,
      '2026-12-01',
      false,
      '',
    ]);
    await as(fan);
    const personal = (await db.query('select * from chob_personal')).rows[0];
    assert.deepEqual(personal.items, ['supabase:' + next]);
    assert.equal(personal.tags['supabase:' + next], '待开票');
    await as(null, 'anon');
    feed = await call('chob_public_feed', []);
    assert.equal(
      feed.records.find((r) => r.id === id).postponed_to_date,
      '2026-12-01',
    );
    assert.equal(
      feed.records.find((r) => r.id === next).original_date,
      '2026-11-02',
    );
    await as(fan);
    mine = await call('chob_my_submissions', []);
    await assert.rejects(
      call('chob_submit_event', [
        { ...payload, date: '2027-01-02' },
        id,
        mine.find((r) => r.id === id).updated_at,
      ]),
      /已关联延期/,
    );
    const duplicate = await call('chob_submit_event', [
      { ...payload, activity: 'Duplicate' },
      null,
      null,
    ]);
    await call('chob_save_personal', [
      {
        nickname: 'Fan',
        favorites: ['supabase:' + duplicate],
        artist_favorites: [],
        items: ['supabase:' + duplicate],
        tags: { ['supabase:' + duplicate]: '待报名' },
      },
    ]);
    const duplicateReport = await call('chob_report_correction', [
      duplicate,
      ['venue'],
      'Check duplicate venue',
    ]);
    await as(admin);
    await call('chob_resolve_correction', [
      duplicateReport,
      'correct',
      'Verified',
      {},
      true,
      'https://example.com/source',
    ]);
    await call('chob_review_duplicates', [[next, duplicate], next, 'merge']);
    await as(fan);
    const merged = (await db.query('select * from chob_personal')).rows[0];
    assert.deepEqual(merged.items, ['supabase:' + next]);
    assert.equal(merged.tags['supabase:' + next], '待报名');
    assert.equal(merged.tags['supabase:' + duplicate], undefined);
    assert.equal(
      (await db.query("select * from chob_messages where content='Verified'"))
        .rows[0].event_id,
      next,
    );
    await as(null, 'anon');
    feed = await call('chob_public_feed', []);
    assert.equal(
      feed.records.some((r) => r.id === duplicate),
      false,
    );
    assert.equal(
      feed.announcements.find(
        (r) => r.source_url === 'https://example.com/source',
      ).event_id,
      next,
    );
    await as(other);
    assert.equal(
      (await db.query('select * from chob_personal')).rows.length,
      0,
    );
    assert.equal(
      (await db.query('select * from chob_messages')).rows.length,
      0,
    );
    await as(fan);
    const later = await call('chob_submit_event_scheduled', [
      { ...payload, scheduled_publish_at: '2099-01-01T00:00:00Z' },
      null,
      null,
    ]);
    await as(null, 'anon');
    assert.ok(
      !(await call('chob_public_feed', [])).records.some((r) => r.id === later),
    );
    await db.exec('reset role');
    await db.query(
      "update events set scheduled_publish_at=now()-interval '1 minute' where id=$1",
      [later],
    );
    await as(null, 'anon');
    assert.ok(
      (await call('chob_public_feed', [])).records.some((r) => r.id === later),
    );
    await as(fan);
    await assert.rejects(
      call('chob_submit_event_scheduled', [
        { ...payload, scheduled_publish_at: '2000-01-01T00:00:00Z' },
        null,
        null,
      ]),
      /未来/,
    );
    await db.exec('reset role');
    await db.exec(
      "insert into artists(id,name) values('00000000-0000-4000-8000-000000000777','Resolved');insert into participation_conditions(id,code,name) values('00000000-0000-4000-8000-000000000778','test_free','Free')",
    );
    await as(admin);
    const pending = {
      id: '00000000-0000-4000-8000-000000000779',
      title: 'Pending import',
      date: '2026-11-02',
      location: 'Hall',
      location_region: 'Bangkok',
      participation_condition: 'test_free',
      artist_ids: [],
      status: 'draft',
      attributes: {
        region: 'thailand',
        picture_urls: [],
        unmatched_import_names: ['Unknown'],
      },
    };
    const saved = await call('chob_save_event_bundle_v2', [pending, [], null]);
    await assert.rejects(
      call('chob_save_event_bundle_v2', [
        {
          ...pending,
          status: 'published',
          artist_ids: ['00000000-0000-4000-8000-000000000777'],
        },
        [],
        saved.updated_at,
      ]),
      /匹配/,
    );
    await call('chob_save_event_bundle_v2', [
      {
        ...pending,
        status: 'published',
        artist_ids: ['00000000-0000-4000-8000-000000000777'],
        attributes: { ...pending.attributes, unmatched_import_names: [] },
      },
      [
        {
          id: '00000000-0000-4000-8000-000000000780',
          title: 'Open ticket',
          task_type: 'ticketing',
          status: 'published',
          start_date: '2026-10-01',
          end_date: null,
        },
      ],
      saved.updated_at,
    ]);
    const imported = {
      ...pending,
      id: '00000000-0000-4000-8000-000000000781',
      title: 'Published from import',
      date: '2026-11-03',
      artist_ids: ['00000000-0000-4000-8000-000000000777'],
      attributes: { region: 'thailand', picture_urls: [], activity_category: 'press', unmatched_import_names: [] },
    };
    await db.query('select public.chob_import_event_bundles_v2($1::jsonb,true)', [JSON.stringify([{ event: imported, tasks: [] }])]);
    assert.equal((await db.query('select status from events where id=$1', [imported.id])).rows[0].status, 'published');
    await assert.rejects(
      db.query('select public.chob_import_event_bundles_v2($1::jsonb,true)', [JSON.stringify([{ event: { ...imported, id: '00000000-0000-4000-8000-000000000782', title: 'Different title' }, tasks: [] }])]),
      /重复/,
    );
    await db.query('select public.chob_manage_events($1::uuid[],$2::text)', [[imported.id], 'delete']);
    const removed = (await db.query('select status,attributes from events where id=$1', [imported.id])).rows[0];
    assert.equal(removed.status, 'withdrawn');
    assert.ok(removed.attributes.admin_deleted_at);
    await as(null, 'anon');
    assert.ok(
      (await call('chob_public_feed', [])).records.some(
        (r) => r.id === '00000000-0000-4000-8000-000000000780',
      ),
    );
  } finally {
    await db.close();
  }
});
