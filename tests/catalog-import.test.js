import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/lib/artists.js';
import { catalogTemplate, parseCatalogRows, prepareCatalogRows } from '../src/lib/catalog-import.js';
const artists = [{ id: 'a', name: 'Alice', en_name: 'A', aliases: ['艾'] }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Band', group_kind: 'band' }, { id: 'd', name: 'Deleted', deleted_at: 'yes' }];
test('templates use distinct schemas and reject wrong category files', () => {
  assert.match(catalogTemplate('cp'), /CP名称,第一位艺人,第二位艺人/);
  assert.match(catalogTemplate('group'), /组合\/乐队名称,类型,显示名称,公司,成员,别名/);
  assert.throws(() => parseCatalogRows(parseCsv(catalogTemplate('artists') + 'Solo,,,,,\n'), 'cp'));
  assert.throws(() => parseCatalogRows(parseCsv(catalogTemplate('cp') + 'AB,A,B\n'), 'group'));
  assert.throws(() => parseCatalogRows(parseCsv(catalogTemplate('group') + 'Team,组合,,,,\n'), 'artists'));
});
test('CP imports resolve members and reject duplicate, ambiguous, deleted and group members', () => {
  const preview = parseCatalogRows(parseCsv(catalogTemplate('cp') + 'AB,艾,Bob\n'), 'cp');
  const result = prepareCatalogRows(preview, 'cp', artists, []);
  assert.deepEqual(result.rows[0], { cp_name: 'AB', artist_1_id: 'a', artist_2_id: 'b' });
  assert.equal(result.problems[0], '');
  for (const member of ['Band','Deleted','Missing','Alice']) {
    assert.ok(prepareCatalogRows([{cp_name:'Pair',artist_1_id:'a',artist_2_id:member}], 'cp', artists, []).problems[0]);
  }
  assert.match(prepareCatalogRows(preview, 'cp', [...artists,{id:'e',name:'艾'}], []).problems[0], /多位/);
  assert.match(prepareCatalogRows(preview, 'cp', artists, [{cp_name:'BA',artist_1_id:'b',artist_2_id:'a'}]).problems[0], /已有CP/);
  assert.ok(prepareCatalogRows([...preview,{...preview[0],cp_name:'Other'}], 'cp', artists, []).problems[1]);
});
test('group imports preserve kind, optional members and display fields', () => {
  const rows = parseCatalogRows(parseCsv(catalogTemplate('group') + 'Team,乐队,Display,Company,A;Bob,Alias\nEmpty,组合,,,,\n'), 'group');
  const result = prepareCatalogRows(rows,'group',artists,[]);
  assert.deepEqual(result.problems, ['', '']);
  assert.deepEqual(result.rows[0],{name:'Team',type:'乐队',en_name:'Display',company:'Company',members:['a','b'],aliases:['Alias']});
  assert.deepEqual(result.rows[1].members, []);
  assert.ok(prepareCatalogRows([{name:'Bad',type:'音乐',members:''}],'group',artists,[]).problems[0]);
  assert.ok(prepareCatalogRows([{name:'Bad',type:'组合',members:'Missing'}],'group',artists,[]).problems[0]);
});
