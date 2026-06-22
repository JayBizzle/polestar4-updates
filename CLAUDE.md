# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An unofficial Polestar 4 software-update tracker. A single static page predicts the next over-the-air update, shows cadence stats, and lists every version's release notes. It auto-updates hourly from Polestar's car-content API (`support-car-content.polestar.volvo.care` — the unauthenticated JSON service behind the manual's release-notes pages and the in-car manual app). Live at https://jaybizzle.github.io/polestar4-updates/.

## Commands

```bash
npm test                          # run the whole suite (node --test)
node --test test/merge.test.js    # run one test file
node --test --test-name-pattern "existing dates"   # run tests matching a name
node build.js                     # regenerate index.html from data.json
node scrape.js                    # LIVE: fetch the API, merge into data.json, rebuild needs a separate build.js run
node scrape.js --content-file test/fixtures/release-notes-en-GB.json --manifest-file test/fixtures/release-notes-manifest.json --models-file test/fixtures/available-car-models.json --dry-run   # offline, no write
node scrape.js --content-file <f> --data <path> --date 2026-05-27   # deterministic, against a temp data file
```

`scrape.js` flags: `--base-url`, `--content-file`, `--manifest-file`, `--models-file`, `--data`, `--date YYYY-MM-DD`, `--dry-run`. `--content-file` switches to offline mode; without `--manifest-file`+`--models-file` the stored `meta.upcoming` list is preserved untouched. It writes `data.json` only when content changed; it does **not** run `build.js` itself (the workflow does that as a separate step).

## The API

- Manifest (cumulative, all published versions): `GET /api/car-content/SOFTWARE_RELEASE_NOTES/814/UNTIL/99.0.0` (`814` = Polestar 4 model code; an unreachably high `UNTIL` bound returns everything). Its `content[]` lists per-language JSON docs (fetch via `relativeUrl` against the same host); its `spaceSoftwareVersion` is the newest *published* internal build number.
- Registered builds (including unpublished): `GET /api/car-content/available-car-models` — pairs `internalVersion` (a YYWW-style build number, e.g. `26170`) with `carVersion` (e.g. `4.3`). Builds above `spaceSoftwareVersion` have no notes yet → they become `meta.upcoming` (early warning, surfaces before any release-notes page updates).
- The API self-documents at `GET /openapi.json`. It is internal/undocumented — if it breaks, the guard aborts and the workflow files a ⚠️ issue.

## Architecture

Data flows one direction: **`data.json` (source of truth) → `build.js` → self-contained `index.html`**. `index.html` is generated — never hand-edit it; edit `data.json` and rebuild. All cadence/prediction math runs client-side in the JS embedded in `index.html`. Versions flagged `prerelease` (in the API, not yet on the public site) are **excluded** from the cadence/prediction and the "latest" pill — those track the newest *official* version; prereleases get a separate amber "pre-release" badge + a banner callout.

`lib/scraper.js` holds pure, separately-tested functions (no dependencies); `scrape.js` is a thin CLI that wires them to I/O and the GitHub Action:

