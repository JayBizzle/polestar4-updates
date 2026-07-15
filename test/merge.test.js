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

test('notesChanged reports added/removed lines for an edited existing version', () => {
  const scraped = [
    { version: 'P4.2.11', notes: ['old note', 'a new line'] },  // 'a new line' added
    { version: 'PC4.1.3', notes: [] },                          // 'legacy' removed
  ];
  const { notesChanged } = mergeData(base(), scraped, '2026-05-27');
  const byVersion = Object.fromEntries(notesChanged.map(c => [c.version, c]));
  assert.deepEqual(byVersion['P4.2.11'], { version: 'P4.2.11', added: ['a new line'], removed: [] });
  assert.deepEqual(byVersion['PC4.1.3'], { version: 'PC4.1.3', added: [], removed: ['legacy'] });
});

test('notesChanged excludes new versions and unchanged ones', () => {
  const scraped = [
    { version: 'P4.2.12', notes: ['brand new'] },      // new -> newVersions, not notesChanged
    { version: 'P4.2.11', notes: ['old note'] },       // identical -> not reported
    { version: 'PC4.1.3', notes: ['legacy'] },         // identical -> not reported
  ];
  const { notesChanged, newVersions } = mergeData(base(), scraped, '2026-05-27');
  assert.deepEqual(newVersions, ['P4.2.12']);
  assert.deepEqual(notesChanged, []);
});

