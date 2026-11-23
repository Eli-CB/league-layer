const { test, assert, sharedApp, CATS9, POINTS, onDay } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("Trends: last 5 games against the usual one, per category, with the reason when the box scores tell it", async () => {
  const L = await app.useLeague(CATS9);
  await app.loadBoxes();
  const saved = app.get('BOX'), ui = app.get('ui');
  const [hot, cold, star] = app.NBA.players.filter(r => r.team && !r.pos.includes('G')).slice(0, 3);
  const line = (min, pts) => ({ min, pts, reb: 4, ast: 2, stl: 1, blk: 0, tpm: 1, to: 1, fgm: 5, fga: 10, ftm: 2, fta: 3 });
  const days = Array.from({ length: 15 }, (_, i) => app.addDays('2026-10-11', i)); // Oct 11 - 25: 10 earlier games, then 5
  const games = (f, team = 'AAA') => days.map((d, i) => [d, f(i), 0, team]).filter(g => g[1]);
  const byPlayer = new Map([
    [hot.id, games(i => (i < 10 ? line(20, 6) : line(28, 12)))], // more minutes, double the points
    [cold.id, games(i => (i < 10 ? line(30, 20) : line(30, 8)), 'BBB')],
    [star.id, games(i => (i < 10 ? line(34, 25) : null))], // a regular who's missed the last five
  ]);
  app.set('BOX', { ...saved, cols: app.SPORT.boxCols, byPlayer });
  try {
    const html = await onDay('2026-10-26', () => app.trendsCard(L, '2026-10-25'));
    const head = label => `>${label}<span class="tr-chev" aria-hidden="true">›</span></button></h3>`; // (a list's name: the button that opens its card)
    const section = (h, label) => h.split('<section class="tr-cat').find(x => x.includes(head(label))) || '';
    const pts = section(html, 'Points');
    assert.ok(pts.includes(`data-nba="${hot.id}"`) && pts.includes('<b>12.0</b> <span class="muted">vs 6.0</span>') && pts.includes('+100%'), 'heating up in points: 12.0 vs 6.0, +100%');
    assert.match(pts, new RegExp(`with ${app.lastName(star.name, true)} out`), 'a regular teammate out');
    assert.match(pts, /minutes 20 → 28/);
    assert.ok(!pts.includes(`data-nba="${cold.id}"`), 'not the one cooling off');
    assert.ok(section(html, 'Minutes').includes('<b>28.0</b> <span class="muted">vs 20.0</span>'), 'the role list');
    assert.ok(!/Last 5 games through/.test(html), 'the dates are in the (i), not on the page');
    assert.ok(html.indexOf(head('Minutes')) < html.indexOf(head('Points')), 'Minutes first');
    ui.trendDir = 'down';
    const down = section(await onDay('2026-10-26', () => app.trendsCard(L, '2026-10-25')), 'Points');
    assert.ok(down.includes(`data-nba="${cold.id}"`) && down.includes('<b>8.0</b> <span class="muted">vs 20.0</span>') && down.includes('−60%'), 'cooling off: 8.0 vs 20.0, -60%');
    // no league (browsing): through a day, one list by value for everyone
    const st = app.get('state'), wasBrowse = st.browse;
    st.browse = true; // (no league: fxLeague() is null)
    try {
      assert.equal(app.fxLeague(), null);
      ui.trendDir = 'up';
      const all = await onDay('2026-10-26', () => app.trendsCard(null, '2026-10-25'));
      const list = all.split('<section class="tr-cat"').find(x => x.includes('All players')) || '';
      assert.ok(list.includes('data-action="trend-cat" data-key="value" data-whose="all"'), 'its card: everyone');
      assert.ok(list.includes(`data-nba="${hot.id}"`), 'the one heating up, by value');
      assert.ok(!all.includes('data-whose="rostered"') && !all.includes('data-whose="waivers"'), 'no Rostered or Waivers lists');
      assert.ok(section(all, 'Points').includes(`data-nba="${hot.id}"`), 'the categories as in a league');
      // the sandbox with him on My team: My team's list has him, everyone else's doesn't, and he's marked as yours
      const wasRoster = app.sbState().roster;
      app.sbState().roster = [hot.id];
      try {
        const mine = await onDay('2026-10-26', () => app.trendsCard(null, '2026-10-25'));
        const lists = mine.split('<section class="tr-cat"');
        assert.ok((lists.find(x => x.includes('data-whose="mine"')) || '').includes(`data-nba="${hot.id}"`), 'My team');
        assert.ok(!(lists.find(x => x.includes('data-whose="others"')) || '').includes(`data-nba="${hot.id}"`), 'not everyone else');
        assert.ok(section(mine, 'Points').includes('<span class="perf-owner mine"><span class="team-mine">My team</span></span>'), 'his row says so');
      } finally { app.sbState().roster = wasRoster; }
    } finally { st.browse = wasBrowse; ui.trendDir = 'down'; }
    // too few games: nothing to say yet
    app.set('BOX', { ...saved, cols: app.SPORT.boxCols, byPlayer: new Map([[hot.id, games(i => (i > 8 ? line(20, 6) : null))]]) });
    assert.match(await onDay('2026-10-26', () => app.trendsCard(L, '2026-10-25')), /Not enough games yet/);
    // a tab of their own, after Players, with the league's teams; not under the Recap any more, and not in football
    app.set('BOX', { ...saved, cols: app.SPORT.boxCols, byPlayer });
    ui.trendDir = 'up';
    assert.equal(app.tabList().map(t => t[0]).join(), 'dashboard,week,recap,players,trends,draft,standings,awards,trade');
    const tab = app.viewTrends();
    assert.ok(tab.includes('<div class="card trends">') && /data-whose="(rostered|waivers)"[^>]*>(Rostered|Waivers)</.test(tab) && !tab.includes('All players') && !tab.includes('No league connected'));
    assert.ok(!app.SPORTS.nfl.soonTabs.includes('recap') && app.SPORTS.nfl.soonTabs.includes('trends'));
    // a value's move keeps its "+" on Trends, as every list's change does (the owner's call, Nov 23, 2026), though VAL has none elsewhere
    const moves = [...tab.matchAll(/class="tr-num"[^>]*><b>[^<]*<\/b><div class="small pos-good">([^<]*)</g)].map(m => m[1]);
    assert.ok(moves.length && moves.every(m => /^\+\d\.\d\d$/.test(m)), moves.join());
    ui.tab = 'recap';
    app.viewRecap();
    await new Promise(r => setTimeout(r, 20));
    const recap = app.viewRecap();
    assert.ok(/Period \d+ recap/.test(recap) && !recap.includes('class="card trends"'), 'the Recap is the week alone');
  } finally { app.set('BOX', saved); ui.trendDir = 'up'; ui.tab = 'dashboard'; }
});

