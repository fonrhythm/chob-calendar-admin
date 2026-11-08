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
  function validDays(days){if(!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('请选择有效的每周播出日');return days;}
  const weekly=Object.hasOwn(rule,'weekdays');
  if(weekly)validDays(rule.weekdays);
  const phases=rule.phases||[];if(!Array.isArray(phases)||(!weekly&&phases.length))throw Error('请先选择每周播出日');const seen=new Set();
  for(const phase of phases){validDays(phase.weekdays);const date=new Date(`${phase.from}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(phase.from||'')||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==phase.from||phase.from<rule.premiere||seen.has(phase.from))throw Error('调整生效日不能早于首播日，且不能重复');seen.add(phase.from);}
  const premiereDays=phases.find(p=>p.from===rule.premiere)?.weekdays||rule.weekdays;
  if(weekly&&!premiereDays.includes(first.getUTCDay()))throw Error('首播日期必须属于选定的播出日');
  const dates=[];let day=new Date(+first);
  while(dates.length<totalEpisodes){const key=day.toISOString().slice(0,10);let days=rule.weekdays;for(const phase of [...phases].sort((a,b)=>a.from.localeCompare(b.from)))if(key>=phase.from)days=phase.weekdays;
   const release=weekly?days.includes(day.getUTCDay()):true;
   if(release)for(let n=0;n<episodesPerRelease&&dates.length<totalEpisodes;n++)dates.push(key);
   day.setUTCDate(day.getUTCDate()+(weekly?1:intervalDays));
  }
  return dates.map((date,i)=>({id:`${drama.id}:${rule.id}:${i+1}`,dramaId:drama.id,ruleId:rule.id,episode:i+1,platformId:rule.platformId,date,time:rule.time,timezone:rule.timezone,confidence:i===0?'confirmed':'calculated',status:'scheduled'}));
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
