export function publishTimestamp(value) {
  const date = new Date(value);
  if (
    !value ||
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= Date.now()
  )
    throw Error('请选择晚于当前时间的发布时间');
  return date.toISOString();
}
export const localDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
