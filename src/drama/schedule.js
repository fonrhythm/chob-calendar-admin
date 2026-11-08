export const dramaTypes = ['Boys Love', 'Girls Love', 'BG', 'Bromance', '群像', '其他'];
export function validateDrama(drama) {
  if (![drama.titleTh, drama.titleEn, drama.titleZh].some(v => typeof v === 'string' && v.trim())) throw Error('泰、英、中剧名至少填写一项');
  if ((drama.types || []).some(v => !dramaTypes.includes(v))) throw Error('请选择有效类型');
}
export function dramaTitle(drama) {
  return [drama.titleZh, drama.titleEn, drama.titleTh].find(v => v?.trim())?.trim() || '';
}
// Dates here are platform-local calendar dates; preserve the platform timezone
// alongside each time rather than interpreting it in the browser timezone.
export function generateSchedule(drama, rule) {
  validateDrama(drama);
  if (!rule?.premiere) return [];
  const first = new Date(`${rule.premiere}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.premiere) || !Number.isFinite(+first) || first.toISOString().slice(0,10) !== rule.premiere) throw Error('首播日期无效');
  const {totalEpisodes, intervalDays = 7, episodesPerRelease = 1} = rule;
  for (const value of [totalEpisodes, intervalDays, episodesPerRelease]) if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw Error('集数与播出周期必须为有效正整数');
  if (!drama.id || !rule.id || !rule.platformId || !rule.timezone || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time || '')) throw Error('排播需要剧集、规则、平台、时区和播出时间');
  try { new Intl.DateTimeFormat('en', {timeZone: rule.timezone}); } catch { throw Error('时区无效'); }
  return Array.from({length: totalEpisodes}, (_, i) => {
    const date = new Date(+first);
    date.setUTCDate(date.getUTCDate() + Math.floor(i / episodesPerRelease) * intervalDays);
    return {id: `${drama.id}:${rule.id}:${i+1}`, dramaId: drama.id, ruleId: rule.id, episode: i+1, platformId: rule.platformId, date: date.toISOString().slice(0,10), time: rule.time, timezone: rule.timezone, confidence: i === 0 ? 'confirmed' : 'calculated', status: 'scheduled'};
  });
}
export function reschedule(slot, replacement, announcement) {
  if (!announcement?.id || !announcement?.content?.trim()) throw Error('请填写变动公告');
  if (!replacement || !/^\d{4}-\d{2}-\d{2}$/.test(replacement.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(replacement.time || '')) throw Error('请填写新的播出日期和时间');
  const date = new Date(`${replacement.date}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== replacement.date) throw Error('日期无效');
  return { original: {...slot, status: 'changed', announcementId: announcement.id}, replacement: {...slot, date: replacement.date, time: replacement.time, id: `${slot.id}:change:${announcement.id}`, replacesId: slot.id, status: 'scheduled', confidence: 'confirmed', announcementId: announcement.id}, announcement: {...announcement, dramaId: slot.dramaId, affectedEpisodes: [slot.episode], originalDate: slot.date, updatedDate: replacement.date} };
}
export function announcementsForEpisode(announcements, dramaId, episode) {
  return announcements.filter(a => a.dramaId === dramaId && a.affectedEpisodes.some(n => Math.abs(n - episode) <= 1));
}
