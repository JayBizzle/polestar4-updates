#!/usr/bin/env node
/*
 * scrape.js — fetch the UK Polestar 4 manual, merge new/changed releases into
 * data.json (preserving manually-gathered dates), and emit workflow signals.
 *
 * Flags:
 *   --url <url>         source page (default: UK manual)
 *   --html-file <path>  read HTML from a file instead of fetching (tests/offline)
 *   --data <path>       data.json path (default: ./data.json)
 *   --date <YYYY-MM-DD> run date for new versions (default: today UTC)
 *   --dry-run           parse/merge/report but do not write data.json
 *
 * Exit 0 on success (changed or not). Exit 1 on fetch failure or safety-guard
 * abort, after writing scrape-error.txt. On a new version, writes
 * new-version-issue.md. Appends changed/new_versions/commit_message to
 * $GITHUB_OUTPUT when present.
 */
const fs = require('fs');
const path = require('path');
const { parseUpdates, mergeData, validateScrape } = require('./lib/scraper');

const UK_URL = 'https://www.polestar.com/uk/manual/polestar-4/2025/software-updates/';
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
    `This usually means the manual page changed structure. Check the parser/selectors.\n`);
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

async function getHtml() {
  const file = argValue('--html-file', undefined);
  if (file && typeof file === 'string') return fs.readFileSync(file, 'utf8');
  const url = argValue('--url', UK_URL);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

(async () => {
  const dataPath = path.resolve(argValue('--data', path.join(__dirname, 'data.json')));
  const runDate = argValue('--date', todayUTC());
  if (hasFlag('--date') && !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) fail('--date must be YYYY-MM-DD');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  let html;
  try { html = await getHtml(); } catch (e) { return fail(e.message); }

  const scraped = parseUpdates(html);
  try { validateScrape(scraped, existing); } catch (e) { return fail(e.message); }

  const { data, changed, newVersions } = mergeData(existing, scraped, runDate);

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

  console.log(`changed=${changed} new_versions=${newVersions.join(', ')} versions=${scraped.length}`);
  setOutput({ changed, new_versions: newVersions.join(', '), commit_message: commitMessage });
})().catch(e => fail(e.message));
