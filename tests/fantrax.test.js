const { test, assert, sharedApp, readFixture, CATS9, POINTS, DAILY, ESPN, answer } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('reads each league format from Fantrax', async () => {
  const cats = await app.useLeague(CATS9);
  assert.equal(cats.name, 'Keepers and Creepers');
  assert.deepEqual([...cats.cats], ['fgPct', 'ftPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to']);
  assert.equal(cats.points, undefined);
  assert.equal(app.leagueLineupMode(cats), 'weekly');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(cats))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'], bench: 5, ir: 1 });
  assert.equal(cats.playoffPeriod, 19);
  assert.equal(cats.standings.length, 10);

  const pts = await app.useLeague(POINTS);
  assert.deepEqual({ ...pts.points }, { ast: 1.5, blk: 2, pts: 1, reb: 1.25, stl: 2, to: -1 });
  assert.equal(app.leagueLineupMode(pts), 'weekly');
  assert.ok(app.slotsFromLeague(pts).slots.filter(s => s === 'FLX').length === 5, 'Flx slots map to FLX');

  const daily = await app.useLeague(DAILY);
  assert.equal(daily.points.dd, 3);
  assert.equal(daily.points.td, 6);
  assert.equal(app.leagueLineupMode(daily), 'daily');
  assert.ok(daily.rosterPeriods.length > 150, 'one lineup period per day');
});

