export const COMPLETION_OPTIONS = [
  { value: 'open', label: '进行中' },
  { value: 'sold_out', label: '已售罄' },
  { value: 'results_published', label: '已出名单' },
  { value: 'ended', label: '已结束' },
];

export function completionValue(task) {
  if (!task?.is_closed) return 'open';
  return COMPLETION_OPTIONS.some(option => option.value === task.closure_reason && option.value !== 'open')
    ? task.closure_reason : task.task_type === 'ticketing' ? 'sold_out' : 'ended';
}

export function completionPatch(value) {
  if (!COMPLETION_OPTIONS.some(option => option.value === value)) throw Error('请选择有效的事项状态。');
  return { is_closed: value !== 'open', closure_reason: value === 'open' ? '' : value };
}

// PostgreSQL stores UTC timestamps without a zone here. Keep all fractional
// digits: Date.toISOString() would truncate the concurrency token to milliseconds.
export function utcVersion(value) {
  let text = String(value || '').trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)?$/i.test(text)) throw Error('版本信息缺失，请刷新后重试。');
  if (/[+-]\d{2}$/.test(text)) text += ':00';
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) text += 'Z';
  if (!Number.isFinite(Date.parse(text))) throw Error('版本信息无效，请刷新后重试。');
  return text;
}

export function completionRequest(task, event, value) {
  completionPatch(value);
  if (!task?.id || !event?.id || task.event_id !== event.id) throw Error('找不到所属活动，请刷新后重试。');
  return { target: task.id, next_state: value,
    expected_task_version: utcVersion(task.updated_at),
    expected_event_version: utcVersion(event.updated_at) };
}
