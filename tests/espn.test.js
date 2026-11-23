const { test, assert, sharedApp, CATS9, ESPN, between } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

// ----- ESPN -----
test('league IDs and addresses from either site', () => {
  assert.equal(app.parseLeagueId(' my19c8mwmoipvhon '), 'my19c8mwmoipvhon');
  assert.equal(app.parseLeagueId('https://www.fantrax.com/fantasy/league/my19c8mwmoipvhon/home'), 'my19c8mwmoipvhon');
  assert.equal(app.parseLeagueId('794342666'), '794342666');
  assert.equal(app.parseLeagueId('https://fantasy.espn.com/basketball/league?leagueId=794342666&seasonId=2027'), '794342666');
  assert.equal(app.parseLeagueId('fantasy.espn.com/basketball/team?seasonId=2027&leagueId=794342666&teamId=3'), '794342666');
  assert.equal(app.parseLeagueId('not a league'), null);
  assert.equal(app.leagueSourceOf('794342666'), 'espn');
  assert.equal(app.leagueSourceOf('my19c8mwmoipvhon'), 'fantrax');
});

test('reads a public ESPN league into the same shape as a Fantrax one', async () => {
  const L = await app.useLeague(ESPN);
  assert.equal(L.source, 'espn');
  assert.equal(L.name, 'Portland Pro H2H Points League');
  assert.equal(app.sourceName(L), 'ESPN');
  assert.deepEqual({ ...L.points }, { pts: 1, reb: 1, ast: 2, stl: 4, blk: 4, to: -2, fgm: 2, fga: -1, ftm: 1, fta: -1, tpm: 1 });
  assert.equal(app.leagueLineupMode(L), 'daily');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX', 'FLX', 'FLX'], bench: 3, ir: 1 });
  assert.equal(L.teams.length, 10);
  assert.ok(L.teams.every(t => typeof t.id === 'string' && t.name === t.name.trim()));
  // every roster: 10 starters, 3 bench; nearly everyone matched to an NBA player
  const all = Object.values(L.rosters).flat();
  assert.equal(all.length, 130);
  assert.equal(all.filter(x => x.st === 'ACTIVE').length, 100);
  assert.ok(all.filter(x => x.nba).length >= 125, 'rostered players matched to NBA.com');
  assert.equal(L.draft.picks.length, 130);
  assert.equal(L.draft.perRound, 10);
  assert.equal(L.standings.length, 10);
  assert.equal(L.playoffPeriod, 20);
});

test("ESPN's weeks get dates: Monday to Sunday, All-Star break joined to the next week", async () => {
  const L = await app.useLeague(ESPN);
  const span = n => { const p = L.periods.find(x => x.n === n); return p && `${p.start}..${p.end}`; };
  // as ESPN's own schedule page shows them
  assert.equal(L.periods[0].n, 3, "the league starts in week 3, so weeks 1 and 2 aren't its matchups");
  assert.equal(span(3), '2026-11-02..2026-11-08');
  assert.equal(span(17), '2027-02-08..2027-02-14');
  assert.equal(span(18), '2027-02-15..2027-02-28');
  assert.equal(span(19), '2027-03-01..2027-03-07');
  assert.equal(span(20), '2027-03-08..2027-03-21', 'two-week playoff rounds');
  assert.equal(span(21), '2027-03-22..2027-04-04');
  assert.deepEqual(Object.keys(L.matchups).map(Number), Array.from({ length: 17 }, (_, i) => i + 3), 'matchups only in league weeks; playoffs not set yet');
  assert.equal(app.matchDates('2027-02-15').length, 14);
  const me = L.teams[0].id;
  assert.equal(app.fxOpponentFor('2026-10-26', me), null, 'no matchup before the league starts');
  assert.ok(app.fxOpponentFor('2026-11-02', me), 'an opponent in week 3');
});

test('ESPN category scoring, and how a week is decided', () => {
  const items = [[19, 0], [20, 0], [17, 0], [0, 0], [6, 0], [3, 0], [2, 0], [1, 0], [11, 1], [35, 0]].map(([statId, rev]) => ({ statId, points: 0, isReverseItem: !!rev }));
  const sc = app.espnScoring({ scoringType: 'H2H_MOST_CATEGORIES', scoringItems: items });
  assert.equal(sc.cats.join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk,to');
  assert.deepEqual([...sc.catsOther], ['stat 35'], "a stat the site can't project is listed");
  assert.ok(app.mostCatsWins('H2H_MOST_CATEGORIES') && app.mostCatsWins('HEAD_TO_HEAD_ROTI_SINGLE_WIN'));
  assert.ok(!app.mostCatsWins('H2H_CATEGORY') && !app.mostCatsWins('H2H_POINTS'));
});

test('ESPN matchups project, and unrostered players are available', async () => {
  const L = await app.useLeague(ESPN);
  const [a, b] = L.matchups['3'][0];
  const A = app.fxTeamSide(a), B = app.fxTeamSide(b);
  assert.equal(A.lineup.filter(Boolean).length, 10, 'every starter in a lineup slot');
  const dates = app.matchDates('2026-11-02');
  assert.equal(dates.length, 7);
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  const fp = cats.find(c => c.fp);
  assert.ok(fp.a > 300 && fp.b > 300, `projected FP ${fp.a} vs ${fp.b}`);
  assert.ok(between(app.matchOdds(cats).win, 0, 1));

  // ESPN's player list marks who's on a roster; everyone else can be picked up
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    app.applyFantraxLeague(await app.getLeague(ESPN, true));
    const owned = app.nbaById.get(Object.values(L.rosters).flat().find(x => x.nba).nba);
    assert.ok(owned.fx && !app.fxAvailable(owned), 'a rostered player is taken');
    const free = app.NBA.players.find(r => r.fx && r.fx.st === 'A');
    assert.ok(free && app.fxAvailable(free), 'an unrostered player is available');
    assert.equal(app.FX_STATUS[free.fx.st], 'Available');
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
});

test('ESPN: weekly lineup history stays Fantrax-only, and nothing asks Fantrax for it', async () => {
  const L = await app.useLeague(ESPN);
  assert.ok(!app.hasLineupHistory(L));
  assert.ok(app.hasLineupHistory(await app.useLeague(CATS9)));
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = (url, init) => { calls.push(String(url)); return realFetch(url, init); };
  try { assert.equal(await app.fetchRosterWeeks(L), null); } finally { app.fetch = realFetch; }
  assert.equal(calls.length, 0);
});

test('ESPN: leagues are reused from the device, the player list fetched once, private leagues explained', async () => {
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = (url, init) => { calls.push(String(url)); return realFetch(url, init); };
  try {
    app.localStorage.removeItem('league-layer-espn-shared-v1');
    app.set('espnShared', null);
    await app.getLeague(ESPN, true);
    await app.getLeague(ESPN, true);
    assert.equal(calls.filter(u => u.includes('/players?')).length, 1, 'player list once a day');
    assert.equal(calls.filter(u => u.includes('/leagues/')).length, 2);
    calls.length = 0;
    await app.getLeague(ESPN);
    assert.equal(calls.length, 0, 'a fresh saved league needs no requests');
  } finally { app.fetch = realFetch; }
  app.fetch = (url, init) => (String(url).includes('/leagues/') ? Promise.resolve({ ok: false, status: 401, headers: { get: () => null } }) : realFetch(url, init));
  try { await assert.rejects(app.fetchEspnLeague('123456'), /private league/); } finally { app.fetch = realFetch; }
});
