export const ACTIVITY_TYPES = [
  { id: 'interaction', name: '见面互动' },
  { id: 'music', name: '音乐演出' },
  { id: 'brand', name: '品牌商务' },
  { id: 'screen', name: '影视宣传' },
  { id: 'broadcast', name: '节目／直播' },
  { id: 'other', name: '其他' },
];
export function activityCategory(value) {
  const v = String(value || '').toLowerCase();
  if (ACTIVITY_TYPES.some((t) => t.id === v)) return v;
  if (/见面|互动|签售|粉丝|fan.?meet|fan.?sign/.test(v)) return 'interaction';
  if (/音乐|演唱|演出|音乐节|concert|festival|livehouse|stage/.test(v))
    return 'music';
  if (/品牌|商务|站台|代言|brand/.test(v)) return 'brand';
  if (/影视|剧集|电影|首映|series|screen|premiere/.test(v)) return 'screen';
  if (/节目|直播|广播|电台|broadcast|live|radio|综艺/.test(v))
    return 'broadcast';
  return 'other';
}
