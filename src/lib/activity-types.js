export const ACTIVITY_TYPES = [
  { id: 'music', name: '演出舞台' },
  { id: 'screen', name: '影视宣传' },
  { id: 'meet', name: '见面会/签售' },
  { id: 'press', name: '发布会/记者会' },
  { id: 'interaction', name: '站台活动' },
  { id: 'awards', name: '颁奖红毯' },
  { id: 'broadcast', name: '线上直播' },
  { id: 'other', name: '其他' },
];
export function activityCategory(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'brand') return 'interaction';
  if (ACTIVITY_TYPES.some((t) => t.id === v)) return v;
  if (/发布会|记者会|新闻发布|press.?conference/.test(v)) return 'press';
  if (/见面会|签售|fan.?meet|fan.?sign/.test(v)) return 'meet';
  if (/颁奖|红毯|award|red.?carpet/.test(v)) return 'awards';
  if (
    /互动|粉丝|品牌|商务|站台|代言|brand/.test(v)
  )
    return 'interaction';
  if (/音乐|演唱|演出|舞台|concert|festival|livehouse|stage/.test(v))
    return 'music';
  if (/影视|剧集|电影|首映|series|screen|premiere/.test(v)) return 'screen';
  if (/节目|直播|广播|电台|broadcast|live|radio|综艺/.test(v))
    return 'broadcast';
  return 'other';
}
