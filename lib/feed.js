/*
 * feed.js — build an RSS 2.0 feed from data.json. Pure: buildFeed(data) returns
 * the XML string; build.js writes it to feed.xml alongside index.html.
 *
 * One <item> per version, newest first, keyed by a STABLE guid (the version
 * label). A brand-new version is a new guid → readers flag it as new; a notes
 * refresh on an existing version updates that item in place without re-pinging
 * subscribers. Prereleases are included with a "[pre-release]" title prefix
 * (early signal is the point of a feed); market-specific notes are marked
 * inline. Item dates use release_date (RFC-822; omitted when null). lastBuildDate
 * comes from meta.scraped_on, NOT wall-clock, so feed.xml only changes when the
 * underlying data does.
 */

const SITE_URL = 'https://jaybizzle.github.io/polestar4-updates/';
const FEED_URL = SITE_URL + 'feed.xml';

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// YYYY-MM-DD -> RFC-822 ("Sun, 22 Jun 2026 00:00:00 GMT"); null/invalid -> null.
function rfc822(date) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

// CDATA-wrap HTML, neutralising any "]]>" so it can't close the section early.
const cdata = html => `<![CDATA[${String(html).replace(/]]>/g, ']]&gt;')}]]>`;

function itemDescription(u) {
  const ms = new Set(u.market_specific || []);
  const lis = (u.notes || []).map(n =>
    `<li>${esc(n)}${ms.has(n) ? ' <em>(market-specific)</em>' : ''}</li>`).join('');
  return `<ul>${lis}</ul>`;
}

function buildItem(u) {
  const title = (u.prerelease ? '[pre-release] ' : '') + `Polestar 4 ${u.version}`;
  const pub = rfc822(u.release_date);
  return [
    '    <item>',
    `      <title>${esc(title)}</title>`,
    `      <link>${esc(SITE_URL)}</link>`,
    `      <guid isPermaLink="false">polestar4-${esc(u.version)}</guid>`,
    ...(pub ? [`      <pubDate>${pub}</pubDate>`] : []),
    `      <description>${cdata(itemDescription(u))}</description>`,
    '    </item>',
  ].join('\n');
}

function buildFeed(data) {
  const meta = data.meta || {};
  // Newest first by release_date (ISO strings sort chronologically); null dates
  // sort last. Array.sort is stable, so equal dates keep data.json order.
  const items = [...(data.updates || [])]
    .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
    .map(buildItem)
    .join('\n');

  const built = rfc822(meta.scraped_on);
  const channel = [
    `<title>${esc(meta.title || 'Polestar 4 software updates')}</title>`,
    `<link>${esc(SITE_URL)}</link>`,
    `<atom:link href="${esc(FEED_URL)}" rel="self" type="application/rss+xml"/>`,
    '<description>Unofficial Polestar 4 over-the-air software update tracker — release notes for every version.</description>',
    '<language>en-GB</language>',
    ...(built ? [`<lastBuildDate>${built}</lastBuildDate>`] : []),
    '<generator>polestar4-updates build.js</generator>',
  ].join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    ${channel}
${items}
  </channel>
</rss>
`;
}

module.exports = { buildFeed, rfc822, SITE_URL, FEED_URL };
