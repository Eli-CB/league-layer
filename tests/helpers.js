// What the test files share: the leagues the fixtures hold, the app every test of a file starts from, and helpers
// more than one area's tests use. A helper only one file uses stays in that file.
// Run them all with: node --test "tests/*.test.js" (each file in its own process, side by side); one area: node --test tests/espn.test.js
// Fixtures (tests/fixtures) are saved Fantrax, ESPN and NBA responses; refresh them with tests/capture_fixtures.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixture, releaseTimers } = require('./harness');

test.after(releaseTimers); // a page left polling doesn't hold its file's run open

const CATS9 = 'my19c8mwmoipvhon'; // 9-cat H2H, most categories wins, weekly lineups
const POINTS = 'la2a76bkmt6aqekb'; // H2H points, weekly lineups
const DAILY = 'frapfs43mutrff0g'; // H2H points with double/triple-doubles, daily lineups, not drafted yet
const ESPN = '794342666'; // public ESPN league: H2H points, daily lineups, starts in week 3 (Nov 2)
const ESPN_ROTO = '1299985004'; // public ESPN roto league (team names made up): 8 cats, a 68-game limit a lineup spot, starts Nov 19
const YAHOO = 'nba.l.777'; // a made-up Yahoo league in Yahoo's JSON layout (tests/make_yahoo_fixtures.py): 9-cat H2H, 4 teams

// The app every test of a file shares, loaded once: each file starts with
//   let app; test.before(async () => { app = await sharedApp(); });
let app;
async function sharedApp() { app = loadApp(); await app.ready(); return app; }

// Make a Fantrax team the one being managed, the way the site does after picking a team
function useTeam(teamId) {
  const side = app.fxTeamSide(teamId);
  Object.assign(app.get('state'), { fxTeam: teamId, players: side.players, il: side.il, lineup: side.lineup, teamName: side.name });
  return side;
}
const leagueInfo = id => JSON.parse(readFixture(`fantrax/${id}/getLeagueInfo.json`));
const between = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;

// run fn as if it were noon Eastern on that day
async function onDay(iso, fn) {
  const RealDate = app.Date;
  const at = Date.parse(`${iso}T12:00:00-04:00`);
  app.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return at; } };
  try { return await fn(); } finally { app.Date = RealDate; }
}

const answer = body => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => null } });

// ----- Yahoo -----
function yahooSignedIn(tokens = { access: 'a', refresh: 'r', until: app.NOW + 36e5 }) {
  app.get('yahoo').proxy = 'https://yahoo.test';
  app.localStorage.setItem('league-layer-yahoo', JSON.stringify(tokens));
}

// ----- Sleeper -----
const SLEEPER = '1369432599025442816'; // a public Sleeper league (tests/capture_sleeper_fixtures.py): 12 teams, points, Lock-In

// The fixture league under its own id with Sleeper's own results: records week by week ('WL') and season totals (fpts),
// as Sleeper's standings have them. Week 1's first matchup goes to the team the lineups say lost (as happens in Lock-In)
async function sleeperWithResults(id, weeks, fn) {
  const fs = require('fs'), path = require('path');
  const fx = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sleeper', name), 'utf8'));
  const lg = fx(`league_${SLEEPER}.json`), rosters = fx(`league_${SLEEPER}_rosters.json`);
  const ms = [1, 2, 3].map(n => fx(`league_${SLEEPER}_matchups_${n}.json`));
  // each week: winner by Sleeper's matchup points, but week 1's first pair flipped; real scores 10 over the lineups' for a winner
  const rec = {}, fpts = {}, real = {};
  let flipWin = null;
  for (let n = 1; n <= weeks; n++) {
    const by = {};
    for (const m of ms[n - 1]) (by[m.matchup_id] = by[m.matchup_id] || []).push(m);
    Object.values(by).forEach(([a, b], i) => {
      let [w, l] = a.points >= b.points ? [a, b] : [b, a];
      if (n === 1 && i === 0) { [w, l] = [l, w]; flipWin = String(w.roster_id); }
      rec[w.roster_id] = (rec[w.roster_id] || '') + 'W'; rec[l.roster_id] = (rec[l.roster_id] || '') + 'L';
      real[n] = { ...real[n], [w.roster_id]: Math.max(w.points, l.points) + 10, [l.roster_id]: l.points };
      if (n === 1 && i === 0) real[n][l.roster_id] = Math.min(w.points, l.points) + 0.5; // (the loser's real score: under the winner's)
      for (const r of [w, l]) fpts[r.roster_id] = (fpts[r.roster_id] || 0) + real[n][r.roster_id];
    });
  }
  for (const r of rosters) {
    r.metadata = { record: rec[r.roster_id] || '' };
    const v = fpts[r.roster_id] || 0;
    r.settings = { ...r.settings, fpts: Math.floor(v), fpts_decimal: Math.round((v - Math.floor(v)) * 100) };
  }
  const answers = { [`league/${id}`]: { ...lg, league_id: id }, [`league/${id}/rosters`]: rosters, [`league/${id}/users`]: fx(`league_${SLEEPER}_users.json`) };
  ms.forEach((m, i) => { answers[`league/${id}/matchups/${i + 1}`] = m; });
  const realFetch = app.get('fetch');
  app.set('fetch', (url, init) => {
    const u = new URL(String(url)), k = u.hostname === 'api.sleeper.app' && u.pathname.replace(/^\/v1\//, '');
    return k in answers ? Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(answers[k]) }) : realFetch(url, init);
  });
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]), ui = app.get('ui');
  try {
    await app.loadBoxes();
    await app.useLeague(id);
    app.applyFantraxLeague(await app.getLeague(id, true));
    return await fn(app.fxLeague(), { real, flipWin });
  } finally {
    app.set('fetch', realFetch);
    for (const [r, fx0, pos] of saved) { if (fx0) r.fx = fx0; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
    ui.tab = 'dashboard'; ui.recapWeek = null; app.get('state').fxTeam = null;
  }
}

