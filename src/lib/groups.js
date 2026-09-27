const GROUP_TYPES = new Set(['group', 'band', '组合', '乐队', '组合/乐队'])
export function isGroup(artist) {
  return ['group', 'band'].includes(artist.group_kind) || [...(artist.categories || []), ...String(artist.type || '').split(/[;；|/]/)].some(value => GROUP_TYPES.has(String(value).trim().toLowerCase()))
}
export function groupType(artist) {
  return artist.group_kind === 'band' || [...(artist.categories || []),...String(artist.type || '').split(/[;；|/]/)].some(value => ['band','乐队'].includes(String(value || '').trim().toLowerCase())) ? '乐队' : '组合'
}
export function groupRows(artists) {
  return artists.filter(isGroup).map(a => ({ ...a, type: groupType(a), members: [...(a.group_member_ids || [])] }))
}
