# Polestar 4 Software Update Tracker

### 🔗 Live site: <https://jaybizzle.github.io/polestar4-updates/>

A single, self-contained page that tracks Polestar 4 over-the-air software updates:
release notes, time between releases, average cadence, the predicted next update,
and whether the next one is overdue.

The data refreshes automatically: a daily GitHub Action scrapes the UK manual,
merges new/changed releases into `data.json` (never altering manually-gathered
dates), rebuilds, commits, and deploys to GitHub Pages.

## Files

| File | Role |
|------|------|
| `index.html` | The page. Self-contained (inline CSS/JS, data embedded). Open it directly or host it anywhere. **Generated — don't edit by hand.** |
| `data.json` | **Source of truth.** The version list, notes, and `first_seen` dates. Edit this. |
| `build.js` | Reads `data.json` → writes `index.html`. |
| `scrape.js` / `lib/scraper.js` | Scraper CLI + pure parse/merge/validate logic. |
| `.github/workflows/update.yml` | Daily auto-update workflow. |

## Update the data

1. Edit `data.json` (add a new entry to `updates`, set `meta.scraped_on`).
2. Rebuild:
   ```bash
   node build.js
   ```
3. Open `index.html` to check, or deploy it.

## How the numbers work

- **Dates are when each update was first observed online, not Polestar's official
  release dates** — Polestar publishes none. The page says so in the footer.
- The 11 versions sharing `2025-09-04` were backfilled together on a single date.
  They're flagged, shown without a day-gap, and **excluded from cadence math**.
- Average interval / predicted next / overdue are computed live in the browser from
  the gaps between distinct, non-backfill dates. "Days since last" updates as real
  time passes.

## Hosting

No build server needed. `index.html` is fully static — push to GitHub Pages, drop in
an S3 bucket, drag into Netlify, or just open the file.