test('points leagues: unusual scoring codes and position-specific points', () => {
  const ss = {
    type: 'HEAD_TO_HEAD_POINTS_BASED',
    scoringCategorySettings: [{ configs: [
      { position: { code: 'DEFAULT' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_POINTS', shortName: 'PTS' } },
      { position: { code: 'DEFAULT' }, points: '-0.5', scoringCategory: { code: 'INDIVIDUAL_FIELD_GOALS_MISSED', shortName: 'FGMI' } },
      { position: { code: 'DEFAULT' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_OFFENSIVE_REBOUNDS', shortName: 'OR' } },
      { position: { code: 'DEFAULT' }, points: '-2', scoringCategory: { code: 'INDIVIDUAL_TECHNICAL_FOULS', shortName: 'TF' } },
      { position: { code: 'C' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_BLOCKS', shortName: 'BLK' } },
    ] }],
  };
  const r = app.fxPointsScoring(ss);
  assert.deepEqual({ ...r.points }, { pts: 1, fgmi: -0.5, oreb: 1 });
  assert.deepEqual([...r.pointsOther], ['TF', 'position-specific points']);
});

test('Fantrax slot names', () => {
  assert.deepEqual(['Flx', 'Util', 'UT', 'PG', 'G/F', 'F/C'].map(s => app.fxSlot(s)), ['FLX', 'FLX', 'FLX', 'PG', 'G/F', 'F/C']);
});

test("before a period's first game the league's rosters are the week just played's: Fantrax's new period, from midnight, is next week's lineups", async () => {
  const fx = s => JSON.parse(readFixture(`fantrax/${CATS9}/${s}.json`)).rosters;
  const starters = r => Object.fromEntries(Object.entries(r).map(([tid, t]) => [tid, t.rosterItems.filter(x => x.status === 'ACTIVE').map(x => x.id).sort()]));
  const ours = r => Object.fromEntries(Object.entries(r).map(([tid, t]) => [tid, t.filter(x => x.st === 'ACTIVE').map(x => x.fid).sort()]));
  try {
    // Monday noon: Fantrax's own answer is already period 2, which starts at 7 PM ET
    app.setClock('2026-10-26T12:00:00-04:00');
    const L = await app.useLeague(CATS9);
    assert.equal(L.rosterPeriod, 1, 'this week: the one that ended last night');
    assert.deepEqual(ours(L.rosters), starters(fx('getTeamRosters-1')));
    assert.equal(L.nextRosters.period, 2, "next week's lineups: the ones being set");
    assert.deepEqual(ours(L.nextRosters.rosters), starters(fx('getTeamRosters')));
    assert.equal(app.fxPeriodFor(app.weekStartAt(0)).n, L.rosterPeriod, "the Matchup tab's week and its lineups agree");
    // tip-off: period 2 is this week
    app.setClock('2026-10-26T19:00:00-04:00');
    const M = await app.useLeague(CATS9);
    assert.equal(M.rosterPeriod, 2);
    assert.deepEqual(ours(M.rosters), starters(fx('getTeamRosters')));
  } finally { app.setClock(); await app.useLeague(CATS9); }
});

test('Fantrax names written differently still match (Nicolas / Nic Claxton)', async () => {
  const { fxPlayers } = await app.fetchFantraxLeague(CATS9);
  const nic = app.get('NBA').players.find(p => p.name === 'Nic Claxton');
  assert.ok(nic, 'fixture has Nic Claxton');
  const ids = JSON.parse(readFixture('fantrax/getPlayerIds.json'));
  const fid = Object.keys(ids).find(k => ids[k].name === 'Claxton, Nicolas');
  assert.equal(fxPlayers[nic.id] && fxPlayers[nic.id].id, fid);
});

test('Fantrax: leagues are reused from the device, shared lists fetched once, failures retried', async () => {
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = url => { calls.push(String(url)); return realFetch(url); };
  try {
    app.localStorage.removeItem('league-layer-fantrax-shared-v1');
    app.set('fxShared', null);
    await app.getLeague(POINTS, true);
    await app.getLeague(CATS9, true);
    assert.equal(calls.filter(u => u.endsWith('data/fantrax.json')).length, 1, "the site's own copy of the lists, once for both leagues");
    assert.equal(calls.filter(u => /getPlayerIds|getAdp/.test(u)).length, 0, 'Fantrax not asked for its lists');
    calls.length = 0;
    await app.getLeague(POINTS);
    assert.equal(calls.length, 0, 'a fresh saved league needs no requests');
  } finally { app.fetch = realFetch; }
  // the site's copy missing, or over 2 days old (the daily job stopped): Fantrax's own, once, matching the same players
  const fromFile = Object.keys((await app.fetchFantraxLeague(CATS9)).fxPlayers).sort();
  for (const answer of [() => Promise.resolve({ ok: false, status: 404 }), () => realFetch('data/fantrax.json').then(r => r.json())
    .then(f => ({ ok: true, status: 200, json: async () => ({ ...f, at: new Date(app.Date.now() - 3 * 864e5).toISOString() }) }))]) {
    calls.length = 0;
    app.fetch = url => { calls.push(String(url)); return String(url).endsWith('data/fantrax.json') ? answer() : realFetch(url); };
    try {
      app.localStorage.removeItem('league-layer-fantrax-shared-v1');
      app.set('fxShared', null);
      const { fxPlayers } = await app.fetchFantraxLeague(CATS9);
      assert.equal(calls.filter(u => u.includes('getPlayerIds')).length, 1);
      assert.equal(calls.filter(u => u.includes('getAdp')).length, 1);
      assert.deepEqual(Object.keys(fxPlayers).sort(), fromFile, "the site's copy matches the same players as Fantrax's");
    } finally { app.fetch = realFetch; }
  }
  app.set('fxShared', null);
  // a server error is retried, then the request succeeds
  let n = 0;
  app.fetch = url => (++n === 1 ? Promise.resolve({ ok: false, status: 503, headers: { get: () => '0' } }) : realFetch(url));
  try {
    const info = await app.fxGet(`getLeagueInfo?leagueId=${POINTS}`);
    assert.ok(info.teamInfo && n === 2, 'one retry after a 503');
  } finally { app.fetch = realFetch; }
  // a "not found" isn't retried
  n = 0;
  app.fetch = () => { n++; return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } }); };
  try { await assert.rejects(app.fxGet('getLeagueInfo?leagueId=nope')); assert.equal(n, 1); } finally { app.fetch = realFetch; }
});

test("a Fantrax league of a sport the site doesn't read (golf) says so, instead of loading as basketball", async () => {
  const group = code => ({ scoringSystem: { scoringCategorySettings: [{ group: { code } }] } });
  assert.equal(app.fxSport(group('BASKETBALL_PLAYER')), 'nba');
  assert.equal(app.fxSport(group('HOCKEY_SKATING')), 'nhl');
  assert.equal(app.fxSport(group('GOLF_GOLFER')), 'golf');
  assert.equal(app.fxSport(group('FOOTBALL_PLAYER')), 'football', 'football on Fantrax: not read yet (Sleeper and ESPN only)');
  assert.equal(app.fxSport({}), 'nba', "groups that don't say: basketball, as before");
  const err = await app.fetchFantraxLeague('golffixture0001').then(() => null, e => e);
  const golf = "That's a Fantrax golf league. On Fantrax, League Layer covers basketball and hockey leagues.";
  assert.equal(err && err.message, golf);
  assert.equal(app.leagueError('golffixture0001', err).message, golf, 'shown as it is');
  assert.equal(app.sportNotRead('Fantrax', 'football').message, "That's a Fantrax football league. On Fantrax, League Layer covers basketball and hockey leagues; football works with ESPN and Sleeper leagues.");
  assert.equal(app.sportNotRead('Sleeper', 'LCS').message, "That's a Sleeper LCS league. On Sleeper, League Layer covers basketball and football leagues.");
});

test("Fantrax's 'too many requests' in a normal answer waits as long as it says, then asks again", async () => {
  const realFetch = app.fetch;
  let limited = 1, calls = 0;
  const busy = JSON.stringify({ error: { onScreen: false, code: 'RATE_LIMITED', message: 'Too many requests - getDraftResults may be called at most once every 1 seconds per IP address.' } });
  app.fetch = (url, init) => {
    if (!String(url).includes('getDraftResults')) return realFetch(url, init);
    calls++;
    return limited-- > 0 ? Promise.resolve({ ok: true, status: 200, text: async () => busy }) : realFetch(url, init);
  };
  try {
    const t0 = Date.now();
    const { league } = await app.fetchFantraxLeague(POINTS);
    assert.ok(league.draft && league.draft.picks.length && !league.draftFailed, 'the draft, not "no draft"');
    assert.equal(calls, 2);
    assert.ok(Date.now() - t0 >= 1000, 'waited the second it asked for');
  } finally { app.fetch = realFetch; }
});
