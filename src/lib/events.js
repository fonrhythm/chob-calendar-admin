import { supabase } from '@/config/supabase';
import { allRows } from './api';
import { validateEvent } from './event-fields.js';

export const EVENT_STATUSES = {
  draft: '草稿',
  published: '已发布',
  withdrawn: '已撤回',
};
export async function loadEventWorkspace() {
  const [events, tasks, artists, types, conditions, pairs] = await Promise.all([
    allRows('events'),
    allRows('tasks'),
    allRows('artists'),
    allRows('event_type_definitions'),
    allRows('participation_conditions'),
    allRows('cp_pairs'),
  ]);
  return { deletedEvents: events.filter((event) => event.attributes?.admin_deleted_at), events: events.filter((event) => !event.attributes?.admin_deleted_at), tasks, artists, types, conditions, pairs };
}
export function newEvent() {
  return {
    id: crypto.randomUUID(),
    title: '',
    date: '',
    time: '',
    location: '',
    location_region: '',
    company: '',
    artist_ids: [],
    event_type_id: '',
    participation_condition: '',
    description: '',
    ticket_url: '',
    status: 'draft',
    attributes: {},
    updated_at: null,
  };
}
export async function saveEventWithTasks(event, tasks, notice = null) {
  const problem = validateEvent(event, tasks);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc(
    notice ? 'chob_save_event_with_notice' : 'chob_save_event_bundle_v2',
    {
      ...(notice ? { notice_payload: notice } : {}),
      payload: event,
      task_payload: tasks,
      expected_updated_at: event.updated_at || null,
    },
  );
  if (error) {
    if (error.code === 'PGRST202')
      throw new Error(
        '请先在 Supabase 执行 015_scheduling_import_drafts.sql，再重新保存。',
      );
    throw new Error(error.message);
  }
  return data;
}
export async function importEventBundles(bundles, mode = 'draft') {
  const { data, error } = await supabase.rpc('chob_import_event_bundles_v2', {
    bundles,
    publish_now: mode === 'published',
  });
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? '请先执行 017_event_bulk_management.sql，再导入。'
        : error.message,
    );
  return data;
}
export async function manageEvents(ids, operation) {
  const { data, error } = await supabase.rpc('chob_manage_events', {
    event_ids: ids,
    operation,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? '请先执行 017_event_bulk_management.sql。' : error.message);
  return data;
}
