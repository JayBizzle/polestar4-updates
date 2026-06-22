const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildFeed, rfc822 } = require('../lib/feed');

const sample = {
  meta: { title: 'Polestar 4 Software Updates', scraped_on: '2026-06-22' },
  updates: [
    { version: 'P4.2.13', release_date: '2026-06-22', date_estimated: false,
      notes: ['Plain note', 'Gated note <x> & "y"'], market_specific: ['Gated note <x> & "y"'] },
    { version: 'P4.2.14', release_date: '2026-06-17', date_estimated: false, prerelease: true,
      notes: ['Only-this-market note'], market_specific: ['Only-this-market note'] },
    { version: 'PC4.1.3', release_date: null, date_estimated: false, notes: ['Legacy, undated'] },
  ],
};

test('buildFeed emits one item per version, newest (by date) first', () => {
  const xml = buildFeed(sample);
  assert.equal((xml.match(/<item>/g) || []).length, 3);
  // P4.2.13 (2026-06-22) must precede P4.2.14 (2026-06-17) which precedes the null-dated PC4.1.3
  const order = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(m => m[1]);
  assert.deepEqual(order, ['polestar4-P4.2.13', 'polestar4-P4.2.14', 'polestar4-PC4.1.3']);
});

test('guids are stable and keyed on the version label', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /<guid isPermaLink="false">polestar4-P4\.2\.13<\/guid>/);
});

test('prereleases are kept but title-prefixed', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /<title>\[pre-release\] Polestar 4 P4\.2\.14<\/title>/);
  assert.match(xml, /<title>Polestar 4 P4\.2\.13<\/title>/);   // non-prerelease has no prefix
});

test('market-specific notes are marked inline; plain notes are not', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /Gated note[\s\S]*?<em>\(market-specific\)<\/em>/);
  // the plain note must not pick up the marker
  assert.ok(!/Plain note <em>\(market-specific\)/.test(xml));
});

test('note text is escaped inside the CDATA payload', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /Gated note &lt;x&gt; &amp; &quot;y&quot;/);
});

test('null release_date yields no pubDate; dated items carry RFC-822 pubDate', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /<pubDate>Mon, 22 Jun 2026 00:00:00 GMT<\/pubDate>/);
  // PC4.1.3 (null date) item has no pubDate — count pubDates == dated items (2)
  assert.equal((xml.match(/<pubDate>/g) || []).length, 2);
});

test('lastBuildDate derives from meta.scraped_on, not wall-clock', () => {
  const xml = buildFeed(sample);
  assert.match(xml, /<lastBuildDate>Mon, 22 Jun 2026 00:00:00 GMT<\/lastBuildDate>/);
});

test('rfc822 formats ISO dates and rejects null/invalid', () => {
  assert.equal(rfc822('2026-06-22'), 'Mon, 22 Jun 2026 00:00:00 GMT');
  assert.equal(rfc822(null), null);
  assert.equal(rfc822('not-a-date'), null);
});

test('the live data.json builds a feed with an item for every version', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const xml = buildFeed(data);
  assert.equal((xml.match(/<item>/g) || []).length, data.updates.length);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2\.0"/);
});
