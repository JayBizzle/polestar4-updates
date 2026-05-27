const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(args) {
  return execFileSync('node', ['scrape.js', ...args], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
}

test('--dry-run against the fixture reports a change without writing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  // minimal existing data missing one version -> guaranteed change
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  const before = fs.readFileSync(dataPath, 'utf8');
  const out = run([
    '--html-file', 'test/fixtures/manual-uk.html',
    '--data', dataPath, '--date', '2026-05-27', '--dry-run',
  ]);
  assert.match(out, /changed=true/);
  assert.equal(fs.readFileSync(dataPath, 'utf8'), before, 'dry-run must not write');
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  if (fs.existsSync(issueFile)) fs.unlinkSync(issueFile);
});

test('writes merged data and preserves the existing date', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  run(['--html-file', 'test/fixtures/manual-uk.html', '--data', dataPath, '--date', '2026-05-27']);
  const after = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(after.updates.find(u => u.version === 'P4.2.11').release_date, '2026-03-24');
  assert.ok(after.updates.length >= 17);
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  assert.ok(fs.existsSync(issueFile), 'new-version-issue.md should be written');
  const issueContent = fs.readFileSync(issueFile, 'utf8');
  assert.match(issueContent, /jaybizzle\.github\.io\/polestar4-updates/);
  fs.unlinkSync(issueFile);
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
  execFileSync('node', ['scrape.js',
    '--html-file', 'test/fixtures/manual-uk.html',
    '--data', dataPath, '--date', '2026-05-27', '--dry-run',
  ], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, GITHUB_OUTPUT: outputFile },
  });
  const outputContent = fs.readFileSync(outputFile, 'utf8');
  assert.match(outputContent, /changed<<__EOF__\ntrue\n__EOF__/);
  const issueFile = path.join(__dirname, '..', 'new-version-issue.md');
  if (fs.existsSync(issueFile)) fs.unlinkSync(issueFile);
});

test('--date with no value exits non-zero', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({
    meta: { authoritative_source: 'x', scraped_on: '2026-01-01', page_version_count: 17, total_versions: 1 },
    updates: [{ version: 'P4.2.11', release_date: '2026-03-24', date_estimated: false, notes: ['stale'] }],
  }));
  assert.throws(
    () => run(['--html-file', 'test/fixtures/manual-uk.html', '--data', dataPath, '--date']),
    'missing --date value should exit non-zero'
  );
  const errFile = path.join(__dirname, '..', 'scrape-error.txt');
  if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
});

test('exits non-zero and writes scrape-error.txt on empty HTML', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps4-'));
  const dataPath = path.join(tmp, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify({ meta: { page_version_count: 17 }, updates: [] }));
  const emptyHtml = path.join(tmp, 'empty.html');
  fs.writeFileSync(emptyHtml, '<html><body>nothing</body></html>');
  const errFile = path.join(__dirname, '..', 'scrape-error.txt');
  if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
  assert.throws(() => run(['--html-file', emptyHtml, '--data', dataPath, '--date', '2026-05-27']));
  assert.ok(fs.existsSync(errFile), 'scrape-error.txt should be written');
  fs.unlinkSync(errFile);
});
