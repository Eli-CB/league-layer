const { test, assert, sharedApp, CATS9, ESPN, useTeam, between, SLEEPER } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('season totals reproduce every week-1 result on Fantrax', async () => {
  const L = await app.useLeague(CATS9);
  const weeks = await app.loadRosterWeeks(L);
  const G = await app.loadGameLog('cur');
  const w1 = weeks.find(w => w.n === 1);
  const totals = app.pastSeasonTotals({ ...L, weeks: [w1], fidNba: app.currentFidNba() }, G);
  const tot = Object.fromEntries(Object.entries(totals).map(([tid, T]) => [tid, T.s]));
  for (const T of Object.values(totals)) assert.ok(between(T.gp, 15, 32), `${T.gp} player games: each game counted once`);
  const val = (s, c) => (c.pct ? s[c.made] / s[c.att] : s[c.key]);
  for (const [a, b] of L.matchups['1']) {
    let wa = 0, wb = 0;
    for (const c of app.scoreCats()) {
      const x = val(tot[a], c), y = val(tot[b], c);
      if (Math.abs(x - y) < 1e-9) continue;
      if (c.neg ? x < y : x > y) wa++; else wb++;
    }
    const ra = L.standings.find(r => r.id === a);
    const result = ra.w ? 'win' : ra.l ? 'loss' : 'tie';
    assert.equal(wa > wb ? 'win' : wa < wb ? 'loss' : 'tie', result, `${app.fxTeamName(a)} ${wa}-${wb} vs ${app.fxTeamName(b)}`);
  }
});

test("Standings' Categories won: each team's categories against its opponents, in all and one by one", async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const ui = app.get('ui');
  ui.season = 'czqgnyozmf2tbr93';
  let cw, cats, html;
  const was = { ...ui.cwSort };
  try {
    app.withSeason(() => {
      cats = app.scoreCats();
      cw = app.catsWonRecords(L, G);
      ui.tab = 'standings';
      html = app.viewStandings();
      ui.cwSort.key = 'pct';
      const card = app.viewStandings().split('class="cats-won"')[1].split('</table>')[0];
      const at = t => card.indexOf(`<b>${app.esc(t.name)}</b>`);
      const order = L.teams.filter(t => at(t) > 0).sort((a, b) => at(a) - at(b)).map(t => t.id);
      const pct = id => (cw[id].w + cw[id].t / 2) / (cw[id].w + cw[id].l + cw[id].t);
      assert.ok(order.length === L.teams.length && order.every((id, i) => !i || pct(order[i - 1]) >= pct(id) - 1e-9), 'sorted by Win %, best first');
    });
  } finally { Object.assign(ui.cwSort, was); ui.season = null; ui.tab = 'dashboard'; }
  const weeks = L.periods.filter(p => p.n < L.playoffPeriod).length;
  const teams = Object.values(cw);
  assert.equal(teams.length, L.teams.length, 'every team');
  for (const R of teams) {
    assert.equal(R.weeks, weeks, 'every regular-season week, no playoffs');
    assert.equal(R.w + R.l + R.t, weeks * cats.length, 'every category of every week');
    assert.ok(R.by.every(b => b.w + b.l + b.t === weeks), 'each category once a week');
    assert.equal(app.sum(R.by.map(b => b.w)), R.w);
  }
  assert.equal(app.sum(teams.map(R => R.w)), app.sum(teams.map(R => R.l)), "one team's category won is its opponent's lost");
  // the categories won add up to what decided the weeks: the champion of the regular season won more than he lost
  const top = L.standings.find(s => s.rank === 1).id;
  assert.ok(cw[top].w > cw[top].l);
  assert.match(html, /Categories won/);
  assert.match(html, /data-action="cw-sort"/);
  assert.ok(html.indexOf('Categories won') < html.indexOf('Season totals'), 'under the standings, before Season totals');
});

test("Season totals: a column sorted in a league with more of them doesn't break a league with fewer", async () => {
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui');
  useTeam(L.teams[0].id);
  ui.tab = 'standings';
  const was = { ...ui.totSort };
  try {
    app.viewStandings(); // starts loading the weekly lineups and box scores
    await new Promise(r => setTimeout(r, 30));
    ui.totSort.key = 14; // (a column of a league with more categories, picked there)
    const html = app.viewStandings();
    assert.match(html, /Season totals/);
    assert.match(html, /data-action="tot-sort"/, 'the table, in standings order');
    assert.equal(ui.totSort.key, null);
    ui.totSort.key = 'rank';
    app.viewStandings();
    assert.equal(ui.totSort.key, 'rank', 'its own columns stay picked');
  } finally { Object.assign(ui.totSort, was); ui.tab = 'dashboard'; }
});

