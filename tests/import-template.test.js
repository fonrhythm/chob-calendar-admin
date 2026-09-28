import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from 'read-excel-file/node';
import { fileURLToPath } from 'node:url';
import { readImportRows, previewImport } from '../src/lib/event-import.js';
import { activityCategory, ACTIVITY_TYPES } from '../src/lib/activity-types.js';
test('downloaded Excel example round-trips through production parser and independent CP/group selection', async () => {
  const rows = await readSheet(
    fileURLToPath(
      new URL('../public/templates/events-import.xlsx', import.meta.url),
    ),
    1,
  );
  assert.throws(() => readImportRows(rows), /示例/);
  rows[1][0] = '导入';
  rows[1][3] = '演示CP;演示组合';
  const workspace = {
    events: [],
    artists: [
      { id: 'a', name: '甲', categories: ['actor'] },
      { id: 'b', name: '乙', categories: ['singer'] },
      {
        id: 'g',
        name: '组合',
        en_name: '演示组合',
        group_kind: 'group',
        categories: ['group'],
      },
    ],
    pairs: [
      { id: 'cp1', cp_name: '演示CP', artist_1_id: 'a', artist_2_id: 'b' },
    ],
    types: [],
    conditions: [{ code: 'free', name: '免费' }],
  };
  const [r] = previewImport(readImportRows(rows), workspace, {
    condition: 'free',
  });
  assert.deepEqual(r.problems, []);
  assert.equal(r.event.date, '2026-10-15');
  assert.equal(r.event.time, '14:00:00');
  assert.equal(r.event.attributes.activity_category, 'interaction');
  assert.deepEqual(r.event.attributes.artist_selections, ['cp:cp1', 'g']);
  assert.equal(r.event.attributes.cp_ids[0], 'cp1');
  rows[1][7] = '颁奖红毯';
  assert.equal(
    previewImport(readImportRows(rows), workspace, { condition: 'free' })[0]
      .event.attributes.activity_category,
    'awards',
  );
});
test('legacy brand and interaction merge without conflating awards', () => {
  assert.equal(activityCategory('brand'), 'interaction');
  assert.equal(activityCategory('品牌商务'), 'interaction');
  assert.equal(activityCategory('颁奖红毯'), 'awards');
  assert.deepEqual(
    ACTIVITY_TYPES.map((x) => x.name),
    ['演出舞台', '影视宣传', '站台活动', '颁奖红毯', '线上直播', '其他'],
  );
});
