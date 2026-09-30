export const artistType = (value) =>
  ({
    actor: '演员',
    演员: '演员',
    singer: '歌手',
    歌手: '歌手',
    cp: 'CP',
    group: '组合',
    组合: '组合',
    band: '乐队',
    乐队: '乐队',
    bl: 'BL',
    gl: 'GL',
    other: '其他',
  })[
    String(value || '')
      .trim()
      .toLowerCase()
  ] || String(value || '').trim();
export const artistTypes = (values) => [
  ...new Set((values || []).map(artistType).filter(Boolean)),
];
export const selectionTypes = (catalog, ids) => {
  const selected = catalog.filter((a) => ids.includes(a.id));
  const members = new Set(
    selected.flatMap((a) => a.member_ids || a.group_member_ids || []),
  );
  return artistTypes(
    [...selected, ...catalog.filter((a) => members.has(a.id))].flatMap((a) =>
      [...(a.categories || []), a.group_kind].filter(Boolean),
    ),
  );
};
export const selectionCompanies = (catalog, ids) => {
  const selected = catalog.filter((a) => ids.includes(a.id));
  const members = new Set(selected.flatMap((a) => a.member_ids || a.group_member_ids || []));
  return [...new Set([...selected, ...catalog.filter((a) => members.has(a.id))]
    .map((a) => String(a.company || '').trim()).filter(Boolean))].join(' / ');
};
export const selectionCount = (item) =>
  Array.isArray(item.artist_selections) && item.artist_selections.length
    ? new Set(item.artist_selections).size
    : Number.isFinite(item.artist_count)
      ? item.artist_count
      : new Set(
          item.artist_ids?.length
            ? item.artist_ids
            : item.artist_names?.length
              ? item.artist_names
              : [item.name],
        ).size;