test("Standings, not the Matchup tab: this period's moves, from last period's rosters to this one's", async () => {
  const L = await app.useLeague(CATS9);
  const fid = id => app.NBA.players.find(r => r.id === id).fx.id;
  const withFx = app.NBA.players.filter(r => r.fx).slice(0, 4);
  const [a, b, c, d] = withFx.map(r => r.fx.id);
  const [t1, t2] = L.teams.map(t => t.id);
  const owner = entries => new Map(entries.map(([f, tid]) => [f, { tid, on: true }]));
  const weeks = [{ n: 1, owner: owner([[a, t1], [b, t1], [c, t2]]) }, { n: 2, owner: owner([[a, t1], [d, t1], [b, t2]]) }];
  const moves = app.periodMoves({ ...L, rosterPeriod: 2 }, weeks);
  const kinds = tid => JSON.parse(JSON.stringify((moves[tid] || []).map(m => [m.kind, m.nba]))).sort();
  assert.deepEqual(kinds(t1), [['add', withFx[3].id], ['away', withFx[1].id]].sort(), `${app.fxTeamName(t1)} added one and traded one away`);
  assert.deepEqual(kinds(t2), [['drop', withFx[2].id], ['trade', withFx[1].id]].sort(), `${app.fxTeamName(t2)} traded for one and dropped one`);
  assert.equal(moves[t2].find(m => m.kind === 'trade').from, t1);
  assert.equal(app.periodMoves({ ...L, rosterPeriod: 1 }, weeks), null, 'week 1 has no week before it');
  assert.ok(fid(withFx[0].id));

  // drawn on Standings (once the weekly rosters are in), never on the Matchup tab
  const ui = app.get('ui');
  useTeam(t1);
  ui.tab = 'standings';
  try {
    app.viewStandings(); // starts loading the weekly rosters
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewStandings();
    if (L.rosterPeriod > 1) assert.match(html, /<div class="card rolls"[^>]*>\s*<div class="card-head"><h2>Moves this period/, `period ${L.rosterPeriod}: under the standings`);
    else assert.doesNotMatch(html, /Moves this period/, 'period 1: no period before it');
    assert.doesNotMatch(app.viewDashboard(), /Moves this period|Waiver wire|mv-teams/);
  } finally { ui.tab = 'dashboard'; }
});

test('the waiver order: from ESPN and Sleeper, a line under the standings and a popup; Fantrax shares none', async () => {
  const E = await app.useLeague(ESPN);
  assert.deepEqual(E.waivers.map(w => w.rank), E.waivers.map((w, i) => i + 1), 'first claim first');
  assert.ok(E.waivers.every(w => w.left === null), 'no budget in this league');
  const S = await app.useLeague(SLEEPER);
  assert.equal(S.waivers.length, 12);
  assert.equal(S.waivers[0].rank, 1);
  const st = app.get('state'), was = st.fxTeam;
  try {
    useTeam(S.waivers[2].id);
    const line = app.waiverLine();
    assert.ok(line.includes('<b>#3</b> of 12') && line.includes('data-action="waiver-order"'), line);
    assert.ok(app.viewStandings().includes(line), 'under the standings');
    assert.ok(!app.viewDashboard().includes('Action items') && !app.viewDashboard().includes('Injury news'), 'not on Matchup');
    const pop = app.waiverPopup();
    assert.equal((pop.match(/<li/g) || []).length, 12);
    assert.ok(pop.includes('class="me"') && pop.includes(app.fxTeamName(S.waivers[2].id)));
    const ui = app.get('ui');
    ui.season = 'past';
    try { assert.equal(app.waiverLine(), '', 'not while a past season is on screen'); } finally { ui.season = null; }
    // Fantrax doesn't share it: no item
    const F = await app.useLeague(CATS9);
    assert.equal(F.waivers, undefined);
    useTeam(F.teams[0].id);
    assert.equal(app.waiverLine(), '');
  } finally { st.fxTeam = was; }
});