// ----- Hockey: a Fantrax league's sport decides what the whole site reads -----
const HOCKEY = 'hockeyfixture01'; // a real league, cut down, its team names replaced (tests/capture_nhl_fixtures.py): H2H points, weekly lineups

const quiet = a => { clearTimeout(a.get('live').timer); };

async function hockeyApp() {
  const a = loadApp();
  await a.ready();
  await a.connectLeague(HOCKEY);
  a.adoptTeam(a.fxLeague().teams[0].id);
  a.get('ui').tab = 'standings';
  quiet(a);
  return a;
}

// ----- Football: a real Sleeper league, cut down, its team names replaced (tests/capture_nfl_fixtures.py) -----
const FOOTBALL = '999000000000000001';

async function footballApp() {
  const a = loadApp();
  await a.ready();
  await a.connectLeague(FOOTBALL);
  a.adoptTeam(a.fxLeague().teams[0].id);
  a.get('ui').tab = 'standings';
  await a.loadBoxes();
  quiet(a);
  return a;
}

const ESPN_FOOTBALL = '999000001'; // a real public ESPN football league, its names replaced (tests/capture_espn_football_fixtures.py)

// Each site's loader builds the same league, and every tab reads it without asking which site it came from
function checkLeague(L, label) {
  const at = what => `${label}: ${what}`;
  assert.ok(L && typeof L.id === 'string' && L.id && typeof L.name === 'string' && L.name, at('an id and a name'));
  assert.ok(['fantrax', 'espn', 'sleeper', 'yahoo'].includes(L.source), at(`source ${L.source}`));
  assert.ok(typeof L.scoring === 'string' && L.scoring, at('its scoring type'));
  assert.ok(Array.isArray(L.cats) ? L.cats.length : L.points && Object.keys(L.points).length, at('categories or point values'));
  assert.ok(Number.isFinite(L.lockDays) && L.lockDays >= 1, at('how often lineups lock'));
  // teams, and everything that names one
  assert.ok(L.teams.length >= 2, at('teams'));
  const ids = new Set(L.teams.map(t => t.id));
  assert.equal(ids.size, L.teams.length, at('team ids are unique'));
  for (const t of L.teams) assert.ok(t.id && typeof t.name === 'string' && t.name, at('each team has an id and a name'));
  assert.deepEqual(Object.keys(L.rosters).filter(id => !ids.has(id)), [], at('rosters are for its teams'));
  for (const r of L.standings) {
    assert.ok(ids.has(r.id), at(`standings team ${r.id}`));
    for (const k of ['rank', 'w', 'l', 't']) assert.ok(Number.isFinite(r[k]), at(`standings ${k}`));
  }
  // weeks: in order, each with its dates and a full lock time
  assert.ok(L.periods.length, at('weeks'));
  L.periods.forEach((p, i) => {
    assert.ok(Number.isInteger(p.n) && (!i || p.n > L.periods[i - 1].n), at('weeks are numbered in order'));
    assert.match(p.start, /^\d{4}-\d\d-\d\d$/, at('a week starts on a date'));
    assert.ok(p.end >= p.start, at('a week ends after it starts'));
    assert.ok(p.lock && p.endAt && p.endAt > p.lock, at('a week has a lock and an end time'));
  });
  const weeks = new Set(L.periods.map(p => String(p.n)));
  for (const [n, games] of Object.entries(L.matchups)) {
    assert.ok(weeks.has(n), at(`matchups for week ${n} are of a week it has`));
    for (const m of games) for (const id of m) assert.ok(ids.has(id), at(`week ${n} names team ${id}`));
  }
  // players on rosters
  const players = Object.values(L.rosters).flat();
  assert.ok(players.length || label === 'Fantrax daily', at('players')); // (that league hasn't drafted)
  for (const p of players) {
    assert.ok(p.fid != null && p.fid !== '' && typeof p.name === 'string', at('a rostered player has an id and a name'));
    assert.ok(typeof p.st === 'string' && p.st, at(`${p.name}'s status`));
  }
  // what a lineup can hold
  const R = L.rosterInfo;
  assert.ok(Object.keys(R.positionConstraints).length, at('lineup slots'));
  assert.ok(R.maxTotalActivePlayers >= 1 && R.maxTotalPlayers >= R.maxTotalActivePlayers, at('roster limits'));
  assert.ok(L.draft === null || Array.isArray(L.draft.picks), at('picks, or no draft yet'));
}

module.exports = { test, assert, loadApp, readFixture, sharedApp, CATS9, POINTS, DAILY, ESPN, ESPN_ROTO, YAHOO, useTeam, leagueInfo, between, onDay, answer, yahooSignedIn, SLEEPER, sleeperWithResults, HOCKEY, quiet, hockeyApp, FOOTBALL, footballApp, ESPN_FOOTBALL, checkLeague };
