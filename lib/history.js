/*
 * history.js — maintain HISTORY.md, the chronological (newest-first) log of
 * scraper discoveries: new versions and release-note edits. Pure:
 * updateHistory(existing, runDate, newVersions, notesChanged) returns the new
 * file content; scrape.js reads/writes the file.
 *
 * Unlike index.html/feed.xml this is NOT regenerated from data.json — data.json
 * overwrites edited notes, so edit history only exists here. The file is
 * append-only: existing entries are never rewritten, new ones are inserted
 * between the header and the previous first entry.
 */

const HEADER = `# Polestar 4 update history

A chronological record (newest first) of every new software version and
release-note edit discovered by the scraper. Maintained automatically by
scrape.js — do not edit by hand.
`;

// {version, notes[]} -> "## <date> — New version <v>" + bulleted notes
function renderNewVersion(runDate, { version, notes }) {
  return `## ${runDate} — New version ${version}\n\n${(notes || []).map(n => `- ${n}`).join('\n')}\n`;
}

// {version, added[], removed[]} -> "## <date> — Notes edited: <v>" + diff fence
function renderNotesEdit(runDate, { version, added, removed }) {
  const diff = [
    ...(added || []).map(n => `+ ${n}`),
    ...(removed || []).map(n => `- ${n}`),
  ].join('\n');
  return `## ${runDate} — Notes edited: ${version}\n\n\`\`\`diff\n${diff}\n\`\`\`\n`;
}

/**
 * Returns the updated history content. `existing` is the current file content
 * (null/empty when the file doesn't exist yet — the header is created).
 * `newVersions` is [{version, notes}], `notesChanged` is
 * [{version, added, removed}] (mergeData's shape). With no events the existing
 * content (or a bare header) is returned unchanged.
 */
function updateHistory(existing, runDate, newVersions = [], notesChanged = []) {
  const base = existing && existing.trim() ? existing : HEADER;
  const entries = [
    ...newVersions.map(v => renderNewVersion(runDate, v)),
    ...notesChanged.map(c => renderNotesEdit(runDate, c)),
  ];
  if (!entries.length) return base;
  const block = entries.join('\n');
  const at = base.search(/^## /m);
  if (at === -1) return base.replace(/\n*$/, '\n') + '\n' + block;
  return base.slice(0, at) + block + '\n' + base.slice(at);
}

module.exports = { updateHistory, HEADER };
