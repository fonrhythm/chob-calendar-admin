import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSortEvents } from '../src/lib/event-fields.js';
import { bangkokDate } from '../src/lib/tasks.js';

const row = (id, date, status = 'published') => ({ id, date, status, title: id, artist_ids: [] });
const undated = [row('draft-b', null, 'draft'), row('draft-a', '', 'draft'), row('draft-c', undefined, 'draft')];

test('default activity list supports missing dates and preserves upcoming/past ordering', () => {
  const events = [undated[0], row('old', '2000-01-01'), row('future-later', '2099-12-01'),
    undated[1], row('today', bangkokDate()), row('recent', '2001-01-01'),
    row('future', '2099-01-01'), undated[2]];
  assert.deepEqual(filterSortEvents(events, [], [], {}).map(e => e.id),
    ['today', 'future', 'future-later', 'recent', 'old', 'draft-a', 'draft-b', 'draft-c']);
});

test('draft filter includes undated records; past filter excludes missing dates', () => {
  const events = [row('old', '2000-01-01'), ...undated];
  assert.deepEqual(filterSortEvents(events, [], [], { status: 'draft' }).map(e => e.id),
    ['draft-a', 'draft-b', 'draft-c']);
  assert.deepEqual(filterSortEvents(events, [], [], { status: 'past' }).map(e => e.id), ['old']);
});

test('both date sorting directions place missing dates after dated activities', () => {
  const events = [...undated, row('earlier', '2026-10-01'), row('later', '2026-10-09')];
  for (const sort of ['date-asc', 'date-desc']) {
    const result = filterSortEvents(events, [], [], { sort });
    assert.deepEqual(result.slice(0, 2).map(e => e.id),
      sort === 'date-asc' ? ['earlier', 'later'] : ['later', 'earlier']);
    assert.equal(result.slice(2).every(e => !e.date), true);
  }
});
