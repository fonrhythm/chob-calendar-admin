export const normalizeSearch = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const artistTypeLabels = { bl:'泰腐', gl:'泰百', band:'乐队', singer:'歌手', group:'男女团', actor:'演员', other:'其他' };
export function artistTypeKey(value) {
  const v = normalizeSearch(value);
  return ({ actor:'actor', 演员:'actor', bl:'bl', 泰腐:'bl', bl演员:'bl', gl:'gl', 泰百:'gl', gl演员:'gl', group:'group', goup:'group', 组合:'group', 男女团:'group', other:'other', 其他:'other', singer:'singer', 歌手:'singer', band:'band', 乐队:'band', music:'music', 音乐:'music' })[v] || '';
}
export function eventArtistTypeKeys(event, catalog = []) {
  const ids = event.artist_ids || [];
  const selected = catalog.filter(a => ids.includes(a.id));
  const members = selected.flatMap(a => a.group_member_ids || a.member_ids || []);
  const values = [...selected, ...catalog.filter(a => members.includes(a.id))].flatMap(a => [...(a.categories || []), a.group_kind]);
  values.push(...(event.artist_types || event.attributes?.artist_types || []), event.attributes?.artist_type);
  const keys = [...new Set(values.map(artistTypeKey).filter(Boolean))];
  return keys.length ? keys : [artistTypeKey(event.category || event.attributes?.category) || 'other'];
}
export function matchesArtistTypes(event, catalog, selected) {
  if (!selected.length) return true;
  const keys = eventArtistTypeKeys(event, catalog);
  return selected.some(v => v !== '__none__' && (keys.includes(artistTypeKey(v)) || artistTypeKey(v)==='music' && keys.some(k => ['band','group','singer'].includes(k))));
}
