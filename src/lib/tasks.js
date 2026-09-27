export const TASK_TYPES = [
  { value: 'shopping', label: '消费' },
  { value: 'registration', label: '填表' },
  { value: 'ticketing', label: '开票' },
  { value: 'other', label: '其他' },
];
export function taskCategory(value) {
  return (
    {
      shopping: 'shopping',
      消费: 'shopping',
      购物: 'shopping',
      registration: 'registration',
      填表: 'registration',
      报名: 'registration',
      ticketing: 'ticketing',
      开票: 'ticketing',
      购票: 'ticketing',
      booking: 'other',
      notification: 'other',
      other: 'other',
    }[value] || 'other'
  );
}
export const taskLabel = (value) =>
  TASK_TYPES.find((t) => t.value === taskCategory(value))?.label || value;
export function bangkokDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function taskActiveOn(task, date) {
  return (
    task.status === 'published' &&
    !!task.start_date &&
    !!task.end_date &&
    task.start_date <= date &&
    task.end_date >= date
  );
}
export function compareTasks(a, b) {
  const priority = (value) => {
    const n = TASK_TYPES.findIndex((t) => t.value === taskCategory(value));
    return n < 0 ? 99 : n;
  };
  return (
    priority(a.task_type) - priority(b.task_type) ||
    `${a.end_date || '9999'}T${a.end_time || '23:59:59'}`.localeCompare(
      `${b.end_date || '9999'}T${b.end_time || '23:59:59'}`,
    ) ||
    String(a.id).localeCompare(String(b.id))
  );
}
export function newTask() {
  return {
    id: crypto.randomUUID(),
    title: '',
    task_type: 'other',
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    action_url: '',
    description: '',
    status: 'draft',
  };
}
export function safeWebUrl(value) {
  if (!value) return true;
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function validateTasks(tasks) {
  for (const [i, task] of tasks.entries()) {
    const prefix = `事项 ${i + 1}：`;
    if (!task.title?.trim()) return prefix + '请填写标题。';
    if (
      ![
        'shopping',
        'registration',
        'ticketing',
        'other',
        'booking',
        'notification',
      ].includes(task.task_type)
    )
      return prefix + '请选择分类。';
    if (!['draft', 'published', 'withdrawn'].includes(task.status))
      return prefix + '发布状态无效。';
    if (task.status === 'published' && (!task.start_date || !task.end_date))
      return prefix + '发布前请填写开始和结束日期。';
    if (
      (task.start_time && !task.start_date) ||
      (task.end_time && !task.end_date)
    )
      return prefix + '填写时间时必须填写对应日期。';
    if (task.start_date && task.end_date && task.end_date < task.start_date)
      return prefix + '结束日期不能早于开始日期。';
    if (
      task.start_date &&
      task.start_date === task.end_date &&
      (task.start_time || '00:00') > (task.end_time || '23:59:59')
    )
      return prefix + '结束时间不能早于开始时间。';
    if (!safeWebUrl(task.action_url))
      return prefix + '链接必须是完整的 http:// 或 https:// 地址。';
  }
  return '';
}
