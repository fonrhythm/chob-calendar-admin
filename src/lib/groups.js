// Categories describe an artist; only explicit group identity creates a group record.
export function isGroup(artist) { return ['group','band'].includes(artist.group_kind) }
export function groupType(artist) { return artist.group_kind === 'band' ? '乐队' : '组合' }
export function groupRows(artists) { return artists.filter(isGroup).map(a=>({...a,type:groupType(a),members:[...(a.group_member_ids||[])]})) }
