const { test, assert, sharedApp, CATS9, YAHOO, yahooSignedIn } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("Yahoo's JSON: numbered objects become lists, one-key arrays become objects", () => {
  const f = app.yflat;
  assert.deepEqual(JSON.parse(JSON.stringify(f({ 0: { team: 1 }, 1: { team: 2 }, count: 2 }))), [{ team: 1 }, { team: 2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(f([{ a: 1 }, [], { b: 2 }]))), { a: 1, b: 2 }, 'empty arrays among them are dropped');
  assert.deepEqual(JSON.parse(JSON.stringify(f([{ position: 'PG' }, { position: 'G' }]))), [{ position: 'PG' }, { position: 'G' }], 'a shared key stays a list');
  assert.deepEqual(JSON.parse(JSON.stringify(f({ week: '1', 0: { teams: [] } }))), { 0: { teams: [] }, week: '1' }, 'no count: an ordinary object');
});

test('Yahoo league IDs and addresses', () => {
  assert.equal(app.parseLeagueId('https://basketball.fantasysports.yahoo.com/nba/777'), 'nba.l.777');
  assert.equal(app.parseLeagueId('466.l.777'), '466.l.777');
  assert.equal(app.leagueSourceOf('nba.l.777'), 'yahoo');
  assert.equal(app.leagueSourceOf('794342666'), 'espn', 'ESPN still all digits');
  assert.equal(app.sourceName({ source: 'yahoo' }), 'Yahoo');
});

test('Yahoo: sign-in needed, an expired token renewed, the leagues on the account', async () => {
  app.get('yahoo').proxy = 'https://yahoo.test';
  app.localStorage.removeItem('league-layer-yahoo');
  await assert.rejects(app.yahooGet('users;use_login=1/games;game_keys=nba/leagues'), /yahoo sign-in/);
  assert.equal(app.leagueError(YAHOO, new Error('yahoo sign-in')).message, app.get('YAHOO_CLOSED'), 'before Yahoo approves, no button to send them to');
  app.localStorage.setItem('league-layer-yahoo-beta', '1');
  assert.match(app.leagueError(YAHOO, new Error('yahoo sign-in')).message, /Sign in with Yahoo/, 'a tester has the button');
  app.localStorage.removeItem('league-layer-yahoo-beta');
  yahooSignedIn({ access: 'old', refresh: 'r', until: app.NOW - 1 });
  const leagues = [...await app.yahooLeagues()];
  assert.equal(JSON.parse(app.localStorage.getItem('league-layer-yahoo')).access, 'new', 'renewed before asking');
  assert.deepEqual(JSON.parse(JSON.stringify(leagues)), [{ key: '466.l.777', name: 'Test Hoops', teams: 4, season: 2026 }]);
  // back from Yahoo's sign-in: the tokens after #yahoo= are kept and the address tidied
  const loc = app.location;
  loc.hash = '#yahoo=' + encodeURIComponent(Buffer.from(JSON.stringify({ access: 'x', refresh: 'y', until: 1 })).toString('base64'));
  assert.equal(app.yahooFromAddress(), 'in');
  assert.equal(JSON.parse(app.localStorage.getItem('league-layer-yahoo')).refresh, 'y');
  loc.hash = '#yahoo-error=access_denied';
  assert.match(app.yahooFromAddress(), /cancelled/);
  loc.hash = '';
  assert.equal(app.yahooFromAddress(), null);
  app.get('yahoo').proxy = '';
});

test('a Yahoo league becomes the same league as the others', async () => {
  yahooSignedIn();
  try {
    const L = await app.useLeague(YAHOO);
    assert.equal(L.source, 'yahoo');
    assert.equal(L.name, 'Test Hoops');
    assert.equal(L.year, 2026);
    assert.deepEqual([...L.cats], ['fgPct', 'ftPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'], "the league's 9 categories; FGM/A only on display");
    assert.deepEqual([...L.teams.map(t => t.name)], ['Alpha Dogs', 'Beta Ballers', 'Gamma Rays', 'Delta Force']);
    assert.deepEqual(JSON.parse(JSON.stringify(L.periods.map(p => [p.n, p.start, p.end]))), [[1, '2026-10-20', '2026-10-25'], [2, '2026-10-26', '2026-11-01'], [3, '2026-11-02', '2026-11-08']]);
    assert.deepEqual(JSON.parse(JSON.stringify(L.matchups['2'])), [['466.l.777.t.1', '466.l.777.t.3'], ['466.l.777.t.2', '466.l.777.t.4']]);
    assert.equal(L.playoffPeriod, 3);
    assert.equal(app.leagueLineupMode(L), 'daily');
    assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SF', 'FLX'], bench: 1, ir: 1 });
    // rosters: every player matched to NBA.com's (Yahoo's NY is NYK), in his lineup spot
    const alpha = L.rosters['466.l.777.t.1'];
    assert.equal(alpha.length, 5);
    assert.ok(alpha.every(x => x.nba), 'all matched');
    const byName = n => alpha.find(x => x.name === n);
    assert.equal(byName('OG Anunoby').nba, app.NBA.players.find(r => r.name === 'OG Anunoby').id);
    assert.deepEqual([byName('LaMelo Ball').st, byName('Bam Adebayo').slot, byName('Steven Adams').st, byName('Ace Bailey').st], ['ACTIVE', 'Util', 'RESERVE', 'INJURED_RESERVE']);
    assert.deepEqual(JSON.parse(JSON.stringify(L.standings.map(r => [r.name, r.w, r.l]))), [['Alpha Dogs', 3, 0], ['Beta Ballers', 2, 1], ['Gamma Rays', 1, 2], ['Delta Force', 0, 3]]);
    assert.equal(L.draft.picks.length, 12);
    assert.deepEqual([...L.draft.picks[0]].slice(0, 3), [1, 1, '466.l.777.t.1']);
    assert.ok(L.draft.picks.every(p => p[3]), 'every pick matched');
    // a team's side works like any league's: its starters in their slots
    app.state.fxTeam = '466.l.777.t.1';
    const side = app.fxTeamSide('466.l.777.t.1');
    assert.equal(side.lineup.filter(Boolean).length, 3);
    assert.equal(side.il.length, 1);
    assert.equal(app.fxOpponentFor('2026-10-26', '466.l.777.t.1').name, 'Gamma Rays');
    assert.ok(app.viewWeek().includes('Gamma Rays'), 'Matchups draws');
  } finally { app.get('yahoo').proxy = ''; app.state.fxTeam = null; await app.useLeague(CATS9); }
});
