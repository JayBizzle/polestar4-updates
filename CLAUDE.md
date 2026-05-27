# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An unofficial Polestar 4 software-update tracker. A single static page predicts the next over-the-air update, shows cadence stats, and lists every version's release notes. It auto-updates daily from Polestar's official UK manual. Live at https://jaybizzle.github.io/polestar4-updates/.

## Commands

```bash
npm test                          # run the whole suite (node --test)
node --test test/merge.test.js    # run one test file
node --test --test-name-pattern "existing dates"   # run tests matching a name
node build.js                     # regenerate index.html from data.json
node scrape.js                    # LIVE: fetch UK manual, merge into data.json, rebuild needs a separate build.js run
node scrape.js --html-file test/fixtures/manual-uk.html --dry-run   # offline, no write
node scrape.js --html-file <f> --data <path> --date 2026-05-27      # deterministic, against a temp data file
```

`scrape.js` flags: `--url`, `--html-file`, `--data`, `--date YYYY-MM-DD`, `--dry-run`. It writes `data.json` only when content changed; it does **not** run `build.js` itself (the workflow does that as a separate step).

## Architecture

Data flows one direction: **`data.json` (source of truth) → `build.js` → self-contained `index.html`**. `index.html` is generated — never hand-edit it; edit `data.json` and rebuild. All cadence/prediction math runs client-side in the JS embedded in `index.html`.

`lib/scraper.js` holds three pure, separately-tested functions; `scrape.js` is a thin CLI that wires them to I/O and the GitHub Action:

- **`parseUpdates(html)`** — cheerio, document-order. A `<h2 data-dcs-type="title">` matching `/Software Version (.+)/` starts a version bucket; **any other `<h2>` is a sub-heading and must NOT end the bucket**. Notes are `li`/`p[data-dcs-type]` inside `section[subtype="release-notes"]`. Nested sub-bullets flatten into separate notes; footnote markers (`[data-dcs-type="footnote"]`) are stripped. The page lists ~17 versions whose labels vary in format (`P4.2.11`, `4.1.11`, `Polestar OS4.1.7`, `PC4.1.5`).
- **`mergeData(existing, scraped, runDate)`** — reconciles a scrape into `data.json`. `changed` is computed from the `updates` array only (meta excluded) so no-op days don't churn the file.
- **`validateScrape(scraped, existing)`** — safety guard: throws on 0 versions, any empty-notes version, or a >50% drop vs `meta.page_version_count`. A throw aborts the run with no write.

`.github/workflows/update.yml` runs daily (06:00 UTC) + manual: scrape → on guard failure file a `⚠️` issue and fail; on change commit `data.json`+`index.html` (auto-deploys via Pages) and on a new version file a `🔔` issue (which emails the owner). It reads `changed`/`new_versions`/`commit_message` from `scrape.js`'s `$GITHUB_OUTPUT`.

## Critical invariants — do not break

- **Manually-gathered dates are frozen.** Polestar publishes no official release dates; the user approximated `release_date`/`date_estimated` by hand. `mergeData` copies these verbatim for existing versions and only assigns a date (the run date) to a brand-new version. Guarded by `test/merge.test.js` → "INVARIANT: existing dates are never modified". Never weaken this. Notes, by contrast, refresh from the UK page.

- **`main` is a clean single-commit history.** Project design/planning notes are kept local-only (gitignored) and are **not** committed — when publishing changes, push only the app code, tests, and config.

## Tests

`node --test` against frozen fixture `test/fixtures/manual-uk.html` (a real captured copy of the UK page). When changing parser behaviour, inspect the fixture to get exact expected strings; keep the structural assertions (version count/order, every-version-has-notes, nested-flatten) intact rather than weakening them.
