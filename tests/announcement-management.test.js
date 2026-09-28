import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateNoticeGroups, recentNotices } from '../src/lib/announcement-management.js';

test('near-identical public announcements are suggested for consolidation', () => {
  const older = { id: 'one', title: 'LIVE WINONA PROBIO X PIEGOLF变动', body: '新日期待公布', published: true, created_at: '2026-09-27T00:00:00Z' };
  const newer = { id: 'two', title: 'LIVE WINONA PROBIO X PIE GOLF变动', body: '新日期待公布', published: true, created_at: '2026-09-28T00:00:00Z' };
  const different = { id: 'three', title: newer.title, body: '新日期已公布', published: true, created_at: '2026-09-29T00:00:00Z' };
  const hidden = { ...older, id: 'four', published: false };
  assert.deepEqual(duplicateNoticeGroups([older, different, hidden, newer]).map((g) => g.map((n) => n.id)), [['two', 'one']]);
  assert.deepEqual(recentNotices([older, newer]).map((n) => n.id), ['two', 'one']);
});
