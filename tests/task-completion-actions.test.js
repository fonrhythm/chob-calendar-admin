import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionValue, completionPatch, completionRequest, utcVersion } from '../src/lib/task-completion-actions.js';
test('completion options retain legacy sold-out labels and explicitly clear old reasons on reopen', () => {
  assert.equal(completionValue({ is_closed: true, task_type: 'ticketing' }), 'sold_out');
  assert.equal(completionValue({ is_closed: true, task_type: 'shopping', closure_reason: 'results_published' }), 'results_published');
  assert.deepEqual(completionPatch('open'), { is_closed: false, closure_reason: '' });
  assert.deepEqual(completionPatch('results_published'), { is_closed: true, closure_reason: 'results_published' });
  assert.throws(() => completionPatch('event_ended'));
});
test('quick changes require matching parent and both exact UTC concurrency versions', () => {
  const task = { id: 'task', event_id: 'event', updated_at: '2026-10-21T10:20:30.123456' };
  const event = { id: 'event', updated_at: '2026-10-21 10:20:30.654321' };
  assert.deepEqual(completionRequest(task, event, 'sold_out'), { target: 'task', next_state: 'sold_out', expected_task_version: '2026-10-21T10:20:30.123456Z', expected_event_version: '2026-10-21T10:20:30.654321Z' });
  assert.equal(utcVersion('2026-10-21T10:20:30.123456+00'), '2026-10-21T10:20:30.123456+00:00');
  assert.throws(() => completionRequest(task, { ...event, id: 'other' }, 'ended'));
  assert.throws(() => completionRequest({ ...task, updated_at: null }, event, 'ended'));
});
