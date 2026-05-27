const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseUpdates } = require('../lib/scraper');

const html = fs.readFileSync(path.join(__dirname, 'fixtures/manual-uk.html'), 'utf8');
const updates = parseUpdates(html);
const byVersion = Object.fromEntries(updates.map(u => [u.version, u]));

test('parses all 17 versions in page order (newest first)', () => {
  assert.deepEqual(updates.map(u => u.version), [
    'P4.2.11','P4.2.10','P4.2.9','P4.2.8','P4.2.7','P4.2.6','P4.2.5',
    'P4.2.4','P4.2.3','P4.2.2','P4.2.1','4.1.11','4.1.10','4.1.9',
    'Polestar OS4.1.7','PC4.1.5','PC4.1.3',
  ]);
});

test('every version has at least one note', () => {
  for (const u of updates) assert.ok(u.notes.length >= 1, `${u.version} has no notes`);
});

test('single-paragraph version parses exactly', () => {
  assert.deepEqual(byVersion['P4.2.11'].notes, [
    'This software update provides general improvements and compatibility updates. It includes the software content released in all previous updates.',
  ]);
});

test('multi-note version under sub-headings parses exactly', () => {
  assert.deepEqual(byVersion['P4.2.8'].notes, [
    'The content of this software update is identical to P4.2.7.',
    'Compatibility update',
  ]);
});

test('nested sub-bullets are flattened into separate notes', () => {
  // P4.2.10: the battery pre-conditioning bullet has a nested sub-bullet that
  // must appear as its own note, not merged into its parent.
  assert.ok(byVersion['P4.2.10'].notes.includes(
    'To start the pre-conditioning it is required to set a DC fast charger (>70 kW) as the destination in the built-in Google Maps app and ensure the estimated state of charge when arriving is kept above 7%'
  ));
});

test('footnote superscript markers are stripped from note text', () => {
  // P4.2.3's first note contains a footnote anchor (<a data-dcs-type="footnote">)
  // with a superscript number. That number must not appear in the extracted text.
  assert.equal(
    byVersion['P4.2.3'].notes[0],
    'Enabling Digital Key functionality for Apple devices for all markets.'
  );
});
