const normalized = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');

export const recentNotices = (notices) =>
  [...notices].sort((a, b) =>
    String(b.updated_at || b.created_at).localeCompare(
      String(a.updated_at || a.created_at),
    ) || String(b.created_at).localeCompare(String(a.created_at)),
  );

export function duplicateNoticeGroups(notices) {
  const groups = new Map();
  for (const notice of recentNotices(notices).filter((n) => n.published)) {
    const title = normalized(notice.title);
    const body = normalized(notice.body);
    if (!title || !body) continue;
    const key = JSON.stringify([title, body]);
    groups.set(key, [...(groups.get(key) || []), notice]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
