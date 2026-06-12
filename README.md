# Polestar 4 Software Update Tracker

### 🔗 Live site: <https://jaybizzle.github.io/polestar4-updates/>

A single, self-contained page that tracks Polestar 4 over-the-air software updates:
release notes, time between releases, average cadence, the predicted next update,
and whether the next one is overdue.

The data refreshes automatically: a daily GitHub Action fetches Polestar's
car-content API (the JSON source behind the manual's release-notes pages),
merges new/changed releases into `data.json` (never altering manually-gathered
dates), rebuilds, commits, and deploys to GitHub Pages.

## Files

| File | Role |
|------|------|
| `index.html` | The page. Self-contained (inline CSS/JS, data embedded). Open it directly or host it anywhere. **Generated — don't edit by hand.** |
| `data.json` | **Source of truth.** Version list, release notes, and `release_date` per version. Hand-edit to correct a date; the scraper preserves existing dates. |
| `build.js` | Reads `data.json` → writes `index.html`. |
| `scrape.js` / `lib/scraper.js` | Scraper CLI + pure parse/merge/validate logic. |
| `.github/workflows/update.yml` | Daily auto-update workflow. |

## How updates happen

The daily GitHub Action (`.github/workflows/update.yml`, 06:00 UTC, plus a manual
"Run workflow" button) fetches the release-notes API, merges into `data.json`, rebuilds, and
pushes — which deploys to GitHub Pages. On a new version it opens a `🔔` issue; if the
scrape looks broken (no versions, empty notes, or a sudden version-count collapse) it
opens a `⚠️` issue and changes nothing.

To run or correct things by hand:

```bash
npm install         # once
npm test            # run the test suite
node scrape.js      # fetch the release-notes API and merge into data.json
node build.js       # regenerate index.html from data.json
```

To fix a date manually, edit its `release_date` in `data.json` and run `node build.js`.
The scraper never overwrites existing dates — it only assigns one to a brand-new version.

## How the numbers work

- **Dates are when each update was first observed online, not Polestar's official
  release dates** — Polestar publishes none. The page says so in the footer.
- Average interval, predicted-next, and the overdue/upcoming badge are computed live
  in the browser from the gaps between dated versions; "days since last" ticks in real
  time.
- The oldest versions with no known date are listed but excluded from the cadence maths.
