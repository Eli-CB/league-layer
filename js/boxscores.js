// League Layer: this season's box scores: the daily job's files, loaded once a sport, for Season totals, Awards, Live and Trends.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

let boxLoad = null;
let BOX = null; // { cols, byPlayer, finals, scores, day } once loaded: loadBoxes, the first time a tab needs them
keep('sport', () => { BOX = null; boxLoad = null; });

// a box score line with the counts some leagues score: double-doubles, triple-doubles, games
function boxCounts(st) {
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(k => st[k] >= 10).length;
  return Object.assign(st, { dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 });
}

// The season's box scores as the daily job publishes them: one file per month (NBA.box: month -> its version, which is in
// the file's address), so the browser keeps a finished month and downloads only the month underway each day. A data file
// from before months had the whole season in boxscores.json, new every day.
async function boxFiles() {
  const dir = SPORT.data, months = Object.entries(NBA.box || {});
  const get = url => getJson(url, 'League Layer', undefined, 3); // (a dropped connection or a server hiccup: asked again)
  if (!months.length) return get(`${dir}boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`);
  const parts = await Promise.all(months.map(([month, v]) => get(`${dir}box/${month}.json?v=${v}`)));
  return { ...parts[0], games: Object.assign({}, ...parts.map(p => p.games)) };
}

// (a load started for another sport, finishing after a switch, isn't this page's: it gives way to this sport's load. It
// used to land in BOX, the other sport's games under this one's players, and could leave a tab on "Loading" until a click)
let boxFail = ''; // the last load's failure, for a tab with nothing else to show (boxWait)
keep('sport', () => { boxFail = ''; });
function loadBoxes() {
  if (boxLoad) return boxLoad;
  const sport = SPORT;
  const load = boxLoad = boxFiles().then(data => {
    if (SPORT !== sport) return loadBoxes();
    const unique = new Map(), cols = data.keys || SPORT.boxCols; // (a box row's columns, as boxGameLog reads them too)
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    const scores = new Map(); // "date team" -> { home, away, hs, as, last } (last: hockey's REG / OT / SO)
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      const s = { home: g.home, away: g.away, hs: g.hs, as: g.as, last: g.last };
      scores.set(`${g.d} ${g.home}`, s).set(`${g.d} ${g.away}`, s);
      for (const row of g.rows) {
        const st = boxCounts(Object.fromEntries(cols.map((k, i) => [k, +row[i + 2] || 0])));
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin, row[1]]);
      }
    }
    BOX = { cols, byPlayer, finals, scores, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
    boxFail = '';
    dropPlayedInjuries();
    return BOX;
  }).catch(e => { if (boxLoad === load) { boxLoad = null; boxFail = e.message || 'no answer'; } throw e; });
  return load;
}
// A tab that needs the box scores and has nothing to show without them (Live, Trends): loads them (drawn again when
// they're in), and meanwhile a loading card, or what went wrong with Try again ('box-retry')
function boxWait(tab, title, text) {
  if (boxFail && !boxLoad) return `<div class="card"><div class="empty"><strong>Couldn't load the box scores</strong>${esc(boxFail)}. <button type="button" class="link-btn" data-action="box-retry">Try again</button></div></div>`;
  loadBoxes().then(() => { if (ui.tab === tab) render(); }).catch(() => { if (ui.tab === tab) render(); });
  return loadingCard(title, text);
}
