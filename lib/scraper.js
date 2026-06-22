const VERSION_RE = /Software Version\s+(.+?)\s*:?\s*$/i;

const API_BASE = 'https://support-car-content.polestar.volvo.care';
const MODEL_CODE = '814';
// UNTIL with an unreachably high version resolves to the cumulative document
// containing every published version's notes.
const MANIFEST_PATH = `/api/car-content/SOFTWARE_RELEASE_NOTES/${MODEL_CODE}/UNTIL/99.0.0`;
const MODELS_PATH = '/api/car-content/available-car-models';
// Public consumer-facing manual page. The API leads it (notes appear here a
// few hours/days later), so a version present in the API but absent here is a
// prerelease. Used only for that cross-check, never for note content.
const WEBSITE_URL = 'https://www.polestar.com/uk/manual/polestar-4/2025/software-updates/';

const asArray = x => (Array.isArray(x) ? x : x == null ? [] : [x]);
const normText = s => s.replace(/\s+/g, ' ').trim();

// Node types that each become one note line; everything else is either skipped
// or a transparent container (segment, subSegment, unorderedList, note, text).
const LINE_TYPES = new Set(['listItem', 'paragraph', 'listIntro']);
const SKIP_TYPES = new Set(['footnote', 'title']);
const BLOCK_TYPES = new Set(['unorderedList', 'orderedList', 'note']);

/**
 * Positive (non-negated) atoms of a `validities`/`features` gating expression.
 * The API gates a note to certain cars with expressions like "MU66",
 * "!MU32", "(!MU13 & !MU32)" or "(MU66 | MU64)". A NEGATED atom ("!MU32")
 * means "every market EXCEPT this" — broadly applicable; a BARE atom ("MU66")
 * means "ONLY this market/config". Returns the bare atoms (empty when the note
 * is universal or only negatively gated). Parentheses and &/| operators are
 * stripped; the codes themselves are opaque Polestar market/config identifiers.
 */
function positiveGates(expr) {
  if (expr == null || expr === 'true') return [];
  return String(expr).replace(/[()]/g, ' ').split(/[&|]/)
    .map(a => a.trim()).filter(a => a && !a.startsWith('!'));
}

/**
 * Flatten a release-notes content node into note lines. A line node's inline
 * children concatenate without separators (strings carry their own spacing);
 * nested lists flatten into separate lines after their parent, and footnote
 * markers are dropped — mirroring how the old HTML parser read the page.
 *
 * Each emitted line is { text, v, f } where v/f are the effective
 * `validities`/`features` gating in scope (inherited from ancestors unless the
 * node overrides them) — used to detect market-specific notes.
 */
function flattenNotes(node, out, inh = { v: null, f: null }) {
  if (typeof node === 'string') { out.push({ text: node, v: inh.v, f: inh.f }); return; }
  if (Array.isArray(node)) { for (const n of node) flattenNotes(n, out, inh); return; }
  if (!node || typeof node !== 'object') return;
  if (SKIP_TYPES.has(node.type)) return;

  const here = {
    v: node.validities != null ? node.validities : inh.v,
    f: node.features != null ? node.features : inh.f,
  };
  const children = asArray(node.children);
  if (LINE_TYPES.has(node.type)) {
    const own = [];
    const nested = [];
    for (const c of children) {
      if (c && typeof c === 'object' && BLOCK_TYPES.has(c.type)) nested.push(c);
      else flattenNotes(c, own, here);
    }
    const line = normText(own.map(o => o.text).join(''));
    if (line) out.push({ text: line, v: here.v, f: here.f });
    for (const n of nested) flattenNotes(n, out, here);
    return;
  }
  for (const c of children) flattenNotes(c, out, here);
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
      if (!cur) { cur = { version, notes: [], _gates: new Map() }; updates.push(cur); }
    }
    if (!cur) continue;

    // Segment-level validities/features are the inherited baseline for its notes.
    const inh = { v: seg.validities ?? null, f: seg.features ?? null };
    const lines = [];
    for (const c of children) flattenNotes(c, lines, inh);
    for (const ln of lines) {
      if (!cur.notes.includes(ln.text)) cur.notes.push(ln.text);
      const occ = cur._gates.get(ln.text) || [];
      occ.push(ln);
      cur._gates.set(ln.text, occ);
    }
  }

  // A note is market-specific when EVERY occurrence is gated to specific
  // markets/configs (a positive, non-negated validities/features atom). A note
  // that ever appears ungated — or only negated ("all markets except…") — is
  // broadly applicable and left unflagged.
  for (const u of updates) {
    const flagged = u.notes.filter(text =>
      u._gates.get(text).every(o => positiveGates(o.v).length || positiveGates(o.f).length));
    delete u._gates;
    if (flagged.length) u.market_specific = flagged;
  }

  return updates;
}

/**
 * Extract the set of version labels officially listed on the public manual
 * page. Headings read "Software Version <label>" with a capital S and V; the
 * lowercase phrase "software version" in prose is intentionally not matched
 * (the match is case-sensitive). Returns a Set of label strings.
 */
