const { test, assert, sharedApp, loadApp, readFixture, CATS9, POINTS, ESPN, useTeam } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('which game days belong to a lineup period', () => {
  const weekly = { start: '2026-10-20T15:00:00.0-0400', end: '2026-10-26T18:59:59.0-0400' };
  assert.ok(app.periodHas(weekly, '2026-10-20'));
  assert.ok(app.periodHas(weekly, '2026-10-25'));
  assert.ok(!app.periodHas(weekly, '2026-10-26'), "Monday's games after the 7 PM lock count for the next week");
  const daily = { start: '2026-11-03T00:00:00.0-0500', end: '2026-11-03T23:59:59.0-0500' };
  assert.ok(app.periodHas(daily, '2026-11-03'));
  assert.ok(!app.periodHas(daily, '2026-11-04'));
});

test('short names never collide', () => {
  const players = app.get('NBA').players;
  for (const fn of [app.lastName, app.shortName]) {
    const seen = new Map();
    for (const p of players) {
      const n = fn(p.name);
      assert.ok(!seen.has(n), `${p.name} and ${seen.get(n)} both show as ${n}`);
      seen.set(n, p.name);
    }
  }
  assert.equal(app.lastName('Nikola Jokić'), 'Jokić');
  assert.equal(app.lastName('Jamal Murray'), 'J. Murray');
  assert.equal(app.lastName('Dejounte Murray'), 'D. Murray');
});

test("a pick on Matchup's or Players' When menu and Plan Ahead's week hold over a refresh, until a new day or matchup week brings the defaults back", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.standings[0].id);
  const ui = app.get('ui');
  for (const k of ['dash', 'perf', 'week']) app.savePick(k); // (the weeks earlier tests picked)
  ui.tab = 'standings'; // (each pick draws the page again: no live scores read meanwhile)
  try {
    // picked: Matchup's Today, Players' This season per game, Plan Ahead's this period (it opened on next period)
    app.actions['dash-range']({ dataset: { range: 'today' } });
    ui.perfRange = 'year'; app.pickPerf(); // (the menu's change handler)
    app.actions['perf-per']({ dataset: { per: '1' } });
    Object.assign(ui, { tab: 'week', weekShift: 0, weekChosen: false });
    app.planAheadWeek();
    assert.equal(ui.weekShift, 1, 'Plan Ahead opens on next period');
    app.goWeek(0);
    // the page loaded again on this device
    const b = loadApp({ 'league-layer-picks': app.localStorage.getItem('league-layer-picks') });
    await b.ready();
    await b.useLeague(CATS9);
    const bu = b.get('ui');
    b.render(); clearTimeout(b.get('live').timer);
    assert.equal(bu.dashRange, 'today', "Matchup: Today, not the default");
    assert.deepEqual([bu.perfRange, bu.perfPer], ['year', true], 'Players: This season, per game');
    bu.tab = 'week';
    b.planAheadWeek();
    assert.equal(bu.weekShift, 0, 'Plan Ahead: this period, not next');
    // the next day: Matchup and Players back to their defaults; the same matchup week keeps Plan Ahead's
    b.setClock('2026-10-28T01:00:00Z');
    b.render(); clearTimeout(b.get('live').timer);
    assert.deepEqual([bu.dashRange, bu.perfRange, bu.perfPer], [null, null, false], 'a new day: the defaults');
    assert.equal(bu.weekShift, 0, 'still this matchup week');
    // and a pick that day holds for that day
    b.actions['dash-range']({ dataset: { range: 'week' } });
    b.render(); clearTimeout(b.get('live').timer);
    assert.equal(bu.dashRange, 'week');
    // the next matchup week: Plan Ahead opens on next period again, even on the page left open
    b.setClock('2026-11-03T01:00:00Z');
    b.planAheadWeek();
    assert.equal(bu.weekShift, 1, 'a new matchup week: next period');
    const c = loadApp({ 'league-layer-picks': JSON.stringify({ week: { v: 0, at: `${L.id}|2026-10-19` } }) });
    await c.ready();
    await c.useLeague(CATS9);
    Object.assign(c.get('ui'), { tab: 'week' });
    c.planAheadWeek();
    assert.equal(c.get('ui').weekShift, 1, 'a week picked in an earlier matchup week: next period');
    for (const x of [b, c]) { x.setClock(); clearTimeout(x.get('live').timer); }
  } finally {
    for (const k of ['dash', 'perf', 'week']) app.savePick(k);
    Object.assign(ui, { tab: 'dashboard', dashRange: null, perfRange: null, perfPer: false, weekShift: 0, weekChosen: false, weekAt: null });
  }
});

test("a league scored in whole points shows its scores without a .0; projections and averages keep theirs", async () => {
  await app.useLeague(ESPN); // 1 a point, 2 an assist, -1 a missed shot...
  assert.ok(app.wholePoints());
  assert.equal(app.fmtFp(112), '112');
  assert.equal(app.get('scoreLine')({ me: 112, opp: 98 }), '112–98');
  await app.useLeague(POINTS); // 1.25 a rebound
  assert.ok(!app.wholePoints());
  assert.equal(app.fmtFp(112.25), '112.3');
  assert.equal(app.get('scoreLine')({ me: 112.25, opp: 98 }), '112.3–98.0');
  await app.useLeague(CATS9);
  assert.ok(!app.wholePoints(), 'a category league has no points');
});

