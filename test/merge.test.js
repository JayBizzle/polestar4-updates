const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeData } = require('../lib/scraper');

const API = 'https://support-car-content.polestar.volvo.care/api/car-content/SOFTWARE_RELEASE_NOTES/814/UNTIL/99.0.0';

function base() {
  return {
    meta: { authoritative_source: 'OLD', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 2 },
    updates: [
      { version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['old note'] },
      { version: 'PC4.1.3', release_date: null, date_estimated: false, notes: ['legacy'] },
    ],
  };
}

test('INVARIANT: existing dates are never modified', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['old note'] }, { version: 'PC4.1.3', notes: ['legacy'] }];
  const { data } = mergeData(base(), scraped, '2099-12-31');
  const p = data.updates.find(u => u.version === 'P4.2.11');
  assert.equal(p.release_date, '2026-03-24');     // unchanged despite runDate
  assert.equal(p.date_estimated, false);
  assert.equal(data.updates.find(u => u.version === 'PC4.1.3').release_date, null);
});

test('notes refresh when scraped text differs', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['new note'] }, { version: 'PC4.1.3', notes: ['legacy'] }];
  const { data, changed } = mergeData(base(), scraped, '2026-05-27');
  assert.deepEqual(data.updates.find(u => u.version === 'P4.2.11').notes, ['new note']);
  assert.equal(changed, true);
});

test('new version gets the run date and is reported', () => {
  const scraped = [
    { version: 'P4.2.12', notes: ['brand new'] },
    { version: 'P4.2.11', notes: ['old note'] },
    { version: 'PC4.1.3', notes: ['legacy'] },
  ];
  const { data, changed, newVersions } = mergeData(base(), scraped, '2026-05-27');
  const v = data.updates.find(u => u.version === 'P4.2.12');
  assert.equal(v.release_date, '2026-05-27');
  assert.equal(v.date_estimated, false);
  assert.deepEqual(newVersions, ['P4.2.12']);
  assert.equal(changed, true);
});

test('identical scrape reports no change', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['old note'] }, { version: 'PC4.1.3', notes: ['legacy'] }];
  const { changed, newVersions } = mergeData(base(), scraped, '2026-05-27');
  assert.equal(changed, false);
  assert.deepEqual(newVersions, []);
});

test('stored version absent from scrape is preserved (never deleted)', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['old note'] }]; // PC4.1.3 missing from page
  const { data } = mergeData(base(), scraped, '2026-05-27');
  assert.ok(data.updates.some(u => u.version === 'PC4.1.3'));
});

test('preserved entry keeps its full original shape', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['old note'] }]; // PC4.1.3 missing from page
  const { data } = mergeData(base(), scraped, '2026-05-27');
  const preserved = data.updates.find(u => u.version === 'PC4.1.3');
  assert.deepEqual(preserved, { version: 'PC4.1.3', release_date: null, date_estimated: false, notes: ['legacy'] });
});

test('mergeData does not mutate the existing argument', () => {
  const existing = base();
  const snapshot = JSON.stringify(existing);
  const scraped = [
    { version: 'P4.2.12', notes: ['brand new'] },
    { version: 'P4.2.11', notes: ['updated note'] },
  ];
  mergeData(existing, scraped, '2026-05-27');
  assert.equal(JSON.stringify(existing), snapshot);
});

test('meta is refreshed', () => {
  const scraped = [{ version: 'P4.2.11', notes: ['x'] }, { version: 'PC4.1.3', notes: ['legacy'] }];
  const { data } = mergeData(base(), scraped, '2026-05-27');
  assert.equal(data.meta.scraped_on, '2026-05-27');
  assert.equal(data.meta.authoritative_source, API);
  assert.equal(data.meta.page_version_count, 2);
  assert.equal(data.meta.total_versions, 2);
});

const NOOP_SCRAPE = [
  { version: 'P4.2.11', notes: ['old note'] },
  { version: 'PC4.1.3', notes: ['legacy'] },
];

test('upcoming list is stored in meta and a change to it is reported', () => {
  const upcoming = [{ version: '4.3', internal_version: 26170 }];
  const { data, changed } = mergeData(base(), NOOP_SCRAPE, '2026-05-27', upcoming);
  assert.deepEqual(data.meta.upcoming, upcoming);
  assert.equal(changed, true); // base() has no upcoming list yet

  // Same upcoming list again -> no change.
  const second = mergeData(data, NOOP_SCRAPE, '2026-05-28', upcoming);
  assert.equal(second.changed, false);

  // Upcoming list emptied (notes published) -> change.
  const third = mergeData(data, NOOP_SCRAPE, '2026-05-29', []);
  assert.equal(third.changed, true);
  assert.deepEqual(third.data.meta.upcoming, []);
});

test('internal_version is added when scraped, kept when the scrape lacks it', () => {
  // scrape provides a build number -> stored, reported as a change
  const withBuild = [
    { version: 'P4.2.11', notes: ['old note'], internal_version: 26120 },
    { version: 'PC4.1.3', notes: ['legacy'] },
  ];
  const first = mergeData(base(), withBuild, '2026-05-27');
  assert.equal(first.data.updates.find(u => u.version === 'P4.2.11').internal_version, 26120);
  assert.ok(!('internal_version' in first.data.updates.find(u => u.version === 'PC4.1.3')));
  assert.equal(first.changed, true);
  // a later scrape without build numbers (offline/models outage) keeps it, no change
  const second = mergeData(first.data, NOOP_SCRAPE, '2026-05-28');
  assert.equal(second.data.updates.find(u => u.version === 'P4.2.11').internal_version, 26120);
  assert.equal(second.changed, false);
});

test('omitted upcoming preserves the stored list without reporting a change', () => {
  const existing = base();
  existing.meta.upcoming = [{ version: '4.3', internal_version: 26170 }];
  const { data, changed } = mergeData(existing, NOOP_SCRAPE, '2026-05-27');
  assert.deepEqual(data.meta.upcoming, [{ version: '4.3', internal_version: 26170 }]);
  assert.equal(changed, false);
});