test('a pure reorder of notes is not counted as a changelog change', () => {
  const existing = base();
  existing.updates[0].notes = ['one', 'two'];
  const scraped = [
    { version: 'P4.2.11', notes: ['two', 'one'] },     // same set, different order
    { version: 'PC4.1.3', notes: ['legacy'] },
  ];
  const { notesChanged } = mergeData(existing, scraped, '2026-05-27');
  assert.deepEqual(notesChanged, []);
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

test('prerelease: versions absent from websiteVersions are flagged, present ones are not', () => {
  const scraped = [
    { version: 'P4.2.12', notes: ['brand new'] },   // not on site -> prerelease
    { version: 'P4.2.11', notes: ['old note'] },     // on site -> official
    { version: 'PC4.1.3', notes: ['legacy'] },       // on site -> official
  ];
  const site = new Set(['P4.2.11', 'PC4.1.3']);
  const { data, newVersions } = mergeData(base(), scraped, '2026-05-27', undefined, site);
  assert.equal(data.updates.find(u => u.version === 'P4.2.12').prerelease, true);
  assert.ok(!('prerelease' in data.updates.find(u => u.version === 'P4.2.11')));
  assert.deepEqual(newVersions, ['P4.2.12']);
});

test('prerelease: a flip from prerelease to official is reported as a change', () => {
  const existing = base();
  existing.updates[0].prerelease = true;             // P4.2.11 currently prerelease
  const scraped = [{ version: 'P4.2.11', notes: ['old note'] }, { version: 'PC4.1.3', notes: ['legacy'] }];
  const { data, changed } = mergeData(existing, scraped, '2026-05-27', undefined, new Set(['P4.2.11', 'PC4.1.3']));
  assert.ok(!('prerelease' in data.updates.find(u => u.version === 'P4.2.11')));
  assert.equal(changed, true);
});

test('prerelease: without websiteVersions, stored flags are preserved and new versions are conservative', () => {
  const existing = base();
  existing.updates[0].prerelease = true;             // P4.2.11 stays prerelease (no site data to clear it)
  const scraped = [
    { version: 'P4.2.12', notes: ['brand new'] },    // new + unverifiable -> prerelease
    { version: 'P4.2.11', notes: ['old note'] },
    { version: 'PC4.1.3', notes: ['legacy'] },
  ];
  const { data, changed } = mergeData(existing, scraped, '2026-05-27');   // no websiteVersions
  assert.equal(data.updates.find(u => u.version === 'P4.2.11').prerelease, true);
  assert.equal(data.updates.find(u => u.version === 'P4.2.12').prerelease, true);
  // P4.2.11 flag preserved, only P4.2.12 added -> changed because of the new version
  assert.equal(changed, true);
});

test('upcomingChanged reports added, removed and relabelled builds', () => {
  const existing = base();
  existing.meta.upcoming = [
    { version: '4.3', internal_version: 26170 },
    { version: '0.0.0', internal_version: 26300 },
  ];
  const next = [
    { version: '4.2.15', internal_version: 26161 },   // brand-new build
    { version: null, internal_version: 26170 },       // 26170 lost its "4.3" label
    { version: '0.0.0', internal_version: 26300 },    // unchanged
  ];
  const { changed, upcomingChanged } = mergeData(existing, NOOP_SCRAPE, '2026-07-06', next);
  assert.equal(changed, true);
  assert.deepEqual(upcomingChanged.added, [
    { version: '4.2.15', internal_version: 26161 },
    { version: null, internal_version: 26170 },
  ]);
  assert.deepEqual(upcomingChanged.removed, [{ version: '4.3', internal_version: 26170 }]);
});

test('upcomingChanged is empty on an identical or omitted upcoming list', () => {
  const existing = base();
  existing.meta.upcoming = [{ version: '4.3', internal_version: 26170 }];
  const same = mergeData(existing, NOOP_SCRAPE, '2026-05-27', [{ version: '4.3', internal_version: 26170 }]);
  assert.deepEqual(same.upcomingChanged, { added: [], removed: [] });
  const omitted = mergeData(existing, NOOP_SCRAPE, '2026-05-27');
  assert.deepEqual(omitted.upcomingChanged, { added: [], removed: [] });
});

test('releasedVersions reports a prerelease -> official flip', () => {
  const existing = base();
  existing.updates[0].prerelease = true;               // P4.2.11 currently prerelease
  const site = new Set(['P4.2.11', 'PC4.1.3']);        // ...and now on the public page
  const { releasedVersions, changed } = mergeData(existing, NOOP_SCRAPE, '2026-05-27', undefined, site);
  assert.deepEqual(releasedVersions, ['P4.2.11']);
  assert.equal(changed, true);
});

test('releasedVersions excludes new versions and is empty without websiteVersions', () => {
  const existing = base();
  existing.updates[0].prerelease = true;
  // no website data -> stored flag preserved, no flip reported
  const noSite = mergeData(existing, NOOP_SCRAPE, '2026-05-27');
  assert.deepEqual(noSite.releasedVersions, []);
  // a brand-new version that is immediately official is a new version, not a flip
  const scraped = [{ version: 'P4.2.12', notes: ['brand new'] }, ...NOOP_SCRAPE];
  const withSite = mergeData(base(), scraped, '2026-05-27', undefined, new Set(['P4.2.12', 'P4.2.11', 'PC4.1.3']));
  assert.deepEqual(withSite.releasedVersions, []);
  assert.deepEqual(withSite.newVersions, ['P4.2.12']);
});

test('omitted upcoming preserves the stored list without reporting a change', () => {
  const existing = base();
  existing.meta.upcoming = [{ version: '4.3', internal_version: 26170 }];
  const { data, changed } = mergeData(existing, NOOP_SCRAPE, '2026-05-27');
  assert.deepEqual(data.meta.upcoming, [{ version: '4.3', internal_version: 26170 }]);
  assert.equal(changed, false);
});

test('market_specific is carried from the scrape onto merged versions', () => {
  const scraped = [
    { version: 'P4.2.11', notes: ['n1', 'n2'], market_specific: ['n2'] },
    { version: 'PC4.1.3', notes: ['legacy'] },   // none flagged
  ];
  const { data } = mergeData(base(), scraped, '2026-05-27');
  assert.deepEqual(data.updates.find(u => u.version === 'P4.2.11').market_specific, ['n2']);
  assert.ok(!('market_specific' in data.updates.find(u => u.version === 'PC4.1.3')));
});

test('a market_specific flip alone marks the file changed', () => {
  // baseline run: notes match, nothing flagged -> no-op
  const first = mergeData(base(), NOOP_SCRAPE, '2026-05-27');
  assert.equal(first.changed, false);
  // same notes, but a note becomes market-specific -> must churn the file
  const flagged = [
    { version: 'P4.2.11', notes: ['old note'], market_specific: ['old note'] },
    { version: 'PC4.1.3', notes: ['legacy'] },
  ];
  const { changed } = mergeData(first.data, flagged, '2026-05-28');
  assert.equal(changed, true);
});
