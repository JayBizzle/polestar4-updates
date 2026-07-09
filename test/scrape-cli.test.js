const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = [
  '--content-file', 'test/fixtures/release-notes-en-GB.json',
  '--manifest-file', 'test/fixtures/release-notes-manifest.json',
  '--models-file', 'test/fixtures/available-car-models.json',
  '--website-file', 'test/fixtures/website-software-updates.html',
];

function run(args) {
  return execFileSync('node', ['scrape.js', ...args], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
}

// scrape.js writes these transient artifacts into the repo root; remove them
// after each test so they neither leak between tests nor get committed.
afterEach(() => {
  for (const f of ['new-version-issue.md', 'notes-change.md', 'scrape-error.txt']) {
    const p = path.join(__dirname, '..', f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('--dry-run against the fixtures reports a change without writing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  // minimal existing data missing one version -> guaranteed change
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  const before = fs.readFileSync(dataPath, 'utf8');
  const out = run([...FIXTURES, '--data', dataPath, '--date', '2026-05-27', '--dry-run']);
  assert.match(out, /changed=true/);
  assert.match(out, /upcoming=4\.2\.12, 4\.3/);
  assert.equal(fs.readFileSync(dataPath, 'utf8'), before, 'dry-run must not write');
  assert.ok(!fs.existsSync(path.join(tmp, 'HISTORY.md')), 'dry-run must not write HISTORY.md');
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  if (fs.existsSync(issueFile)) fs.unlinkSync(issueFile);
});

test('writes merged data, preserves the existing date, stores upcoming', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  run([...FIXTURES, '--data', dataPath, '--date', '2026-05-27']);
  const after = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(after.updates.find(u => u.version === 'P4.2.11').release_date, '2026-03-24');
  assert.ok(after.updates.length >= 17);
  assert.ok(after.meta.upcoming.some(u => u.version === '4.3'));
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  assert.ok(fs.existsSync(issueFile), 'new-version-issue.md should be written');
  const issueContent = fs.readFileSync(issueFile, 'utf8');
  assert.match(issueContent, /jaybizzle\.github\.io\/polestar4-updates/);
  // P4.2.11 existed with stale notes -> its notes changed -> diff file written
  const notesFile = path.join(__dirname, '..', 'notes-change.md');
  assert.ok(fs.existsSync(notesFile), 'notes-change.md should be written');
  assert.match(fs.readFileSync(notesFile, 'utf8'), /^P4\.2\.11\n[-+]/m);
  // HISTORY.md is written next to the data file: new-version entries + the edit
  const history = fs.readFileSync(path.join(tmp, 'HISTORY.md'), 'utf8');
  assert.match(history, /^## 2026-05-27 — New version P4\.2\.10$/m);
  assert.match(history, /^## 2026-05-27 — Notes edited: P4\.2\.11$/m);
  assert.match(history, /```diff/);
});

test('website cross-check flags an API-only version as prerelease', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  // a website listing missing the newest version (P4.2.11) — simulates the API
  // leading the public page
  const siteFile = path.join(tmp, 'site.html');
  const labels = ['P4.2.10','P4.2.9','P4.2.8','P4.2.7','P4.2.6','P4.2.5','P4.2.4','P4.2.3','P4.2.2','P4.2.1','4.1.11','4.1.10','4.1.9','Polestar OS4.1.7','PC4.1.5','PC4.1.3'];
  fs.writeFileSync(siteFile, labels.map(v => `<h2>Software Version ${v}</h2>`).join('\n'));
  const out = run([
    '--content-file', 'test/fixtures/release-notes-en-GB.json',
    '--website-file', siteFile, '--data', dataPath, '--date', '2026-05-27',
  ]);
  assert.match(out, /prerelease=P4\.2\.11/);
  const after = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(after.updates.find(u => u.version === 'P4.2.11').prerelease, true);
  assert.ok(!('prerelease' in after.updates.find(u => u.version === 'PC4.1.3')), 'older listed version is not prerelease');
});

test('content file alone preserves the stored upcoming list', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1, upcoming: [{ version: '9.9', internal_version: 99999 }] },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  run(['--content-file', 'test/fixtures/release-notes-en-GB.json', '--data', dataPath, '--date', '2026-05-27']);
  const after = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.deepEqual(after.meta.upcoming, [{ version: '9.9', internal_version: 99999 }]);
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  if (fs.existsSync(issueFile)) fs.unlinkSync(issueFile);
});

test('GITHUB_OUTPUT receives heredoc-formatted changed key', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  const outputFile = path.join(tmp, 'github_output.txt');
  fs.writeFileSync(outputFile, '');
  execFileSync('node', ['scrape.js', ...FIXTURES, '--data', dataPath, '--date', '2026-05-27', '--dry-run'], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });
  const outputContent = fs.readFileSync(outputFile, 'utf8');
  assert.match(outputContent, /changed<<__EOF__\ntrue\n__EOF__/);
  // P4.2.11's stale notes changed -> surfaced in the changed_notes output
  assert.match(outputContent, /changed_notes<<__EOF__\nP4\.2\.11\n__EOF__/);
});

test('--date with no value exits non-zero', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  assert.throws(
    () => run([...FIXTURES, '--data', dataPath, '--date']),
    'missing --date value should exit non-zero'
  );
  const errFile = path.join(__dirname, '..', 'scrape-error.txt');
  if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
});

test('exits non-zero and writes scrape-error.txt on an empty content document', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({ meta: { page_version_count: 17 }, updates: [] }));
  const emptyContent = path.join(tmp, 'empty.json');
  fs.writeFileSync(emptyContent, JSON.stringify({ releaseNotesDocument: { body: [] } }));
  const errFile = path.join(__dirname, '..', 'scrape-error.txt');
  if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
  assert.throws(() => run(['--content-file', emptyContent, '--data', dataPath, '--date', '2026-05-27']));
  assert.ok(fs.existsSync(errFile), 'scrape-error.txt should be written');
  fs.unlinkSync(errFile);
});