function parseWebsiteVersions(html) {
  const re = /Software Version\s+([A-Za-z0-9][A-Za-z0-9. ]*?)\s*(?=[:<"])/g;
  const set = new Set();
  let m;
  while ((m = re.exec(html)) !== null) set.add(m[1].trim());
  return set;
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

// Normalize a version label to its numeric core so page-derived labels match
// the models feed's carVersion: 'P4.2.11'/'PC4.1.5'/'Polestar OS4.1.7' -> '4.2.11'/'4.1.5'/'4.1.7'.
const numKey = v => (String(v).match(/\d+/g) || []).join('.');

/**
 * Annotate scraped [{version, notes}] with internal_version (the YYWW build
 * number) by matching against the available-car-models feed. Versions with no
 * match (e.g. 4.1.9, absent from the feed) are returned untouched.
 */
function attachBuildNumbers(scraped, models) {
  const model = asArray(models).find(m => m.modelCode === MODEL_CODE);
  if (!model) return scraped;
  const byKey = new Map();
  for (const v of asArray(model.softwareVersions)) {
    if (v.carVersion && v.internalVersion != null) byKey.set(numKey(v.carVersion), v.internalVersion);
  }
  return scraped.map(s => {
    const iv = byKey.get(numKey(s.version));
    return iv == null ? s : { ...s, internal_version: iv };
  });
}

/**
 * Merge scraped [{version, notes}] into the existing data.json object.
 * - Existing versions: release_date / date_estimated copied VERBATIM (invariant).
 *   notes replaced if the scraped text differs; internal_version refreshed when
 *   the scrape provides one, otherwise the stored value is kept.
 * - New versions: appended with release_date = runDate, date_estimated = false.
 * - Stored versions absent from the scrape are preserved (never deleted).
 * - upcoming (from upcomingVersions) is stored in meta; omit it to preserve
 *   the previously stored list.
 * - websiteVersions (a Set from parseWebsiteVersions): versions absent from it
 *   are flagged `prerelease: true`. Omit/pass null to preserve stored flags
 *   (a new version is then conservatively treated as prerelease).
 * Returns { data, changed, newVersions, notesChanged }. `changed` reflects the
 * `updates` array and the upcoming list only (other meta excluded), so no-op
 * days don't churn the file. `notesChanged` lists existing (non-new) versions
 * whose notes content changed, each as { version, added[], removed[] } — a pure
 * reorder is not counted.
 */
function mergeData(existing, scraped, runDate, upcoming, websiteVersions) {
  const stored = new Map(existing.updates.map(u => [u.version, u]));
  const newVersions = [];
  const notesChanged = [];   // existing versions whose notes content changed
  const merged = [];

  // prerelease = in the API but not yet on the public manual page. Determined
  // only when websiteVersions is supplied; otherwise preserve the stored flag
  // (and treat a brand-new, unverifiable version conservatively as prerelease).
  const isPrerelease = (version, prevFlag) =>
    websiteVersions ? !websiteVersions.has(version) : prevFlag;

  for (const s of scraped) {
    const prev = stored.get(s.version);
    const internal = s.internal_version ?? (prev && prev.internal_version);
    if (prev) {
      const prevNotes = prev.notes || [];
      const added = s.notes.filter(n => !prevNotes.includes(n));
      const removed = prevNotes.filter(n => !s.notes.includes(n));
      if (added.length || removed.length) notesChanged.push({ version: prev.version, added, removed });
      const pre = isPrerelease(prev.version, !!prev.prerelease);
      merged.push({
        version: prev.version,
        release_date: prev.release_date,        // FROZEN
        date_estimated: prev.date_estimated,    // FROZEN
        ...(internal != null && { internal_version: internal }),
        ...(pre && { prerelease: true }),
        notes: s.notes,                          // refreshed
        ...(s.market_specific && { market_specific: s.market_specific }),
      });
    } else {
      newVersions.push(s.version);
      const pre = isPrerelease(s.version, true);
      merged.push({
        version: s.version,
        release_date: runDate,
        date_estimated: false,
        ...(internal != null && { internal_version: internal }),
        ...(pre && { prerelease: true }),
        notes: s.notes,
        ...(s.market_specific && { market_specific: s.market_specific }),
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
    internal_version: u.internal_version ?? null,
    prerelease: !!u.prerelease,
    notes: u.notes,
    market_specific: u.market_specific ?? null,
  })));
  const normUp = list => JSON.stringify(asArray(list).map(u => ({
    version: u.version ?? null,
    internal_version: u.internal_version,
  })));
  const changed = norm(data.updates) !== norm(existing.updates)
    || normUp(nextUpcoming) !== normUp(prevUpcoming);

  return { data, changed, newVersions, notesChanged };
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
  parseUpdates, pickContent, upcomingVersions, attachBuildNumbers,
  parseWebsiteVersions, mergeData, validateScrape, positiveGates,
  API_BASE, MODEL_CODE, MANIFEST_PATH, MODELS_PATH, WEBSITE_URL,
};
