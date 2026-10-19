export const normalizeSearch = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const artistTypeLabels = { bl:'泰腐', gl:'泰百', band:'乐队', singer:'歌手', group:'男女团', ensemble:'组合', actor:'演员', other:'其他' };
export function artistTypeKey(value) {
  const v = normalizeSearch(value);
  return ({ actor:'actor', 演员:'actor', bl:'bl', 泰腐:'bl', bl演员:'bl', gl:'gl', 泰百:'gl', gl演员:'gl', group:'group', goup:'group', 男女团:'group', ensemble:'ensemble', 组合:'ensemble', other:'other', 其他:'other', singer:'singer', 歌手:'singer', band:'band', 乐队:'band', music:'music', 音乐:'music' })[v] || '';
}
// Structural groups are distinct from the existing boy/girl-group genre.
// A group can carry both categories; a solo member does not inherit its group.
export function artistTypeKeys(artist) {
  const categories=Array.isArray(artist.categories)?artist.categories:[];
  const kind=normalizeSearch(artist.group_kind);
  const keys=categories.map(artistTypeKey);
  keys.push(kind==='group'?'ensemble':artistTypeKey(kind));
  return [...new Set(keys.filter(Boolean))];
}
export function eventArtistTypeKeys(event, catalog = []) {
  const ids = new Set([...(event.artist_ids || []),...(event.artist_selections || event.attributes?.artist_selections || [])]);
  const selected = catalog.filter(a => ids.has(a.id));
  const members = new Set(selected.flatMap(a => a.group_member_ids || a.member_ids || []));
  const keys = [...selected, ...catalog.filter(a => members.has(a.id))].flatMap(artistTypeKeys);
  const stored=event.artist_types || event.attributes?.artist_types || [];
  // Older selection payloads normalized the GROUP genre to Chinese 组合.
  // A fully resolved solo/CP catalog must not turn that legacy alias into a group.
  const storedKeys=(Array.isArray(stored)?stored:[stored]).filter(value=>!(normalizeSearch(value)==='组合'&&selected.length===ids.size&&selected.length>0&&!keys.includes('ensemble'))).map(artistTypeKey);
  keys.push(...storedKeys,artistTypeKey(event.attributes?.artist_type));
  const unique=[...new Set(keys.filter(Boolean))];
  return unique.length ? unique : [artistTypeKey(event.category || event.attributes?.category) || 'other'];
}
export function matchesArtistTypes(event, catalog, selected) {
  if (!selected.length) return true;
  const keys = eventArtistTypeKeys(event, catalog);
  return selected.some(v => v !== '__none__' && (keys.includes(artistTypeKey(v)) || artistTypeKey(v)==='music' && keys.some(k => ['band','group','singer'].includes(k))));
}
