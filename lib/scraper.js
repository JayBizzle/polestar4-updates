const cheerio = require('cheerio');

const VERSION_RE = /Software Version\s+(.+?)\s*:?\s*$/i;
const UK_URL = 'https://www.polestar.com/uk/manual/polestar-4/2025/software-updates/';

/**
 * Parse the Polestar manual HTML into [{ version, notes[] }] in document order
 * (newest first). A version <h2> starts a bucket; other <h2>s are sub-headings
 * and are ignored. Note nodes (li/p) inside release-notes sections are collected;
 * nested sub-list items flatten into their own notes.
 */
function parseUpdates(html) {
  const $ = cheerio.load(html);
  const nodes = $('h2[data-dcs-type="title"], li[data-dcs-type="listItem"], p[data-dcs-type="paragraph"]');
  const updates = [];
  let cur = null;

  nodes.each((_, el) => {
    const $el = $(el);
    const tag = (el.tagName || el.name || '').toLowerCase();

    if (tag === 'h2') {
      const m = $el.text().match(VERSION_RE);
      if (m) { cur = { version: m[1].trim(), notes: [] }; updates.push(cur); }
      return; // sub-heading <h2>: ignore, do NOT close the current bucket
    }

    if (!cur) return;
    if ($el.closest('section[subtype="release-notes"]').length === 0) return;

    let text;
    if (tag === 'li') {
      const clone = $el.clone();
      clone.find('ul, ol, [data-dcs-type="footnote"]').remove(); // drop nested sub-lists and footnote markers
      text = clone.text();
    } else {
      const clone = $el.clone();
      clone.find('[data-dcs-type="footnote"]').remove();
      text = clone.text();
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) cur.notes.push(text);
  });

  return updates;
}

/**
 * Merge scraped [{version, notes}] into the existing data.json object.
 * - Existing versions: release_date / date_estimated copied VERBATIM (invariant).
 *   notes replaced if the scraped text differs.
 * - New versions: appended with release_date = runDate, date_estimated = false.
 * - Stored versions absent from the scrape are preserved (never deleted).
 * Returns { data, changed, newVersions }. `changed` reflects the `updates` array
 * only (meta is excluded), so no-op days don't churn the file.
 */
function mergeData(existing, scraped, runDate) {
  const stored = new Map(existing.updates.map(u => [u.version, u]));
  const newVersions = [];
  const merged = [];

  for (const s of scraped) {
    const prev = stored.get(s.version);
    if (prev) {
      merged.push({
        version: prev.version,
        release_date: prev.release_date,        // FROZEN
        date_estimated: prev.date_estimated,    // FROZEN
        notes: s.notes,                          // refreshed
      });
    } else {
      newVersions.push(s.version);
      merged.push({
        version: s.version,
        release_date: runDate,
        date_estimated: false,
        notes: s.notes,
      });
    }
  }

  // Preserve any stored versions not present on the page (page may prune history).
  const seen = new Set(scraped.map(s => s.version));
  for (const u of existing.updates) if (!seen.has(u.version)) merged.push(u);

  const data = {
    meta: {
      ...existing.meta,
      authoritative_source: UK_URL,
      scraped_on: runDate,
      page_version_count: scraped.length,
      total_versions: merged.length,
    },
    updates: merged,
  };

  // Content-only change detection: compare updates array only (ignore meta churn).
  // Normalize field order so an identical no-op run is never seen as "changed".
  const norm = ups => JSON.stringify(ups.map(u => ({
    version: u.version,
    release_date: u.release_date,
    date_estimated: u.date_estimated,
    notes: u.notes,
  })));
  const changed = norm(data.updates) !== norm(existing.updates);

  return { data, changed, newVersions };
}

/**
 * Safety guard for fully-automatic runs. Throws (aborting any write) when the
 * scrape looks broken: nothing parsed, an empty-notes version, or a >50% collapse
 * versus the last successful scrape's version count.
 */
function validateScrape(scraped, existing) {
  if (scraped.length === 0) throw new Error('Scrape returned no versions.');
  const empty = scraped.find(u => !u.notes || u.notes.length === 0);
  if (empty) throw new Error(`Version "${empty.version}" parsed with empty notes.`);
  const last = existing.meta && existing.meta.page_version_count;
  if (last && scraped.length < Math.floor(last / 2)) {
    throw new Error(`Version count dropped from ${last} to ${scraped.length} (>50%).`);
  }
}

module.exports = { parseUpdates, mergeData, validateScrape };