test("a Trends list's name opens it in full: everyone in it, game by game, 25 at a time, sortable, either way, anyone's", async () => {
  const L = await app.useLeague(CATS9);
  await app.loadBoxes();
  const saved = app.get('BOX'), ui = app.get('ui');
  const doc = app.document, realQuery = doc.querySelector, els = {};
  doc.querySelector = sel => (['#detailBody', '#detailTitle', '#detailDialog'].includes(sel) ? (els[sel] = els[sel] || { innerHTML: '', open: false, scrollTop: 0, showModal() { this.open = true; }, close() { this.open = false; } }) : realQuery(sel));
  // 30 players heating up in points (the last one most: 6 a game, then 8 to 37), the first also shooting 8 of 10, and one cooling off
  const P = app.NBA.players.filter(r => r.team && !r.pos.includes('G')).slice(0, 31);
  const line = (min, pts, fgm = 5) => ({ min, pts, reb: 4, ast: 2, stl: 1, blk: 0, tpm: 1, to: 1, fgm, fga: 10, ftm: 2, fta: 3 });
  const days = Array.from({ length: 15 }, (_, i) => app.addDays('2026-10-11', i));
  const games = f => days.map((d, i) => [d, f(i), 0, 'AAA']);
  const byPlayer = new Map(P.slice(0, 30).map((r, k) => [r.id, games(i => (i < 10 ? line(20, 6) : line(28, 8 + k, k ? 5 : 8)))]));
  byPlayer.set(P[30].id, games(i => line(30, i < 10 ? 20 : 8)));
  app.set('BOX', { ...saved, cols: app.SPORT.boxCols, byPlayer, finals: new Set(['2026-10-25 AAA']) });
  const rows = () => (els['#detailBody'].innerHTML.split('<tbody>')[1] || '').split('</tbody>')[0].split('<tr>').slice(1);
  const ids = () => rows().map(r => +r.match(/data-action="player-detail" data-nba="(\d+)"/)[1]);
  try {
    ui.trendDir = 'up';
    const tab = app.viewTrends();
    assert.match(tab, /data-action="trend-cat" data-key="pts"[^>]*>Points<span class="tr-chev"/, "a list's name is the button");
    app.actions['trend-cat']({ dataset: { key: 'pts' } });
    assert.equal(els['#detailDialog'].open, true);
    assert.match(els['#detailTitle'].innerHTML, /<span class="dt-name">Points <button[^>]*data-action="info" data-key="trendCard"[\s\S]*?<\/span><span class="dt-bio">30 players · through Oct 25<\/span>/);
    assert.equal(rows().length, 25, '25 at a time');
    assert.match(els['#detailBody'].innerHTML, /data-action="trend-more">Show 5 more</);
    // the one who moved most first: his 5 games (above his usual: green), their average, his usual, his season, his minutes, the change
    const top = rows()[0];
    assert.equal(ids()[0], P[29].id);
    assert.equal([...top.matchAll(/<td class="sc tr-g" title="[^"]+"><span class="tr-gv hi">37<\/span><\/td>/g)].length, 5, 'each game, green');
    assert.ok(top.includes('<td class="sc"><b>37.0</b></td><td class="sc">6.0</td><td class="sc">16.3</td>'), 'average 37, usual 6, season 16.3');
    assert.ok(top.includes('20<span class="muted">→</span>28'), 'minutes, usual → last 5');
    assert.match(top, /<span class="pos-good">\+31\.0<\/span><div class="tr-sub">\+517%<\/div>/);
    assert.ok(!els['#detailBody'].innerHTML.includes(`data-nba="${P[30].id}"`), 'not the one cooling off');
    // Show more, then the change the other way round (a column's heading: smallest first once clicked again)
    app.actions['trend-more']();
    assert.equal(rows().length, 30);
    assert.ok(!els['#detailBody'].innerHTML.includes('trend-more'));
    app.actions['trend-sort']({ dataset: { key: 'move' } });
    assert.equal(ids()[0], P[0].id, 'the smallest change first');
    assert.match(rows()[0], /<span class="perf-rank">30<\/span>/, 'still ranked 30th');
    // whose: a league's teams today or its waivers, never both
    const owned = new Set(Object.values(L.rosters).flat().map(x => x.nba));
    app.actions['trend-whose']({ dataset: { whose: 'rostered' } });
    const mine = ids();
    app.actions['trend-whose']({ dataset: { whose: 'waivers' } });
    const free = ids();
    assert.ok(mine.length && free.length && mine.every(id => owned.has(id)) && free.every(id => !owned.has(id)) && mine.length + free.length <= 30);
    assert.match(els['#detailBody'].innerHTML, /data-whose="waivers" aria-pressed="true"/);
    // a fantasy team's name is text, never HTML (its members type it)
    const team = L.teams.find(t => (L.rosters[t.id] || []).some(x => x.nba === mine[0])), was = team.name;
    team.name = `"'<i id=xss>`;
    try {
      app.actions['trend-whose']({ dataset: { whose: 'rostered' } });
      assert.ok(els['#detailBody'].innerHTML.includes('&quot;&#39;&lt;i id=xss&gt;') && !els['#detailBody'].innerHTML.includes('<i id=xss>'));
    } finally { team.name = was; }
    // the other way: the one cooling off, the card and the tab both
    app.actions['trend-whose']({ dataset: { whose: 'all' } });
    app.actions['trend-dir']({ dataset: { dir: 'down', card: '1' } });
    assert.equal(ui.trendDir, 'down');
    assert.deepEqual(ids(), [P[30].id]);
    assert.match(rows()[0], /<td class="sc tr-g" title="[^"]+"><span class="tr-gv lo">8<\/span><\/td>/, 'below his usual: red');
    // a shooting percentage: each game's makes and attempts, his attempts a game, the makes a game above his usual rate
    ui.trendDir = 'up';
    const fg = app.scoreCats().find(c => c.pct && c.made === 'fgm');
    app.actions['trend-cat']({ dataset: { key: fg.key } });
    assert.deepEqual(ids(), [P[0].id]);
    assert.equal([...rows()[0].matchAll(/<td class="sc tr-g" title="[^"]+"><span class="tr-gv hi">8\/10<\/span><\/td>/g)].length, 5);
    assert.match(rows()[0], /\+3\.0<\/span><div class="tr-sub">makes<\/div>/);
    // by value, from Rostered: that list's players first
    app.actions['trend-cat']({ dataset: { key: 'value', whose: 'rostered' } });
    assert.match(els['#detailTitle'].innerHTML, /<span class="dt-name">Value </);
    assert.match(els['#detailBody'].innerHTML, /data-whose="rostered" aria-pressed="true"/);
    assert.ok(ids().length && ids().every(id => owned.has(id)));
    // a list the league doesn't have: nothing opens
    els['#detailBody'].innerHTML = '';
    app.actions['trend-cat']({ dataset: { key: 'nope' } });
    assert.equal(els['#detailBody'].innerHTML, '');
    // a points league: its fantasy points, a list of their own and by value (one decimal, signed)
    await app.useLeague(POINTS);
    app.set('BOX', { ...saved, cols: app.SPORT.boxCols, byPlayer, finals: new Set(['2026-10-25 AAA']) });
    app.actions['trend-cat']({ dataset: { key: 'fp' } });
    assert.match(els['#detailTitle'].innerHTML, /<span class="dt-name">Fantasy points /);
    assert.ok(rows().length > 0 && rows().every(r => /<span class="pos-good">\+\d+\.\d<\/span>/.test(r)));
    app.actions['trend-cat']({ dataset: { key: 'value', whose: 'waivers' } });
    assert.match(els['#detailTitle'].innerHTML, /<span class="dt-name">Fantasy points /);
    assert.ok(rows().every(r => /<span class="pos-good">\+\d+\.\d<\/span>/.test(r)));
  } finally { app.set('BOX', saved); ui.trendDir = 'up'; ui.trendCard = null; doc.querySelector = realQuery; }
});
