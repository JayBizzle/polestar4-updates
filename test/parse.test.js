const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseUpdates, pickContent, upcomingVersions } = require('../lib/scraper');

const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/release-notes-en-GB.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/release-notes-manifest.json'), 'utf8'));
const models = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/available-car-models.json'), 'utf8'));
const updates = parseUpdates(content);
const byVersion = Object.fromEntries(updates.map(u => [u.version, u]));

test('parses all 17 versions in document order (newest first)', () => {
  assert.deepEqual(updates.map(u => u.version), [
    'P4.2.11','P4.2.10','P4.2.9','P4.2.8','P4.2.7','P4.2.6','P4.2.5',
    'P4.2.4','P4.2.3','P4.2.2','P4.2.1','4.1.11','4.1.10','4.1.9',
    'Polestar OS4.1.7','PC4.1.5','PC4.1.3',
  ]);
});

test('every version has at least one note', () => {
  for (const u of updates) assert.ok(u.notes.length >= 1, `${u.version} has no notes`);
});

test('version labels come from segment titles, not the softwareVersion field', () => {
  // The document's softwareVersion fields say "4.1.7"/"4.1.5", but the titles —
  // and the historical data.json keys the date invariant relies on — use these
  // exact labels.
  assert.ok(byVersion['Polestar OS4.1.7']);
  assert.ok(byVersion['PC4.1.5']);
});

test('single-paragraph version parses exactly', () => {
  assert.deepEqual(byVersion['P4.2.11'].notes, [
    'This software update provides general improvements and compatibility updates. It includes the software content released in all previous updates.',
  ]);
});

test('nested sub-bullets are flattened into separate notes', () => {
  // P4.2.10: the battery pre-conditioning bullet has nested sub-bullets that
  // must appear as their own notes, directly after their parent.
  const notes = byVersion['P4.2.10'].notes;
  const parent = notes.indexOf('Improvements to battery pre-conditioning, including the system now acting more dynamically, allowing the conditioning to start earlier and reach a higher temperature improving overall charging performance');
  const child = notes.indexOf('To start the pre-conditioning it is required to set a DC fast charger (>70 kW) as the destination in the built-in Google Maps app and ensure the estimated state of charge when arriving is kept above 7%');
  assert.ok(parent !== -1 && child === parent + 1, 'sub-bullet must directly follow its parent');
});

test('listIntro lines become their own notes', () => {
  assert.ok(byVersion['P4.2.10'].notes.includes('ADAS improvements'));
});

test('footnote nodes are stripped from note text', () => {
  // P4.2.3's first note ends with a footnote node; the note text must end
  // cleanly without the marker or inserted whitespace.
  assert.equal(
    byVersion['P4.2.3'].notes[0],
    'Enabling Digital Key functionality for Apple devices for all markets.'
  );
  // The 4.2.7 market footnote text must not leak into any note.
  for (const u of updates) {
    assert.ok(!u.notes.some(n => n.includes('United Arab Emirates')), `${u.version} leaks footnote text`);
  }
});

test('a version spanning several segments dedupes repeated lines', () => {
  // P4.2.1 appears in two segments sharing four identical bullets.
  for (const u of updates) {
    assert.equal(new Set(u.notes).size, u.notes.length, `${u.version} has duplicate notes`);
  }
  assert.equal(byVersion['P4.2.1'].notes.length, 16);
});

test('general disclaimer segments before the first version are ignored', () => {
  for (const u of updates) {
    assert.ok(!u.notes.some(n => n.startsWith('Functionality after updating may vary')),
      `${u.version} contains intro disclaimer text`);
  }
});

test('pickContent finds the en-GB entry and rejects unknown languages', () => {
  const entry = pickContent(manifest);
  assert.equal(entry.language, 'en-GB');
  assert.match(entry.relativeUrl, /^api\/car-content\/downloads\/content\//);
  assert.throws(() => pickContent(manifest, 'xx-XX'), /No xx-XX content/);
});

test('upcomingVersions returns registered builds above the published max', () => {
  const upcoming = upcomingVersions(models, manifest.spaceSoftwareVersion);
  assert.deepEqual(upcoming, [
    { version: '4.2.12', internal_version: 26150 },
    { version: '4.3', internal_version: 26170 },
    { version: '0.0.0', internal_version: 26300 },
  ]);
  assert.deepEqual(upcomingVersions(models, undefined), []);
  assert.deepEqual(upcomingVersions([], 26120), []);
});