- **`parseUpdates(content)`** — walks the per-language content JSON's `body` segments in document order (newest first). **The version label comes from the segment *title*** (`/Software Version (.+)/`), NOT the segment's `softwareVersion` field — titles produce the exact historical labels (`P4.2.11`, `4.1.11`, `Polestar OS4.1.7`, `PC4.1.5`) that `data.json` dates are keyed on. A version may span several segments (market/hardware variants); notes concatenate with exact-duplicate lines deduped. `listItem`/`paragraph`/`listIntro` each yield one note; nested lists flatten into separate notes after their parent; `footnote` and `title` nodes are stripped; inline children concatenate **without** separators (strings carry their own spacing). Notes content is a superset of any one market's manual page — gating is not applied to note *text*. It is, however, used to classify each note: a note whose every occurrence carries a **positive** (non-negated) `validities`/`features` atom (e.g. `MU66`, `(MU66 | MU64)` — "only these markets/configs", vs `!MU32`/`(!MU13 & !MU32)` = "all markets except…", which is broadly applicable) is added to that version's `market_specific` list. The page tags those notes "market-specific".
- **`positiveGates(expr)`** — the gating classifier: returns the bare (non-`!`) atoms of a `validities`/`features` expression after stripping parens and `&`/`|`. Empty result = universal or negatively-gated (not market-specific). The MU* codes / validity hashes are opaque Polestar market/config identifiers with no published decode.
- **`pickContent(manifest, language)`** — selects a language entry (`en-GB`) from the manifest's `content[]`.
- **`parseWebsiteVersions(html)`** — the one place the public manual page (`WEBSITE_URL`) is still fetched: extracts the set of version labels officially listed there (case-sensitive `Software Version <label>` headings; lowercase prose ignored). Used **only** for the prerelease cross-check, never for note content. A version in the API but absent here is a prerelease (the API leads the page by hours/days).
- **`upcomingVersions(models, publishedMax)`** — registered builds with `internalVersion > publishedMax` (the manifest's `spaceSoftwareVersion`), as `{version, internal_version}`.
- **`attachBuildNumbers(scraped, models)`** — annotates each scraped version with `internal_version` from the models feed, matching on the label's numeric core (`P4.2.11` ↔ `4.2.11`). No match (e.g. `4.1.9` is absent from the feed) → left unannotated. In `mergeData`, `internal_version` refreshes when the scrape provides one and is kept when it doesn't (so an offline run or a models outage never blanks it); it is part of change detection.
- **`mergeData(existing, scraped, runDate, upcoming, websiteVersions)`** — reconciles a scrape into `data.json`. `changed` is computed from the `updates` array + the `upcoming` list only (other meta excluded) so no-op days don't churn the file. Omitting `upcoming` preserves the stored list. Also returns `notesChanged`: existing (non-new) versions whose notes content changed, each `{version, added[], removed[]}` (pure reorders excluded) — `scrape.js` writes these as a `+`/`-` diff to `notes-change.md` and emits a `changed_notes` output that drives a separate, quieter ntfy push. `websiteVersions` (a Set from `parseWebsiteVersions`) drives the `prerelease` flag: a version absent from it gets `prerelease: true`; pass `null`/omit to preserve stored flags (a new, unverifiable version is then conservatively treated as prerelease). `prerelease` is part of change detection, so a prerelease→official flip churns the file (and moves the page's "latest" pill). `market_specific` (per `parseUpdates`) refreshes alongside notes and is also part of change detection, so a note becoming market-specific churns the file.
- **`validateScrape(scraped, existing)`** — safety guard: throws on 0 versions, any empty-notes version, or a >50% drop vs `meta.page_version_count`. A throw aborts the run with no write.

`.github/workflows/update.yml` runs hourly (xx:23 UTC) + manual: scrape → on guard failure file a `⚠️` issue (deduped: skipped while one is already open) and fail; on change commit `data.json`+`index.html` (auto-deploys via Pages) and on a new version file a `🔔` issue (mentions+assigns the owner so the GitHub app pushes it). Two ntfy pushes (dormant until the `NTFY_TOPIC` secret is set): a loud one on a **new version** (`new_versions`), and a quieter one when an **existing version's notes are edited** (`changed_notes`, body = `notes-change.md` diff). It reads `changed`/`new_versions`/`changed_notes`/`commit_message` from `scrape.js`'s `$GITHUB_OUTPUT`.

## Critical invariants — do not break

- **Manually-gathered dates are frozen.** Polestar publishes no official release dates; the user approximated `release_date`/`date_estimated` by hand. `mergeData` copies these verbatim for existing versions and only assigns a date (the run date) to a brand-new version. Guarded by `test/merge.test.js` → "INVARIANT: existing dates are never modified". Never weaken this. Notes, by contrast, refresh from the API. Equally critical: `parseUpdates` must keep deriving version labels from segment titles so they keep matching the stored keys.

- **`main` is a clean single-commit history.** Project design/planning notes are kept local-only (gitignored) and are **not** committed — when publishing changes, push only the app code, tests, and config.

## Tests

`node --test` against frozen fixtures captured from the live API on 2026-06-12: `test/fixtures/release-notes-manifest.json` (UNTIL/99.0.0 manifest), `release-notes-en-GB.json` (cumulative content doc, 17 versions), `available-car-models.json`, plus `website-software-updates.html` (the 17 official version headings, for the prerelease cross-check). The CLI tests' shared `FIXTURES` array passes `--content-file`/`--manifest-file`/`--models-file`/`--website-file` so offline runs mirror production. When changing parser behaviour, inspect the fixtures to get exact expected strings; keep the structural assertions (version count/order, every-version-has-notes, nested-flatten, dedupe, footnote-strip) intact rather than weakening them.
