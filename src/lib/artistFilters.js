export const normalizeSearch = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const artistTypeLabels = { bl:'泰腐', gl:'泰百', band:'乐队', singer:'歌手', idol:'男女团', group:'组合', actor:'演员', other:'其他' };
export function artistTypeKey(value) {
  const v = normalizeSearch(value);
  return ({ actor:'actor', 演员:'actor', bl:'bl', 泰腐:'bl', bl演员:'bl', gl:'gl', 泰百:'gl', gl演员:'gl', idol:'idol', goup:'idol', 男女团:'idol', group:'group', ensemble:'group', 组合:'group', other:'other', 其他:'other', singer:'singer', 歌手:'singer', band:'band', 乐队:'band', music:'music', 音乐:'music' })[v] || '';
}
// group_kind describes the entity's structure, not its music category.
export function artistTypeKeys(artist) {
  const categories = Array.isArray(artist.categories) ? artist.categories : [];
  const keys = categories.map(artistTypeKey);
  if (normalizeSearch(artist.group_kind) === 'band') keys.push('band');
  return [...new Set(keys.filter(Boolean))];
}
export function selectedArtistTypeKeys(catalog, ids) {
  const selected = catalog.filter(a => ids.includes(a.id));
  const members = new Set(selected.flatMap(a => a.group_member_ids || a.member_ids || []));
  const direct = selected.filter(a => !members.has(a.id));
  const keys = direct.flatMap(artistTypeKeys);
  // Members contribute their individual professions, not a second group genre.
  keys.push(...catalog.filter(a => members.has(a.id)).flatMap(artistTypeKeys).filter(k => !['idol', 'group'].includes(k)));
  return [...new Set(keys)];
}
export function eventArtistTypeKeys(event, catalog = []) {
  const selections = event.artist_selections || event.attributes?.artist_selections || [];
  const ids = selections.length ? selections : event.artist_ids || [];
  const stored = event.artist_types || event.attributes?.artist_types || [];
  const keys = [...(Array.isArray(stored) ? stored : [stored]), event.attributes?.artist_type].map(artistTypeKey).filter(Boolean);
  const unique = [...new Set(keys)];
  // Catalog categories are authoritative; older payloads used 组合 for idols.
  if (catalog.some(a => ids.includes(a.id))) {
    const catalogKeys = selectedArtistTypeKeys(catalog, ids);
    if (catalogKeys.length) return catalogKeys;
    // Unclassified artists can retain other historical professions, but a
    // structural group or CP must never acquire a music-group genre this way.
    const fallback = unique.length ? unique : [artistTypeKey(event.category || event.attributes?.category)];
    const professions = fallback.filter(k => k && !['idol', 'group'].includes(k));
    return professions.length ? professions : ['other'];
  }
  return unique.length ? unique : [artistTypeKey(event.category || event.attributes?.category) || 'other'];
}
export function matchesArtistTypes(event, catalog, selected) {
  if (!selected.length) return true;
  const keys = eventArtistTypeKeys(event, catalog);
  return selected.some(v => v !== '__none__' && (keys.includes(artistTypeKey(v)) || artistTypeKey(v) === 'music' && keys.some(k => ['band', 'idol', 'group', 'singer'].includes(k))));
}