test("what's kept goes when what it was worked out from changes: one league's, or everyone's", () => {
  const recaps = app.get('recaps'), seasonTot = app.get('seasonTot'), pastWeeks = app.get('pastWeeks'), gameLogs = app.get('gameLogs'), weeksLoad = app.get('rosterWeeksLoad');
  const fill = () => { for (const id of ['aaa', 'bbb']) { recaps.set(`${id}|3`, {}); seasonTot[id] = {}; pastWeeks[id] = {}; weeksLoad[id] = Promise.resolve(null); } gameLogs.cur = {}; gameLogs['2024-25'] = {}; };
  try {
    fill();
    app.changed('box', 'aaa');
    assert.ok(!recaps.has('aaa|3') && !seasonTot.aaa && !pastWeeks.aaa && !('cur' in gameLogs), "new box scores: that league's recaps, totals and past weeks, and this season's game log");
    assert.ok(recaps.has('bbb|3') && seasonTot.bbb && pastWeeks.bbb, "another league's stay");
    assert.ok(weeksLoad.aaa && gameLogs['2024-25'], "its weekly rosters and a past season's log don't depend on box scores");
    fill();
    app.changed('league', 'aaa');
    assert.ok(!weeksLoad.aaa && !recaps.has('aaa|3') && weeksLoad.bbb, 'the league read again: its rosters too');
    app.changed('league');
    assert.ok(!weeksLoad.bbb && !recaps.has('bbb|3') && !seasonTot.bbb, 'no id: every league');
  } finally { for (const id of ['aaa', 'bbb']) { recaps.delete(`${id}|3`); delete seasonTot[id]; delete pastWeeks[id]; delete weeksLoad[id]; } delete gameLogs.cur; delete gameLogs['2024-25']; }
});

test('a stand-in draw (another team on the page): your own state is back afterwards, and nothing saves meanwhile', () => {
  const key = app.get('STORAGE_KEY'), ls = app.localStorage, name = app.get('state').teamName, was = ls.getItem(key);
  try {
    ls.setItem(key, 'untouched');
    const out = app.withState({ teamName: 'Someone else' }, () => { app.save(); return app.get('state').teamName; });
    assert.equal(out, 'Someone else', 'the stand-in is what the draw reads');
    assert.equal(app.get('state').teamName, name, 'and your own is back');
    assert.equal(ls.getItem(key), 'untouched', "a save while standing in doesn't keep the other team as yours");
    assert.throws(() => app.withState({ teamName: 'x' }, () => { throw new Error('boom'); }), /boom/);
    assert.equal(app.get('state').teamName, name, 'back after a draw that fails too');
    app.save();
    assert.notEqual(ls.getItem(key), 'untouched', 'saving works again');
  } finally { if (was == null) ls.removeItem(key); else ls.setItem(key, was); }
});

test('box scores by month: the same season as the one file, each month at its own address', async () => {
  const one = await app.loadBoxes();
  const want = { finals: [...one.finals].sort(), players: one.byPlayer.size, lines: [...one.byPlayer.values()].reduce((n, g) => n + g.length, 0) };
  const all = JSON.parse(readFixture('boxscores.json'));
  const months = [...new Set(Object.values(all.games).map(g => g.d.slice(0, 7)))].sort();
  assert.ok(months.length >= 1);
  const NBA = app.get('NBA'), urls = [], realFetch = app.fetch;
  app.fetch = url => { urls.push(String(url)); return realFetch(url); };
  try {
    NBA.box = Object.fromEntries(months.map((m, i) => [m, `v${i}`])); // as the daily job writes it: month -> version
    app.changed('sport'); // (drops the box scores it has)
    const got = await app.loadBoxes();
    assert.deepEqual(urls.filter(u => u.includes('box')).sort(), months.map((m, i) => `data/box/${m}.json?v=v${i}`), 'one request a month, its version in the address; not the one file');
    assert.deepEqual([...got.finals].sort(), want.finals, 'every game of the season');
    assert.equal(got.byPlayer.size, want.players);
    assert.equal([...got.byPlayer.values()].reduce((n, g) => n + g.length, 0), want.lines, "and every player's lines, once");
    // a month that fails to load fails the lot (no season with a hole in it), and the next ask tries again
    app.changed('sport');
    NBA.box = { ...NBA.box, '2031-01': 'x' };
    await assert.rejects(app.loadBoxes(), /answered 404/);
    assert.equal(app.get('BOX'), null);
  } finally {
    app.fetch = realFetch;
    delete NBA.box;
    app.changed('sport');
    await app.ready();
    await app.loadBoxes();
  }
});

