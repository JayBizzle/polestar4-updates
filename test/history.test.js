const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateHistory, HEADER } = require('../lib/history');

test('first entry creates the header', () => {
  const out = updateHistory(null, '2026-07-09', [{ version: 'P4.3.0', notes: ['Note one', 'Note two'] }]);
  assert.ok(out.startsWith('# Polestar 4 update history'));
  assert.match(out, /^## 2026-07-09 — New version P4\.3\.0$/m);
  assert.match(out, /- Note one\n- Note two/);
});

test('no events returns existing content unchanged (or a bare header)', () => {
  const existing = updateHistory(null, '2026-07-09', [{ version: 'P4.3.0', notes: ['n'] }]);
  assert.equal(updateHistory(existing, '2026-07-10'), existing);
  assert.equal(updateHistory(null, '2026-07-10'), HEADER);
  assert.equal(updateHistory('', '2026-07-10'), HEADER);
});

test('new entries are prepended above older ones, below the header', () => {
  const day1 = updateHistory(null, '2026-07-09', [{ version: 'P4.3.0', notes: ['old note'] }]);
  const day2 = updateHistory(day1, '2026-07-10', [{ version: 'P4.3.1', notes: ['new note'] }]);
  const headings = day2.split('\n').filter(l => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## 2026-07-10 — New version P4.3.1',
    '## 2026-07-09 — New version P4.3.0',
  ]);
  assert.ok(day2.startsWith('# Polestar 4 update history'));
  assert.ok(day2.includes('old note'), 'older entries are preserved verbatim');
});

test('notes edit renders a +/- diff fence', () => {
  const out = updateHistory(null, '2026-07-09', [], [
    { version: 'P4.2.13', added: ['Added note'], removed: ['Removed note'] },
  ]);
  assert.match(out, /^## 2026-07-09 — Notes edited: P4\.2\.13$/m);
  assert.match(out, /```diff\n\+ Added note\n- Removed note\n```/);
});

test('a run with both events lists new versions before edits', () => {
  const out = updateHistory(null, '2026-07-09',
    [{ version: 'P4.3.0', notes: ['n'] }],
    [{ version: 'P4.2.13', added: ['a'], removed: [] }]);
  const headings = out.split('\n').filter(l => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## 2026-07-09 — New version P4.3.0',
    '## 2026-07-09 — Notes edited: P4.2.13',
  ]);
});

test('extra intro prose above the first entry survives updates', () => {
  const seeded = updateHistory(null, '2026-07-09', [{ version: 'P4.3.0', notes: ['n'] }])
    .replace('do not edit by hand.\n', 'do not edit by hand.\n\nBackfill note.\n');
  const out = updateHistory(seeded, '2026-07-10', [{ version: 'P4.3.1', notes: ['m'] }]);
  assert.ok(out.indexOf('Backfill note.') < out.indexOf('## 2026-07-10'),
    'intro stays above the newest entry');
});
