#!/usr/bin/env node
/*
 * scrape.js — fetch Polestar's car-content API (the JSON source behind the
 * manual's release-notes pages), merge new/changed releases into data.json
 * (preserving manually-gathered dates), and emit workflow signals.
 *
 * Flags:
 *   --base-url <url>       API origin (default: support-car-content.polestar.volvo.care)
 *   --content-file <path>  read the en-GB release-notes content JSON from a file (tests/offline)
 *   --manifest-file <path> read the release-notes manifest JSON from a file (tests/offline)
 *   --models-file <path>   read the available-car-models JSON from a file (tests/offline)
 *   --website-file <path>  read the public manual HTML from a file (tests/offline) for the prerelease cross-check
 *   --data <path>          data.json path (default: ./data.json)
 *   --date <YYYY-MM-DD>    run date for new versions (default: today UTC)
 *   --dry-run              parse/merge/report but do not write data.json
 *
 * Offline mode is triggered by --content-file; upcoming-version detection then
 * additionally needs --manifest-file and --models-file (otherwise the stored
 * upcoming list is preserved as-is), and the prerelease cross-check needs
 * --website-file (otherwise stored prerelease flags are preserved).
 *
 * Exit 0 on success (changed or not). Exit 1 on fetch failure or safety-guard
 * abort, after writing scrape-error.txt. On a new version, writes
 * new-version-issue.md; when an existing version's notes change, writes
 * notes-change.md (a +added/-removed diff). Appends
 * changed/new_versions/changed_notes/commit_message to $GITHUB_OUTPUT.
 */
const fs = require('fs');
const path = require('path');
const {
  parseUpdates, pickContent, upcomingVersions, attachBuildNumbers,
  parseWebsiteVersions, mergeData, validateScrape,
  API_BASE, MANIFEST_PATH, MODELS_PATH, WEBSITE_URL,
} = require('./lib/scraper');

const UA = 'Mozilla/5.0 (compatible; polestar4-tracker/1.0; +https://github.com/JayBizzle/polestar4-updates)';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? (process.argv[i + 1] ?? true) : def;
}
const hasFlag = name => process.argv.includes(name);
const todayUTC = () => new Date().toISOString().slice(0, 10);

function fail(message) {
  fs.writeFileSync(path.join(__dirname, 'scrape-error.txt'),
    `The Polestar 4 scraper aborted without changing data.json.\n\nReason: ${message}\n\n` +
    `This usually means the car-content API changed shape or moved. Check the parser/endpoints.\n`);
  console.error('SCRAPE ABORTED:', message);
  process.exit(1);
}

function argValue(name, def) {
  const v = arg(name, def);
  if (v === true) fail(`${name} requires a value`);
  return v;
}

function setOutput(kv) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  const body = Object.entries(kv).map(([k, v]) => `${k}<<__EOF__\n${v}\n__EOF__`).join('\n') + '\n';
  fs.appendFileSync(f, body);
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

/** Returns { content, manifest, models } — manifest/models may be null offline. */
async function getSource() {
  const contentFile = argValue('--content-file', undefined);
  if (contentFile && typeof contentFile === 'string') {
    const manifestFile = argValue('--manifest-file', undefined);
    const modelsFile = argValue('--models-file', undefined);
    return {
      content: readJson(contentFile),
      manifest: manifestFile ? readJson(manifestFile) : null,
      models: modelsFile ? readJson(modelsFile) : null,
    };
  }
  const base = argValue('--base-url', API_BASE).replace(/\/$/, '');
  const manifest = await fetchJson(base + MANIFEST_PATH);
  const entry = pickContent(manifest, 'en-GB');
  const content = await fetchJson(`${base}/${entry.relativeUrl.replace(/^\//, '')}`);
  const models = await fetchJson(base + MODELS_PATH);
  return { content, manifest, models };
}

/**
 * Set of officially-listed version labels for the prerelease cross-check, or
 * null when unavailable (offline with no --website-file, fetch/parse failure,
 * or a suspiciously empty parse). Never throws — this check is best-effort and
 * must not abort the run; null makes mergeData preserve existing flags.
 */
async function getWebsiteVersions() {
  const file = arg('--website-file', undefined);
  try {
    let html;
    if (file && typeof file === 'string') {
      html = fs.readFileSync(file, 'utf8');
    } else if (arg('--content-file', undefined)) {
      return null;   // offline source, no website fixture supplied
    } else {
      const res = await fetch(WEBSITE_URL, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    }
    const set = parseWebsiteVersions(html);
    if (!set.size) throw new Error('parsed 0 versions (page shape changed?)');
    return set;
  } catch (e) {
    console.error(`Website prerelease cross-check skipped: ${e.message}`);
    return null;
  }
}

(async () => {
  const dataPath = path.resolve(argValue('--data', path.join(__dirname, 'data.json')));
  const runDate = argValue('--date', todayUTC());
  if (hasFlag('--date') && !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) fail('--date must be YYYY-MM-DD');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  let source;
  try { source = await getSource(); } catch (e) { return fail(e.message); }

  let scraped = parseUpdates(source.content);
  try { validateScrape(scraped, existing); } catch (e) { return fail(e.message); }
  if (source.models) scraped = attachBuildNumbers(scraped, source.models);

  const upcoming = source.manifest && source.models
    ? upcomingVersions(source.models, source.manifest.spaceSoftwareVersion)
    : undefined;

  const websiteVersions = await getWebsiteVersions();

  const { data, changed, newVersions, notesChanged } = mergeData(existing, scraped, runDate, upcoming, websiteVersions);

  if (changed && !hasFlag('--dry-run')) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  }

  const commitMessage = newVersions.length
    ? `Add ${newVersions.join(', ')}`
    : 'Refresh Polestar 4 release notes';

  if (newVersions.length) {
    const preview = newVersions.map(v => {
      const u = data.updates.find(x => x.version === v);
      return `### ${v}\n` + u.notes.map(n => `- ${n}`).join('\n');
    }).join('\n\n');
    fs.writeFileSync(path.join(__dirname, 'new-version-issue.md'),
      `A new Polestar 4 software update was detected and published automatically.\n\n` +
      `${preview}\n\n[View the tracker](https://jaybizzle.github.io/polestar4-updates/)\n`);
  }

  // Notes edited on an already-known version: write a +added / -removed diff
  // for the ntfy push body so the alert says what actually changed.
  const changedNotes = notesChanged.map(c => c.version);
  if (notesChanged.length) {
    const body = notesChanged.map(c => [
      c.version,
      ...c.added.map(n => `+ ${n}`),
      ...c.removed.map(n => `- ${n}`),
    ].join('\n')).join('\n\n');
    fs.writeFileSync(path.join(__dirname, 'notes-change.md'), body + '\n');
  }

  const upcomingLabel = (data.meta.upcoming || [])
    .map(u => u.version || `build ${u.internal_version}`).join(', ');
  const prereleaseLabel = data.updates.filter(u => u.prerelease).map(u => u.version).join(', ');
  console.log(`changed=${changed} new_versions=${newVersions.join(', ')} changed_notes=${changedNotes.join(', ')} prerelease=${prereleaseLabel} versions=${scraped.length} upcoming=${upcomingLabel}`);
  setOutput({ changed, new_versions: newVersions.join(', '), changed_notes: changedNotes.join(', '), commit_message: commitMessage });
})().catch(e => fail(e.message));
