const DAY = 86400000;
const manualReasons = ['sold_out', 'results_published', 'ended'];
const allReasons = [...manualReasons, 'event_ended', 'task_ended', 'event_cancelled'];
const open = () => ({ closed: false, reason: '', at: null });
const moment = value => typeof value?.getTime === 'function' ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : '';
}
function clock(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) return null;
  return (+match[1] * 3600 + +match[2] * 60 + +(match[3] || 0)) * 1000;
}
function deadline(date, time) {
  const day = dateOnly(date);
  if (!day) return null;
  return Date.parse(day + 'T00:00:00+07:00') + (clock(time) ?? DAY);
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function status(event) {
  return String(event?.event_status || event?.attributes?.event_status || event?.status || '').toLowerCase();
}
function postponed(event) {
  return ['postponed', 'postpone', '已延期', '延期'].includes(status(event));
}
function postponedDate(event) {
  return dateOnly(event?.postponed_to_date || event?.attributes?.postponed_to_date);
}
function datePending(event) {
  return !postponedDate(event) && (postponed(event) || ['tba', 'missing'].includes(event?.field_states?.date || event?.attributes?.field_states?.date));
}
function cancelled(event) {
  return !!(event?.cancelled_at || event?.attributes?.cancelled_at)
    || ['cancelled', 'canceled', '已取消', '取消'].includes(status(event));
}
function timedState(at, reason, now) {
  const closed = Number.isFinite(at) && moment(now) >= at;
  return { closed, reason: closed ? reason : '',
    at: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

// All deadline boundaries use Bangkok time, independently of the viewer's device.
export function eventCompletion(event, now = Date.now()) {
  if (!event) return open();
  if (cancelled(event)) return { closed: true, reason: 'event_cancelled', at: null };
  // A postponed record's original date does not establish when it will end.
  if (datePending(event)) return open();
  const eventDate = postponedDate(event) || dateOnly(event.date);
  if (!eventDate) return open();
  const finalDate = dateOnly(event.end_date || event.attributes?.end_date);
  const endDate = finalDate && finalDate >= eventDate ? finalDate : eventDate;
  // Event times describe a start, not a reliable finishing time. Events close
  // only after their final Bangkok calendar day, matching the public feed.
  const at = deadline(endDate, '');
  return at === null ? open() : timedState(at, 'event_ended', now);
}

export function taskCompletion(task, parent = null, now = Date.now()) {
  if (!task) return open();
  const reason = allReasons.includes(task.closure_reason) ? task.closure_reason : task.task_type === 'ticketing' ? 'sold_out' : 'ended';
  if (task.is_closed === true) return { closed: true, reason, at: null };
  if ((parent && cancelled(parent)) || cancelled(task)) return { closed: true, reason: 'event_cancelled', at: null };
  const candidates = [];
  const autoAt = timestamp(task.auto_close_at);
  const autoReason = ['event_ended', 'task_ended'].includes(task.auto_close_reason) ? task.auto_close_reason : 'task_ended';
  const parentStatus = parent || task;
  if (autoAt !== null && !(autoReason === 'event_ended' && datePending(parentStatus))) candidates.push({ at: autoAt, reason: autoReason });
  const ownDate = task.end_date || (task.task_type === 'ticketing' ? '' : task.date || task.start_date);
  const ownAt = deadline(ownDate, task.end_time);
  if (ownAt !== null) candidates.push({ at: ownAt, reason: 'task_ended' });
  if (parent) {
    const parentState = eventCompletion(parent, now);
    const parentAt = timestamp(parentState.at);
    if (parentAt !== null) candidates.push({ at: parentAt, reason: 'event_ended' });
  }
  candidates.sort((a, b) => a.at - b.at || (a.reason === 'event_ended' ? -1 : b.reason === 'event_ended' ? 1 : 0));
  return candidates.length ? timedState(candidates[0].at, candidates[0].reason, now) : open();
}

export function completionLabel(value) {
  const reason = typeof value === 'string' ? value : value?.reason;
  return ({ sold_out: '已售罄', results_published: '已出名单', ended: '已结束',
    event_ended: '活动已结束', task_ended: '已截止', event_cancelled: '活动已取消' })[reason] || '';
}

export function isPendingItem(record, records = [], now = Date.now()) {
  if (!record) return false;
  const parent = record.kind === 'task' ? records.find(row => row.kind !== 'task' && row.id === record.event_id) : null;
  return !(record.kind === 'task' ? taskCompletion(record, parent, now) : eventCompletion(record, now)).closed;
}
