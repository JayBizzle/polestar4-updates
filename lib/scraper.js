const VERSION_RE = /Software Version\s+(.+?)\s*:?\s*$/i;

const API_BASE = 'https://support-car-content.polestar.volvo.care';
const MODEL_CODE = '814';
// UNTIL with an unreachably high version resolves to the cumulative document
// containing every published version's notes.
const MANIFEST_PATH = `/api/car-content/SOFTWARE_RELEASE_NOTES/${MODEL_CODE}/UNTIL/99.0.0`;
const MODELS_PATH = '/api/car-content/available-car-models';

const asArray = x => (Array.isArray(x) ? x : x == null ? [] : [x]);
const normText = s => s.replace(/\s+/g, ' ').trim();

// Node types that each become one note line; everything else is either skipped
// or a transparent container (segment, subSegment, unorderedList, note, text).
const LINE_TYPES = new Set(['listItem', 'paragraph', 'listIntro']);
const SKIP_TYPES = new Set(['footnote', 'title']);
const BLOCK_TYPES = new Set(['unorderedList', 'orderedList', 'note']);

/**
 * Flatten a release-notes content node into note lines. A line node's inline
 * children concatenate without separators (strings carry their own spacing);
 * nested lists flatten into separate lines after their parent, and footnote
 * markers are dropped — mirroring how the old HTML parser read the page.
 */
function flattenNotes(node, out) {
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { for (const n of node) flattenNotes(n, out); return; }
  if (!node || typeof node !== 'object') return;
  if (SKIP_TYPES.has(node.type)) return;

  const children = asArray(node.children);
  if (LINE_TYPES.has(node.type)) {
    const own = [];
    const nested = [];
    for (const c of children) {
      if (c && typeof c === 'object' && BLOCK_TYPES.has(c.type)) nested.push(c);
      else flattenNotes(c, own);
    }
    const line = normText(own.join(''));
    if (line) out.push(line);
    for (const n of nested) flattenNotes(n, out);
    return;
  }
  for (const c of children) flattenNotes(c, out);
}

/**
 * Parse a release-notes content document (the per-language JSON the API serves)
 * into [{ version, notes[] }] in document order (newest first).
 *
 * A segment whose title matches "Software Version X" starts (or re-opens) that
 * version's bucket — the version label is taken from the title, not the
 * segment's softwareVersion field, so labels match the historical page-derived
 * ones exactly (P4.2.11, Polestar OS4.1.7, PC4.1.5, ...). A version can span
 * several segments (market/hardware variants); their notes concatenate with
 * exact-duplicate lines removed. Segments before the first version title
 * (general disclaimers) are ignored.
 */
function parseUpdates(content) {
  const doc = content && content.releaseNotesDocument;
  const updates = [];
  let cur = null;

  for (const seg of asArray(doc && doc.body)) {
    if (!seg || typeof seg !== 'object') continue;
    const children = asArray(seg.children);
    const titleNode = children.find(c => c && typeof c === 'object' && c.type === 'title');
    const title = titleNode ? asArray(titleNode.children).filter(c => typeof c === 'string').join('') : '';
    const m = title.match(VERSION_RE);
    if (m) {
      const version = m[1].trim();
      cur = updates.find(u => u.version === version);
      if (!cur) { cur = { version, notes: [] }; updates.push(cur); }
    }
    if (!cur) continue;

    const lines = [];
    for (const c of children) flattenNotes(c, lines);
    for (const line of lines) if (!cur.notes.includes(line)) cur.notes.push(line);
  }

  return updates;
}

/** Pick the content entry for a language from a release-notes manifest. */
function pickContent(manifest, language = 'en-GB') {
  const entry = asArray(manifest && manifest.content).find(c => c.language === language);
  if (!entry) throw new Error(`No ${language} content entry in the release-notes manifest.`);
  return entry;
}

/**
 * Versions Polestar has registered for the model but whose release notes are
 * not yet published: internalVersion (a YYWW build number) above the
 * manifest's spaceSoftwareVersion (the newest build with published notes).
 */
function upcomingVersions(models, publishedMax) {
  const model = asArray(models).find(m => m.modelCode === MODEL_CODE);
  const max = Number(publishedMax);
  if (!model || !Number.isFinite(max)) return [];
  return asArray(model.softwareVersions)
    .filter(v => Number(v.internalVersion) > max)
    .sort((a, b) => a.internalVersion - b.internalVersion)
    .map(v => ({ version: v.carVersion ?? null, internal_version: v.internalVersion }));
}

/**
 * Merge scraped [{version, notes}] into the existing data.json object.
 * - Existing versions: release_date / date_estimated copied VERBATIM (invariant).
 *   notes replaced if the scraped text differs.
 * - New versions: appended with release_date = runDate, date_estimated = false.
 * - Stored versions absent from the scrape are preserved (never deleted).
 * - upcoming (from upcomingVersions) is stored in meta; omit it to preserve
 *   the previously stored list.
 * Returns { data, changed, newVersions }. `changed` reflects the `updates`
 * array and the upcoming list only (other meta excluded), so no-op days don't
 * churn the file.
 */
function mergeData(existing, scraped, runDate, upcoming) {
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

  // Preserve any stored versions not present in the source (history may prune).
  const seen = new Set(scraped.map(s => s.version));
  for (const u of existing.updates) if (!seen.has(u.version)) merged.push(u);

  const prevUpcoming = (existing.meta && existing.meta.upcoming) || [];
  const nextUpcoming = upcoming ?? prevUpcoming;

  const data = {
    meta: {
      ...existing.meta,
      authoritative_source: API_BASE + MANIFEST_PATH,
      scraped_on: runDate,
      page_version_count: scraped.length,
      total_versions: merged.length,
      upcoming: nextUpcoming,
    },
    updates: merged,
  };

  // Content-only change detection: compare updates + upcoming (ignore meta churn).
  // Normalize field order so an identical no-op run is never seen as "changed".
  const norm = ups => JSON.stringify(ups.map(u => ({
    version: u.version,
    release_date: u.release_date,
    date_estimated: u.date_estimated,
    notes: u.notes,
  })));
  const normUp = list => JSON.stringify(asArray(list).map(u => ({
    version: u.version ?? null,
    internal_version: u.internal_version,
  })));
  const changed = norm(data.updates) !== norm(existing.updates)
    || normUp(nextUpcoming) !== normUp(prevUpcoming);

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

module.exports = {
  parseUpdates, pickContent, upcomingVersions, mergeData, validateScrape,
  API_BASE, MODEL_CODE, MANIFEST_PATH, MODELS_PATH,
};
