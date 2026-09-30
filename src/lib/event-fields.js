import { displayArtistName } from './artists.js';
import { activityCategory } from './activity-types.js';
import { safeWebUrl, validateTasks } from './tasks.js';
import { bangkokDate } from './tasks.js';
export const recordLabel = (item) =>
  item?.name || item?.label || item?.code || item?.id || '';
export const imageUrls = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : String(value || '').split(/\r?\n|[;；]/))
      .map((x) => String(x).trim())
      .filter(Boolean),
  ),
];
export const eventArtistNames = (event, artists) =>
  (event.artist_ids || [])
    .map(
      (id) => displayArtistName(artists.find((a) => a.id === id)) || '未知艺人',
    )
    .join(' / ');
export function validateEvent(event, tasks = []) {
  if (!event.title?.trim()) return '请填写活动名称。';
  if (
    !event.date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
    Number.isNaN(Date.parse(event.date)) ||
    new Date(event.date).toISOString().slice(0, 10) !== event.date
  )
    return '请填写有效的活动日期。';
  if (!event.location?.trim()) return '请填写场地；线上活动可填写直播平台。';
  if (
    event.status === 'published' &&
    event.attributes?.unmatched_import_names?.length
  )
    return '请先完成待匹配艺人，再发布。';
  if (
    !event.artist_ids?.length &&
    !(
      event.status === 'draft' &&
      event.attributes?.unmatched_import_names?.length
    )
  )
    return '请至少选择一位参与艺人。';
  if (!event.attributes?.region?.trim()) return '请选择地区。';
  if (!event.location_region?.trim()) return '请填写城市或线上直播。';
  if (!event.participation_condition) return '请选择参与方式。';
  if (!safeWebUrl(event.ticket_url))
    return '票务链接必须是完整的 http:// 或 https:// 地址。';
  const pictures = imageUrls(event.attributes?.picture_urls);
  if (pictures.length > 9) return '活动图片最多 9 张。';
  if (pictures.some((url) => !safeWebUrl(url)))
    return '图片链接必须是完整的 http:// 或 https:// 地址。';
  return validateTasks(tasks);
}
export function eventTime(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[-–—~～]\s*\d{1,2}:\d{2})?$/);
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59)
    return null;
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}
export function filterSortEvents(events, artists, types, filters) {
  const {
    search = '',
    status = '',
    company = '',
    type = '',
    artistType = '',
    sort = 'today-first',
  } = filters;
  const list = events.filter(
    (e) =>
      (!status || (status === 'past' ? e.date < bangkokDate() : e.status === status)) &&
      (!company || (e.company || '') === company) &&
      (!type ||
        e.event_type_id === type ||
        activityCategory(
          e.attributes?.activity_category ||
            recordLabel(types.find((t) => t.id === e.event_type_id)),
        ) === type) &&
      (!artistType ||
        (e.attributes?.artist_types || [e.attributes?.artist_type]).includes(
          artistType,
        )) &&
      `${eventArtistNames(e, artists)} ${e.title} ${e.location || ''} ${e.company || ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  if (sort === 'today-first') {
    const today = bangkokDate();
    return list.sort((a, b) => {
      const aPast = a.date < today;
      const bPast = b.date < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    });
  }
  const [field, direction] = sort.split('-'),
    sign = direction === 'desc' ? -1 : 1;
  const key = (e) =>
    field === 'artist'
      ? eventArtistNames(e, artists)
      : field === 'type'
        ? recordLabel(types.find((t) => t.id === e.event_type_id))
        : field === 'date'
          ? `${e.date || ''} ${e.time || ''}`
          : e[field] || '';
  return list.sort((a, b) => {
    const av = key(a).trim(),
      bv = key(b).trim();
    if (!av !== !bv) return av ? -1 : 1;
    return (
      sign * av.localeCompare(bv, 'zh-CN', { numeric: true }) ||
      String(a.id).localeCompare(String(b.id))
    );
  });
}
