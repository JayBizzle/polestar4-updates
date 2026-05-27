const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScrape } = require('../lib/scraper');

const existing = { meta: { page_version_count: 17 } };
const ok = Array.from({ length: 17 }, (_, i) => ({ version: 'v' + i, notes: ['n'] }));

test('passes a healthy scrape', () => {
  assert.doesNotThrow(() => validateScrape(ok, existing));
});

test('throws on zero versions', () => {
  assert.throws(() => validateScrape([], existing), /no versions/i);
});

test('throws when any version has empty notes', () => {
  assert.throws(() => validateScrape([{ version: 'v1', notes: [] }], existing), /empty notes/i);
});

test('throws on a sharp drop vs last successful scrape', () => {
  const few = Array.from({ length: 5 }, (_, i) => ({ version: 'v' + i, notes: ['n'] }));
  assert.throws(() => validateScrape(few, existing), /dropped/i); // 5 < floor(17/2)=8
});

test('tolerates minor pruning (no sharp drop)', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => ({ version: 'v' + i, notes: ['n'] }));
  assert.doesNotThrow(() => validateScrape(eleven, existing)); // 11 >= 8
});

test('skips drop check on first run (no stored count)', () => {
  const two = [{ version: 'a', notes: ['n'] }, { version: 'b', notes: ['n'] }];
  assert.doesNotThrow(() => validateScrape(two, { meta: {} }));
});