test('times follow the 24-hour setting', () => {
  const ui = app.get('ui'), was = ui.clock24;
  try {
    ui.clock24 = true;
    assert.match(app.fmtTime('2026-11-02T19:05:00'), /^19:05$/);
    assert.match(app.fmtTime('2026-11-02T09:05:00'), /^09:05$/);
    ui.clock24 = false;
    assert.match(app.fmtTime('2026-11-02T19:05:00'), /^7:05\s?p\.?m\.?$/i);
  } finally { ui.clock24 = was; }
});

test("a day's weekday is fmtWeekday, never fmtDay cut at a comma (en-GB has none: the Rest of the period tiles read \"Wed 25 Nov\")", () => {
  assert.equal(app.fmtWeekday('2026-11-25'), 'Wed');
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    assert.ok(!/\.split\(['"],['"]\)\[0\]/.test(fs.readFileSync(path.join(dir, f), 'utf8')), `${f} cuts a date at its comma: use fmtWeekday`);
  }
});

test('Player names: full (shortened on phones), last names or nicknames from the list, basketball only, kept on the device', async () => {
  const a = loadApp({ 'league-layer-names': 'nick' });
  await a.ready();
  const ui = a.get('ui'), SGA = 1628983;
  assert.equal(ui.names, 'nick', 'the choice saved on the device');
  assert.equal(loadApp({ 'league-layer-names': 'constructor' }).get('ui').names, 'full', 'anything else saved: full names');
  ui.names = 'full';
  assert.equal(a.nameShown('Shai Gilgeous-Alexander', SGA), 'Shai Gilgeous-Alexander');
  assert.equal(a.nameShown('Jaime Jaquez Jr.', null, 'short'), 'J. Jaquez Jr.');
  assert.equal(a.nameShown('Jaime Jaquez Jr.', null, 'last'), 'Jaquez', "a spot that shows last names keeps them");
  assert.equal(a.playerBtn(SGA, 'Shai Gilgeous-Alexander'), '<button type="button" class="link-btn pname" data-action="player-detail" data-nba="1628983">Shai Gilgeous-Alexander</button>');
  ui.names = 'last';
  assert.equal(a.nameShown('Nikola Jokić'), 'Jokić');
  assert.equal(a.nameShown('Jamal Murray', null, 'short'), 'J. Murray', 'a shared last name gets the initial');
  assert.match(a.playerBtn(SGA, 'Shai Gilgeous-Alexander'), /title="Shai Gilgeous-Alexander">Gilgeous-Alexander</);
  assert.equal(a.playerName({ nbaId: SGA, name: 'Shai Gilgeous-Alexander' }).includes('n-short'), false, 'one name, no phone version');
  ui.names = 'nick';
  assert.equal(a.nameShown('Shai Gilgeous-Alexander', SGA, 'short'), 'SGA');
  assert.equal(a.nameShown('S. Gilgeous-Alexander', SGA), 'SGA', "by his id, whatever the league's site calls him");
  assert.equal(a.nameShown('Luka Doncic'), 'Luka', 'accents or not');
  assert.equal(a.nameShown('Tyrese Maxey', null, 'short'), 'T. Maxey', 'no nickname: as the spot shows it');
  assert.match(a.playerBtn(SGA, 'Shai Gilgeous-Alexander'), /title="Shai Gilgeous-Alexander">SGA</);
  assert.match(a.playerName({ nbaId: 2544, name: 'LeBron James' }), />LBJ<\/button>/);
  const list = a.get('NICKNAMES').nba, nicks = Object.values(list);
  assert.equal(new Set(nicks.map(n => n.toLowerCase())).size, nicks.length, 'each nickname is one player\'s');
  const shown = new Map(a.get('NBA').players.map(p => [a.nameShown(p.name, p.id).toLowerCase(), p.name]));
  assert.equal(shown.size, a.get('NBA').players.length, 'no two players show the same name');
  // the setting: in the settings menu, saved on the device (full names: forgotten)
  const gear = a.document.createElement();
  a.document.querySelector = sel => (sel === '#gearMenu' ? gear : a.document.createElement());
  a.gearMenu();
  assert.equal(gear.innerHTML.match(/data-action="set-names"/g).length, 3, 'a Full / Last / Nick toggle');
  assert.match(gear.innerHTML, /class="on" data-action="set-names" data-names="nick"[^>]*>Nick</);
  a.get('actions')['set-names']({ dataset: { names: 'last' } });
  assert.equal(a.localStorage.getItem('league-layer-names'), 'last');
  a.get('actions')['set-names']({ dataset: { names: 'full' } });
  assert.equal(a.localStorage.getItem('league-layer-names'), null);
  // another sport has no list: no setting, full names
  ui.names = 'nick';
  const nba = a.get('SPORT');
  a.set('SPORT', a.get('SPORTS').nhl);
  try {
    assert.equal(a.nameShown('Shai Gilgeous-Alexander', SGA), 'Shai Gilgeous-Alexander');
    a.gearMenu();
    assert.doesNotMatch(gear.innerHTML, /set-names/);
  } finally { a.set('SPORT', nba); }
});
