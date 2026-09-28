import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvImportRows,
  previewImport,
  importDate,
  importTime,
} from '../src/lib/event-import.js';
import {
  filterSortEvents,
  validateEvent,
  imageUrls,
  eventArtistNames,
} from '../src/lib/event-fields.js';
const artists = [
  { id: 'a', name: 'Tilly Birds', aliases: ['TB'] },
  { id: 'b', name: 'GELBOYS', aliases: [] },
];
const workspace = {
  artists,
  events: [],
  types: [{ id: 'type1', name: '酒吧演出' }],
  conditions: [{ code: 'booking', name: '订桌' }],
};
const header =
  'date,time,name,activity,venue,city,category,type,region,participation_condition,picture_url,sale_date,sale_time';
test('原表头导入关联艺人和类型，图片及开售草稿保留', () => {
  const rows = csvImportRows(
    header +
      '\r\n2026/10/20,10:00 - 21:00,TB,演出,Ekkamai,Bangkok,酒吧演出,乐队,泰国,订桌,https://example.invalid/a.jpg,2026/10/01,13:00',
  );
  const [r] = previewImport(rows, workspace);
  assert.deepEqual(r.problems, []);
  assert.equal(r.event.artist_ids[0], 'a');
  assert.equal(r.event.event_type_id, 'type1');
  assert.equal(r.event.time, '10:00:00');
  assert.equal(r.event.attributes.artist_type, '乐队');
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].status, 'draft');
  assert.equal(r.tasks[0].end_date, '');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.event.attributes.picture_urls.length, 1);
});
test('批量默认值生效；未知和重名艺人阻止导入；重复活动阻止导入', () => {
  const csv =
    'date,name,activity,venue,city\n2026-10-20,TB,演出,Ekkamai,Bangkok';
  const rows = csvImportRows(csv);
  assert.ok(previewImport(rows, workspace)[0].problems.length);
  const defaults = { region: '泰国', condition: 'booking' },
    [r] = previewImport(rows, workspace, defaults);
  assert.deepEqual(r.problems, []);
  assert.match(
    previewImport(
      csvImportRows(csv.replace(',TB,', ',Unknown,')),
      workspace,
      defaults,
    )[0].warnings.join(''),
    /待匹配艺人/,
  );
  assert.match(
    previewImport(
      rows,
      { ...workspace, artists: [...artists, { id: 'c', name: 'TB' }] },
      defaults,
    )[0].warnings.join(''),
    /待匹配艺人/,
  );
  assert.match(
    previewImport(
      rows,
      { ...workspace, events: [r.event] },
      defaults,
    )[0].problems.join(''),
    /已有/,
  );
  assert.match(
    previewImport([...rows, ...rows], workspace, defaults)[1].problems.join(''),
    /文件中/,
  );
  assert.throws(
    () => csvImportRows('date,date,name,activity,venue\n1,1,x,x,x'),
    /重复/,
  );
});
test('日期、图片数和必填校验，Excel时间转换', () => {
  assert.equal(importDate('2026/2/30'), '');
  assert.equal(importDate('10/20'), '');
  assert.equal(importDate('2026/2/03'), '2026-02-03');
  assert.equal(importTime(0.5), '12:00');
  assert.equal(imageUrls('https://a.test/a\nhttps://a.test/a').length, 1);
  const [r] = previewImport(
    csvImportRows(
      'date,name,activity,venue,city\n2026-10-20,TB,演出,Ekkamai,Bangkok',
    ),
    workspace,
    { region: '泰国', condition: 'booking' },
  );
  for (const field of ['date', 'location'])
    assert.ok(validateEvent({ ...r.event, [field]: '' }));
  assert.match(validateEvent({ ...r.event, artist_ids: [] }), /参与艺人/);
  assert.match(
    validateEvent({
      ...r.event,
      attributes: {
        ...r.event.attributes,
        picture_urls: Array.from(
          { length: 10 },
          (_, i) => `https://a.test/${i}`,
        ),
      },
    }),
    /最多/,
  );
});
test('公司、活动类型、艺人类别筛选及日期排序；chip文本只取艺人资料', () => {
  const a = {
    id: '1',
    title: '不能当艺人名',
    date: '2026-11-02',
    artist_ids: ['a'],
    company: 'A',
    event_type_id: 'type1',
    attributes: { artist_type: '乐队' },
  };
  const b = {
    id: '2',
    title: '另一个',
    date: '2026-10-20',
    artist_ids: ['b'],
    company: 'B',
  };
  assert.equal(eventArtistNames(a, artists), 'Tilly Birds');
  assert.deepEqual(
    filterSortEvents([a, b], artists, workspace.types, {
      sort: 'date-asc',
    }).map((e) => e.id),
    ['2', '1'],
  );
  assert.deepEqual(
    filterSortEvents([a, b], artists, workspace.types, {
      company: 'A',
      type: 'type1',
      artistType: '乐队',
    }).map((e) => e.id),
    ['1'],
  );
  assert.equal(
    filterSortEvents([a, b], artists, workspace.types, { search: 'Tilly' })
      .length,
    1,
  );
});
