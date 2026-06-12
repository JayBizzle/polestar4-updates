#!/usr/bin/env node
/*
 * build.js — regenerates index.html from data.json.
 *
 * data.json is the editable source of truth. This inlines it into a single
 * self-contained index.html (no build deps, no server, opens via file://).
 * When the data is refreshed later, just edit data.json and re-run `node build.js`.
 *
 * Each update has: version, release_date (ISO string or null), date_estimated (bool),
 * notes (array of bullet strings). Dates are approximate. Versions are sorted by
 * version number (which matches chronological order for this product).
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const dataLiteral = JSON.stringify(data);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Polestar 4 Software Updates — Unofficial Tracker</title>
<meta name="description" content="Tracking Polestar 4 software updates: release notes, time between releases, average cadence, and the predicted next update.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#f3f3f1; --card:#ffffff; --ink:#141414; --muted:#6c6c6a;
    --line:#e5e5e1; --line-strong:#d8d8d3;
    --gold:#b08d4f; --gold-soft:#f0e7d6;
    --danger:#b23b3b; --danger-soft:#f6e4e2;
    --ok:#3c7d57; --ok-soft:#e2efe7;
    --radius:14px;
    --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:var(--font); background:var(--bg); color:var(--ink);
    line-height:1.55; font-weight:400; -webkit-font-smoothing:antialiased;
    padding:clamp(20px,5vw,56px) 20px 64px;
  }
  .wrap{max-width:860px;margin:0 auto}
  a{color:inherit}

  /* Header */
  header.site{margin-bottom:40px}
  .eyebrow{
    font-size:12px;letter-spacing:.18em;text-transform:uppercase;
    color:var(--gold);font-weight:600;margin-bottom:14px;
  }
  h1{font-size:clamp(30px,6vw,48px);font-weight:300;letter-spacing:-.02em;line-height:1.05}
  h1 b{font-weight:600}
  .lede{margin-top:14px;color:var(--muted);font-size:15px;max-width:60ch}
  .lede a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line-strong)}
  .lede a:hover{border-color:var(--ink)}

  /* Prediction banner */
  .banner{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    padding:clamp(22px,4vw,34px);margin:36px 0 16px;
    display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between;
  }
  .banner .label{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .banner .date{font-size:clamp(26px,5vw,40px);font-weight:300;letter-spacing:-.01em}
  .banner .date.overdue{color:var(--danger)}
  .banner .sub{color:var(--muted);font-size:14px;margin-top:10px;max-width:46ch}
  .badge{
    display:inline-flex;align-items:center;gap:8px;border-radius:100px;
    padding:9px 16px;font-size:13px;font-weight:600;letter-spacing:.02em;white-space:nowrap;
  }
  .badge .dot{width:8px;height:8px;border-radius:50%}
  .badge.overdue{background:var(--danger-soft);color:var(--danger)}
  .badge.overdue .dot{background:var(--danger)}
  .badge.upcoming{background:var(--ok-soft);color:var(--ok)}
  .badge.upcoming .dot{background:var(--ok)}

  /* Upcoming (registered, unreleased) accordion */
  .upcoming{margin-bottom:16px}
  .upcoming summary{padding:14px 18px}
  .upcoming .ver{font-size:14px;font-weight:600}
  .count-pill{
    display:inline-block;padding:2px 9px;border-radius:100px;
    background:var(--gold-soft);color:var(--gold);font-size:11px;font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;
  }
  .up-body{padding:0 18px 16px;border-top:1px solid var(--line)}
  .up-body .hint{font-size:13px;color:var(--muted);margin:13px 0 4px;max-width:64ch}
  .up-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px}
  .up-row:last-child{border-bottom:0}
  .up-row .build{color:var(--muted);font-size:13px;white-space:nowrap}
  .build-line{margin-top:13px;font-size:12.5px;color:var(--muted)}
  .build-line + ul{margin-top:10px}

  /* Stat grid */
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:48px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:20px 18px}
  .stat .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
  .stat .v{font-size:30px;font-weight:300;letter-spacing:-.01em;line-height:1}
  .stat .v small{font-size:14px;color:var(--muted);font-weight:400}

  /* Section heading */
  .sec-h{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 22px;gap:12px}
  .sec-h h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--ink)}
  .sec-h .note{font-size:12px;color:var(--muted)}
  .tl-legend{font-size:12.5px;color:var(--muted);margin:-12px 2px 20px}
  .tl-legend .gap{margin-right:2px}

  /* Timeline */
  .timeline{position:relative;margin-left:7px;padding-left:28px;border-left:1px solid var(--line-strong)}
  .entry{position:relative;padding-bottom:26px}
  .entry:last-child{padding-bottom:0}
  .entry::before{
    content:"";position:absolute;box-sizing:border-box;left:-35px;top:6px;width:13px;height:13px;border-radius:50%;
    background:var(--card);border:2px solid var(--gold);
  }
  .entry.nodate::before{border-color:var(--line-strong)}
  details{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
  summary{
    list-style:none;cursor:pointer;padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  }
  summary::-webkit-details-marker{display:none}
  .ver{font-size:17px;font-weight:600;letter-spacing:-.01em}
  .latest-pill{
    display:inline-block;margin-left:10px;padding:2px 9px;border-radius:100px;
    background:var(--ok-soft);color:var(--ok);font-size:11px;font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;vertical-align:middle;
  }
  .meta-row{display:flex;align-items:center;gap:14px;margin-left:auto;color:var(--muted);font-size:13px;flex-wrap:wrap}
  .gap{color:var(--gold);font-weight:600}
  .gap.zero{color:var(--muted);font-weight:400}
  .date{white-space:nowrap}
  .date.est{color:var(--muted)}
  .date.unknown{color:var(--muted);font-style:italic}
  .chev{transition:transform .2s ease;color:var(--muted);font-size:12px}
  details[open] .chev{transform:rotate(180deg)}
  .notes{padding:0 18px 18px;border-top:1px solid var(--line)}
  .notes ul{list-style:none;margin-top:14px}
  .notes li{position:relative;padding-left:18px;margin-bottom:9px;font-size:14.5px;color:#2c2c2a}
  .notes li::before{content:"";position:absolute;left:0;top:9px;width:5px;height:5px;border-radius:50%;background:var(--gold)}

  /* Footer */
  footer{margin-top:54px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
  footer p{margin-bottom:8px;max-width:70ch}
  footer a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line-strong)}
  footer a:hover{border-color:var(--ink)}

  @media(max-width:680px){
    .stats{grid-template-columns:repeat(2,1fr)}
    .banner{flex-direction:column;align-items:flex-start}
    .meta-row{width:100%;margin-left:0;margin-top:4px}
  }
  @media(max-width:440px){
    .stat{padding:16px 14px}
    .stat .v{font-size:26px}
    summary{padding:14px}
    .notes{padding:0 14px 14px}
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="site">
    <div class="eyebrow">Unofficial tracker</div>
    <h1>Polestar 4 <b>Software Updates</b></h1>
    <p class="lede">When the next over-the-air update is likely to land, how often they arrive, and what each one changed. Version notes from
      <a href="${data.meta.authoritative_source}" target="_blank" rel="noopener">Polestar's official release-notes API</a> (all markets combined).</p>
  </header>

  <section class="banner" id="banner"></section>
  <section id="upcoming"></section>
  <section class="stats" id="stats"></section>

  <div class="sec-h">
    <h2>Release timeline</h2>
    <span class="note" id="timeline-note"></span>
  </div>
  <p class="tl-legend"><span class="gap">+N&nbsp;days</span> = days since the previous release</p>
  <div id="timeline-root"></div>

  <footer id="footer"></footer>
</div>

<script>
const DATA = ${dataLiteral};

// ---------- helpers ----------
const DAY = 86400000;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)); };
const today = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const fmt = d => d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const daysBetween = (a,b) => Math.round((b - a)/DAY);
const plural = (n,w) => n + ' ' + w + (n===1?'':'s');
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
// internal build numbers read as YYWW(+sub-build): 26150 ≈ 2026, week 15
const buildLabel = iv => {
  const s = String(iv);
  if(!/^\\d{5,6}$/.test(s)) return 'build ' + esc(s);
  return \`build \${esc(s)} <small>· 20\${s.slice(0,2)} wk \${s.slice(2,4)}</small>\`;
};
// numeric version compare: "P4.2.10" > "P4.2.9"
const vkey = v => (String(v).match(/\\d+/g)||[]).map(Number);
const vcmp = (a,b)=>{const A=vkey(a),B=vkey(b);for(let i=0;i<Math.max(A.length,B.length);i++){const d=(A[i]||0)-(B[i]||0);if(d)return d;}return 0;};

// ---------- metrics ----------
function compute(){
  // newest-first by version number (matches chronological order for this product)
  const ups = DATA.updates.map(u => ({...u, d: u.release_date ? parse(u.release_date) : null}))
                          .sort((a,b)=> vcmp(b.version, a.version));

  // dated entries, oldest->newest, for cadence
  const datedAsc = [...ups].filter(u=>u.d).sort((a,b)=> a.d - b.d);
  const intervals = [];
  for(let i=1;i<datedAsc.length;i++) intervals.push(daysBetween(datedAsc[i-1].d, datedAsc[i].d));
  const avg = intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const sorted = [...intervals].sort((a,b)=>a-b);
  const median = sorted.length%2 ? sorted[(sorted.length-1)/2] : Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2);
  // percentile via linear interpolation on sorted intervals (numpy default)
  const pct = p => {
    const idx = (sorted.length-1)*p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo===hi ? sorted[lo] : sorted[lo] + (idx-lo)*(sorted[hi]-sorted[lo]);
  };
  const p25 = Math.round(pct(0.25)), p75 = Math.round(pct(0.75));

  const last = datedAsc[datedAsc.length-1];          // newest dated release
  const now = today();
  const sinceLast = daysBetween(last.d, now);
  // headline + overdue use the median gap; the window is the 25th–75th percentile
  const predicted = new Date(last.d.getTime() + median*DAY);
  const overdue = now > predicted;
  const overdueBy = daysBetween(predicted, now);
  const winStart = new Date(last.d.getTime() + p25*DAY);
  const winEnd = new Date(last.d.getTime() + p75*DAY);

  return {ups, datedAsc, intervals, avg, median, p25, p75, winStart, winEnd, min:sorted[0], max:sorted[sorted.length-1],
          last, sinceLast, predicted, overdue, overdueBy,
          datedCount: datedAsc.length, estCount: ups.filter(u=>u.date_estimated).length,
          unknownCount: ups.filter(u=>!u.d).length, total: ups.length};
}

// ---------- render ----------
function render(){
  const m = compute();

  const windowTxt = fmt(m.winStart) + " – " + fmt(m.winEnd);
  const bannerSub = m.overdue
    ? "Last update (" + esc(m.last.version) + ") was " + plural(m.sinceLast,'day') + " ago. The likely window (" + windowTxt + ", the middle 50% of past gaps) has passed — now ~" + plural(m.overdueBy,'day') + " past the median estimate of " + plural(m.median,'day') + "."
    : "Last update (" + esc(m.last.version) + ") was " + plural(m.sinceLast,'day') + " ago. Past releases land ~" + m.p25 + "–" + m.p75 + " days apart (the middle 50% of gaps); the likely window is " + windowTxt + ".";
  document.getElementById('banner').innerHTML = \`
    <div>
      <div class="label">Predicted next update</div>
      <div class="date \${m.overdue?'overdue':''}">~\${fmt(m.predicted)}</div>
      <div class="sub">\${bannerSub}</div>
    </div>
    <div class="badge \${m.overdue?'overdue':'upcoming'}">
      <span class="dot"></span>\${m.overdue ? '~'+plural(m.overdueBy,'day')+' overdue (est.)' : 'Due in ~'+plural(-m.overdueBy,'day')}
    </div>\`;

  // Builds Polestar has registered in its content API but not yet released.
  const upcoming = (DATA.meta.upcoming || []).filter(u => u.internal_version);
  if (upcoming.length) {
    const rows = upcoming.map(u => {
      const name = u.version && u.version !== '0.0.0' ? esc(u.version) : 'Unnamed build';
      return \`<div class="up-row"><span class="ver">\${name}</span><span class="build" title="Internal build number; reads as year + week">\${buildLabel(u.internal_version)}</span></div>\`;
    }).join('');
    document.getElementById('upcoming').innerHTML = \`
      <details class="upcoming">
        <summary>
          <span class="ver">In the pipeline</span>
          <span class="count-pill">\${plural(upcoming.length,'build')}</span>
          <span class="meta-row">registered, not yet released<span class="chev">▾</span></span>
        </summary>
        <div class="up-body">
          <p class="hint">Polestar has registered these software versions in its content API, but hasn't published release notes for them yet — they're the likely next over-the-air updates. The week is when the build was created, not a release date.</p>
          \${rows}
        </div>
      </details>\`;
  }

  const stats = [
    ['Versions', m.total, ''],
    ['Avg. interval', Math.round(m.avg), '<small>days</small>'],
    ['Since last update', m.sinceLast, '<small>days</small>'],
    ['Cadence range', m.min+'–'+m.max, '<small>days</small>'],
  ];
  document.getElementById('stats').innerHTML = stats.map(([k,v,s]) =>
    \`<div class="stat"><div class="k">\${k}</div><div class="v">\${v} \${s}</div></div>\`).join('');

  document.getElementById('timeline-note').textContent =
    'newest first · ' + m.datedCount + ' dated · ' + m.unknownCount + ' undated';

  // gap = days from the next-older DATED entry in the displayed list
  const list = m.ups;
  const olderDated = (i) => { for(let j=i+1;j<list.length;j++){ if(list[j].d) return list[j]; } return null; };
  const gapLabel = (u, older) => {
    if(!u.d) return '';
    if(!older) return '<span class="gap zero" title="Oldest dated release — no earlier one to compare">first dated</span>';
    const g = daysBetween(older.d, u.d);
    if(g === 0) return '<span class="gap zero" title="Released the same day as the previous version">same day</span>';
    return \`<span class="gap" title="Days since the previous release">+\${plural(g,'day')}</span>\`;
  };
  const dateLabel = (u) => {
    if(!u.d) return '<span class="date unknown">date unknown</span>';
    if(u.date_estimated) return \`<span class="date est">≈ \${fmt(u.d)}</span>\`;
    return \`<span class="date">\${fmt(u.d)}</span>\`;
  };

  const html = '<div class="timeline">' + list.map((u,i)=>{
    const notes = (u.notes||[]).map(n=>\`<li>\${esc(n)}</li>\`).join('');
    return \`<div class="entry \${u.d?'':'nodate'}">
      <details>
        <summary>
          <span class="ver">\${esc(u.version)}</span>\${i===0 ? '<span class="latest-pill">latest</span>' : ''}
          <span class="meta-row">\${gapLabel(u, olderDated(i))}\${dateLabel(u)}<span class="chev">▾</span></span>
        </summary>
        <div class="notes">\${u.internal_version ? \`<div class="build-line" title="Internal build number; the week is when the build was created, not the release date">\${buildLabel(u.internal_version)}</div>\` : ''}<ul>\${notes}</ul></div>
      </details></div>\`;
  }).join('') + '</div>';
  document.getElementById('timeline-root').innerHTML = html;

  document.getElementById('footer').innerHTML = \`
    <p><strong>About the dates.</strong> \${esc(DATA.meta.timing_note)}</p>
    <p>Version notes sourced from <a href="\${DATA.meta.authoritative_source}" target="_blank" rel="noopener">Polestar's official release-notes API</a>
       (the JSON source behind the <a href="https://www.polestar.com/uk/manual/polestar-4/2025/software-updates/" target="_blank" rel="noopener">manual's software-updates page</a>;
       some notes apply to other markets or hardware variants only). Unofficial; not affiliated with Polestar.</p>\`;
}
render();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('Wrote index.html (' + html.length + ' bytes) from ' + data.updates.length + ' versions.');
