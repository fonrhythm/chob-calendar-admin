import { artistPayload, normalize, rowsToArtists, splitValues, validateImport } from './artists.js';
import { isGroup } from './groups.js';

export const importSpecs = {
  artists: { label: '艺人', fields: { name: '艺人名称', full_name: '泰语名', en_name: '显示名称', company: '公司', categories: '类别', aliases: '别名' } },
  cp: { label: 'CP', fields: { cp_name: 'CP名称', artist_1_id: '第一位艺人', artist_2_id: '第二位艺人' } },
  group: { label: '组合/乐队', fields: { name: '组合/乐队名称', type: '类型', en_name: '显示名称', company: '公司', members: '成员', aliases: '别名' } },
};
export function catalogTemplate(kind) {
  return '\uFEFF' + Object.values(importSpecs[kind].fields).join(',') + '\r\n';
}
export function parseCatalogRows(grid, kind) {
  if (kind === 'artists') return rowsToArtists(grid).map(r => ({ ...r, categories: r.categories.join('; '), aliases: r.aliases.join('; ') }));
  if (grid.length < 2) throw new Error('表格至少需要表头和一行资料。');
  const spec = importSpecs[kind];
  const mapping = Object.fromEntries(Object.entries(spec.fields).flatMap(([k, label]) => [[normalize(k), k], [normalize(label), k]]));
  const headers = grid[0].map(v => mapping[normalize(v)]);
  const required = kind === 'cp' ? ['cp_name', 'artist_1_id', 'artist_2_id'] : ['name', 'type', 'members'];
  if (required.some(k => !headers.includes(k))) throw new Error(`请使用${spec.label}专用模板，缺少必需的表头。`);
  const known = headers.filter(Boolean);
  if (new Set(known).size !== known.length) throw new Error('表头存在重复含义的列。');
  const rows = grid.slice(1).filter(r => r.some(v => v != null && String(v).trim())).map(r => Object.fromEntries(headers.filter(Boolean).map(k => [k, String(r[headers.indexOf(k)] ?? '').trim()])));
  if (rows.length > 200) throw new Error('每批最多200条，请分批导入。');
  return rows;
}
function resolveMember(value, artists) {
  const text = normalize(value);
  if (!text) throw new Error('请选择艺人');
  const candidates = artists.filter(a => !a.deleted_at && !isGroup(a));
  const byId = candidates.find(a => normalize(a.id) === text);
  if (byId) return byId.id;
  const matches = candidates.filter(a => [a.name, a.base_name, a.full_name, a.en_name, ...(a.aliases || [])].some(n => n && normalize(n) === text));
  if (matches.length !== 1) throw new Error(matches.length ? `“${value}”匹配多位艺人，请填写艺人ID` : `找不到个人艺人“${value}”，请先新增艺人`);
  return matches[0].id;
}
export function prepareCatalogRows(preview, kind, artists, pairs) {
  if (kind === 'artists') {
    const rows = preview.map(artistPayload);
    return { rows, problems: validateImport(rows, artists.filter(a => !a.deleted_at)) };
  }
  const seenNames = new Set(), seenMembers = new Set();
  const existing = kind === 'cp' ? pairs.filter(p => !p.deleted_at) : artists.filter(a => !a.deleted_at);
  const rows = [], problems = [];
  for (const r of preview) {
    try {
      const name = String(kind === 'cp' ? r.cp_name || '' : r.name || '').trim();
      if (!name || name.length > 150) throw new Error('名称必填，最多150字');
      if (existing.some(a => normalize(kind === 'cp' ? a.cp_name : a.name) === normalize(name))) throw new Error('数据库中已有同名记录');
      if (seenNames.has(normalize(name))) throw new Error('文件中名称重复');
      seenNames.add(normalize(name));
      let payload;
      if (kind === 'cp') {
        const a = resolveMember(r.artist_1_id, artists), b = resolveMember(r.artist_2_id, artists);
        if (a === b) throw new Error('CP必须选择两位不同艺人');
        const key = [a, b].sort().join('|');
        if (seenMembers.has(key) || existing.some(p => [p.artist_1_id, p.artist_2_id].sort().join('|') === key)) throw new Error('这两位艺人已有CP配对');
        seenMembers.add(key);
        payload = { cp_name: name, artist_1_id: a, artist_2_id: b };
      } else {
        const type = { group: '组合', band: '乐队', 组合: '组合', 乐队: '乐队' }[normalize(r.type)];
        if (!type) throw new Error('类型请填写“组合”或“乐队”');
        const members = [...new Set(splitValues(r.members).map(v => resolveMember(v, artists)))];
        if (members.length > 200) throw new Error('成员最多200位');
        payload = { name, type, members, en_name: String(r.en_name || '').trim(), company: String(r.company || '').trim(), aliases: splitValues(r.aliases) };
      }
      rows.push(payload); problems.push('');
    } catch (e) { rows.push(null); problems.push(e.message); }
  }
  return { rows, problems };
}
