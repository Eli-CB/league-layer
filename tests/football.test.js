const { test, assert, sharedApp, loadApp, readFixture, CATS9, ESPN, between, quiet, FOOTBALL, footballApp, ESPN_FOOTBALL, checkLeague } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("a Sleeper league says its sport: football's rules, weeks and players come from it", async () => {
  const a = loadApp();
  await a.ready();
  const { league } = await a.fetchSleeperLeague(FOOTBALL);
  assert.equal(league.sport, 'nfl');
  assert.equal(a.get('SPORT').key, 'nba', 'reading it changes nothing');
  const b = await footballApp(), L = b.fxLeague(), st = b.get('state');
  assert.equal(b.get('SPORT').key, 'nfl');
  assert.equal(st.slots.join(), 'QB,RB,RB,WR,WR,TE,FLX,K,DEF');
  assert.equal(st.benchSize, 5);
  assert.equal(b.tabList().map(t => t[0]).join(), 'dashboard,week,recap,players,standings,awards');
  assert.equal(Object.values(L.rosters).flat().filter(x => !x.nba).length, 0, 'every rostered player matched');
  assert.equal(L.points.pass_td, 4);
  assert.equal(L.points.rec, 0.5);
  // weeks run Tuesday to Monday night: the clock's Monday evening is still that week
  assert.equal(b.dayOffset('2026-10-27'), 0);
  assert.equal(b.weekStart(), '2026-10-20');
  assert.equal(b.fxPeriodFor(b.weekStart()).n, 7);
  assert.equal(b.matchDates().join(), L.periods.find(p => p.n === 7) && (() => { const out = []; for (let d = '2026-10-20'; d <= '2026-10-26'; d = b.addDays(d, 1)) out.push(d); return out.join(); })());
  // a field goal is a stat here, not a basketball shot
  assert.equal(b.statVal({ fgm: 2 }, 'fgm'), 2);
  // ids as the site needs them, a defense's too
  assert.ok(b.get('NBA').players.every(p => Number.isInteger(p.id)));
  const d = b.get('NBA').players.find(p => p.pos[0] === 'DEF');
  assert.ok(d.id >= 900000 && d.slp === d.team);
  assert.ok(!d.name.includes(' '), `a defense goes by its team: ${d.name}`);
});

test("football's weekly scores come out as Sleeper's, in every finished week", async () => {
  const a = await footballApp();
  const L = a.fxLeague();
  const [weeks, G] = await Promise.all([a.loadRosterWeeks(L), a.loadGameLog('cur')]);
  quiet(a);
  const LL = { ...L, weeks, fidNba: a.currentFidNba() };
  let n = 0;
  for (const w of [1, 2, 3, 4, 5, 6]) {
    const real = JSON.parse(readFixture(`sleeper/league_${FOOTBALL}_matchups_${w}.json`));
    const R = a.benchSwaps(LL, G, weeks, L.periods.find(p => p.n === w), L.matchups[w].flat());
    for (const x of R) {
      const m = real.find(y => String(y.roster_id) === x.tid);
      assert.ok(Math.abs(a.lineFp(x.tot) - m.points) < 0.011, `week ${w}, ${x.tid}: ${a.lineFp(x.tot)} against ${m.points}`);
      n++;
    }
  }
  assert.ok(n >= 50, `${n} team-weeks`);
});

test('football on the page: lines in words, finished weeks, this week, byes and live points', async () => {
  const a = await footballApp();
  const L = a.fxLeague(), ui = a.get('ui'), st = a.get('state');
  // how a line reads
  assert.equal(a.fullLine({ pass_yd: 245, pass_td: 2, gp1: 1 }, false).join(', '), '245 pass yd, 2 pass TD');
  assert.equal(a.fullLine({ gp1: 1 }, false).join(), 'played, no stats');
  // every page here
  for (const [tab, make] of Object.entries({ dashboard: () => a.viewDashboard(), week: () => a.withViewedTeam(a.viewWeek, true), recap: () => a.viewRecap(), standings: () => a.viewStandings(), awards: () => a.viewAwards(), players: () => a.viewPlayers() })) {
    ui.tab = tab;
    make();
    await new Promise(r => setTimeout(r, 40));
    const html = make();
    quiet(a);
    assert.ok(!/undefined|NaN|\[object/.test(html.replace(/<[^>]*>/g, ' ')), `${tab} has only real numbers`);
  }
  ui.tab = 'standings';
  quiet(a);
  // the recap's football item: the best team defense started (when the Player of the week isn't one)
  const X = [...a.get('recaps').values()].find(Boolean);
  assert.ok(X, 'a football recap');
  assert.ok(!X.defense || (X.defense.p.pos[0] === 'DEF' && X.defense !== X.mvp));
  assert.ok(!X.goalie && !X.hats.length, 'no hockey items');
  // the player card
  const qb =a.get('NBA').players.find(p => p.pos[0] === 'QB' && p.cur), def = a.get('NBA').players.find(p => p.pos[0] === 'DEF');
  assert.equal(a.cardStats(qb)[0][0], 'Pass yd');
  assert.equal(a.cardStats(def)[0][0], 'Sacks');
  assert.deepEqual([...a.gameStats(qb, { pass_yd: 300 })[0]], ['300 pass yd']);
  // ESPN's scoreboard, with football's team codes and a player's points from Sleeper before the box scores have them
  assert.equal(a.espnTri({ id: '13', abbreviation: 'WSH' }), 'WAS');
  assert.equal(a.espnTri({ id: '13', abbreviation: 'LV' }), 'LV', "not basketball's team of that id");
  const p = st.players[0], raw = a.nbaById.get(p.nbaId), day = a.matchDates().find(d => a.playsOn(raw, d));
  if (day) {
    const box = a.get('BOX');
    box.day.delete(raw.id);
    L.slpWeek = { n: 7, pts: { [raw.slp]: 17.3 }, at: Date.now() };
    a.get('live').games = [{ d: day, home: raw.team, away: 'XXX', state: 'in', start: new Date() }];
    a.footballLines(L);
    assert.equal(a.lineFp(a.lineOn(p, day)), 17.3);
    // and it's in the week's big score and his row, as Sleeper's points change during the game
    ui.tab = 'dashboard'; ui.dashRange = 'week';
    const before = a.viewDashboard();
    quiet(a);
    assert.match(before, /17\.3/);
    L.slpWeek = { n: 7, pts: { [raw.slp]: 24.1 }, at: Date.now() };
    const after = a.viewDashboard();
    quiet(a);
    assert.match(after, /24\.1/);
    ui.tab = 'standings';
    a.get('live').games = [];
  }
  // a player on bye says so
  const bye = st.players.find(x => !a.matchDates().some(d => a.playsOn(x, d)));
  if (bye) { ui.tab = 'dashboard'; ui.dashRange = 'week'; assert.match(a.viewDashboard(), />Bye</); quiet(a); ui.tab = 'standings'; }
});

// The week ahead, with no game of it played yet: the fixture's next week
async function footballNextWeek() {
  const a = await footballApp(), ui = a.get('ui');
  ui.weekShift = 1;
  const dates = a.matchDates();
  return { a, ui, dates, st: a.get('state'), L: a.fxLeague(), NBA: a.get('NBA') };
}

test("football's projections: Sleeper's stats in the league's scoring, a week at a time", async () => {
  const { a, dates, st, L, NBA } = await footballNextWeek();
  const week = a.footballWeek(dates[0]);
  assert.equal(week, 8);
  assert.ok(NBA.projWeeks.includes(week));
  const raw = NBA.players.find(r => r.pos[0] === 'WR' && r.proj && r.proj[week] && r.proj[week].length > 5), p = a.playerFromRaw(raw);
  // stats × the league's scoring: a half point a catch, a tenth a yard, six a touchdown...
  const row = Object.fromEntries(NBA.projKeys.map((k, i) => [k, raw.proj[week][i] || 0]));
  const by = (row.rec || 0) * 0.5 + (row.rec_yd || 0) * 0.1 + (row.rush_yd || 0) * 0.1 + (row.rec_td || 0) * 6 + (row.rush_td || 0) * 6 + (row.fum_lost || 0) * -2 + (row.rec_2pt || 0) * 2 + (row.rush_2pt || 0) * 2;
  assert.ok(Math.abs(a.footballPts(p, dates) - by) < 0.01, `${a.footballPts(p, dates)} vs ${by}`);
  // a bye is nothing, and Out is nothing
  assert.equal(a.footballPts({ ...p, team: 'XXX' }, dates), 0);
  assert.equal(a.footballPts({ ...p, status: 'Out' }, dates), 0);
  // a team's week adds its starters' projections, and the win chance comes from the positions' spreads
  const ctx = a.weekContext();
  const fp = a.fpTotals(ctx.asSet), starters = st.players.filter(x => ctx.setIds.has(x.id) && a.gamesIn(x, dates) && x.status !== 'Out');
  assert.ok(Math.abs(fp.a - a.get('sum')(starters.map(x => a.footballPts(x, dates)))) < 0.01);
  assert.ok(fp.vr > 5 ** 2 * starters.length && fp.vr < 7 ** 2 * starters.length, `${fp.vr}`);
  assert.ok(ctx.hasOpp, 'the real opponent');
  assert.ok(ctx.oSet.win > 0.02 && ctx.oSet.win < 0.98, `${ctx.oSet.win}`);
  assert.equal(ctx.oSet.points, true);
  // a week the file doesn't have: season averages, and it says so
  const later = a.matchDates(a.weekStartAt(6)), s = a.nbaStats(raw, 'cur');
  assert.ok(!NBA.projWeeks.includes(a.footballWeek(later[0])));
  assert.ok(Math.abs(a.lineFp(a.footballProj(p, later).m) - a.fantasyPoints(s)) < 0.01);
  a.get('ui').tab = 'week'; a.get('ui').weekShift = 6;
  assert.match(a.withViewedTeam(a.viewWeek, true), /No projections for this week yet: season averages/);
  quiet(a);
});

test('football without projections in the file still works, on season averages', async () => {
  const a = await footballApp(), NBA = a.get('NBA');
  NBA.projKeys = []; NBA.projWeeks = [];
  a.get('projMemo').clear();
  for (const r of NBA.players) delete r.proj;
  const ui = a.get('ui');
  ui.tab = 'week'; ui.weekShift = 1;
  const html = a.withViewedTeam(a.viewWeek, true);
  quiet(a);
  assert.match(html, /season averages/);
  assert.ok(!/undefined|NaN|\[object/.test(html.replace(/<[^>]*>/g, ' ')));
  ui.tab = 'players'; ui.perfRange = 'proj';
  assert.ok(a.viewPlayers());
  quiet(a);
});

test('football lineups: the best projected fit, byes and Out left out, and a started game locks', async () => {
  const { a, dates, st } = await footballNextWeek();
  const ids = a.bestWeeklyIds(st.players, dates, null);
  assert.ok(ids.size >= st.slots.length - 1, `${ids.size} of ${st.slots.length}: a spot only stays empty with nobody to fill it`);
  assert.ok(![...ids].map(a.byId).some(p => !a.gamesIn(p, dates) || p.status === 'Out'), 'nobody on a bye or Out starts');
  // nobody left on the bench outscores a starter he could replace: every spot filled, best first
  const qb = st.players.filter(p => p.pos[0] === 'QB').sort((x, y) => a.footballPts(y, dates) - a.footballPts(x, dates)).filter(p => a.gamesIn(p, dates) && p.status !== 'Out');
  assert.ok(ids.has(qb[0].id));
  // a benched star's game starting: he can't come in, and a starter whose game started stays
  const game = p => ({ id: p.team, d: dates.find(x => a.playsOn(p, x)), home: p.team, away: 'XXX', state: 'in', start: new Date(), period: 2, clock: 450 });
  const live = a.get('live');
  const bench = st.players.find(p => !st.lineup.includes(p.id) && ids.has(p.id));
  if (bench) {
    live.games = [game(bench)];
    assert.equal(a.footballNow(bench, dates).state, 'in');
    assert.ok(!a.bestWeeklyIds(st.players, dates, null).has(bench.id));
  }
  const on = a.byId(st.lineup.find(id => { const p = a.byId(id); return p && a.gamesIn(p, dates); }));
  live.games = [game(on)];
  assert.ok(a.bestWeeklyIds(st.players, dates, null).has(on.id));
  live.games = [];
});

test('football in a game: real points, the rest of the projection, and final', async () => {
  const { a, dates, st } = await footballNextWeek();
  const p = st.players.find(x => st.lineup.includes(x.id) && a.gamesIn(x, dates) && a.footballPts(x, dates) > 3), d = dates.find(x => a.playsOn(p, x));
  const proj = a.footballPts(p, dates), live = a.get('live');
  assert.equal(a.footballEntry(p, dates).fp, proj, 'before kickoff: the projection');
  live.lines.set(d, new Map([[p.nbaId, { gp1: 1, min: 0, bonus: 9 }]]));
  live.games = [{ id: '1', d, home: p.team, away: 'XXX', state: 'in', start: new Date(), period: 3, clock: 450 }];
  const half = a.footballEntry(p, dates); // halfway through the third: 3/8 of the game to go
  assert.ok(Math.abs(half.share - 0.375) < 0.001, `${half.share}`);
  assert.ok(Math.abs(half.fp - (9 + 0.375 * proj)) < 0.01);
  const ctx0 = a.projectSide(st.players, dates, new Set([p.id]));
  assert.ok(Math.abs(a.fpTotals(ctx0).a - (9 + 0.375 * proj)) < 0.01, 'live points are in the team score');
  assert.ok(Math.abs(ctx0.vr.fpsd - 0.375 * a.footballProj(p, dates).sd.fpsd ** 2) < 0.01, 'and only the time left is uncertain');
  live.games[0].state = 'post';
  assert.equal(a.footballEntry(p, dates).fp, 9);
  live.games = []; live.lines.clear();
});

test('football tabs: the board, swaps, Roster, Players and adds speak in projected points', async () => {
  const { a, ui, dates, st } = await footballNextWeek();
  ui.tab = 'week';
  const week = a.withViewedTeam(a.viewWeek, true);
  quiet(a);
  assert.match(week, /class="sb-gauge"[^>]*aria-label="\d+% to win the week/, 'the win chance: a gauge between the scores');
  assert.match(week, /class="sb-main">[\s\S]*?class="sb-gauge"[\s\S]*?<div class="sb-week"><div class="wk-nav">[\s\S]*?<span>Next period<\/span>[\s\S]*?<div class="wk-dates">Week \d+ · [A-Z][a-z]{2} \d+ – /, 'the week under it, across the scoreboard');
  assert.ok(!week.includes('page-head'), 'no title row above');
  assert.match(week, /<b>[\d.]+<\/b> projected/);
  assert.ok(!/starter games|schedule dots|Per game<\/button>/i.test(week));
  // a starter out for the week: the swap says what it's worth
  const out = st.players.find(p => st.lineup.includes(p.id) && a.gamesIn(p, dates));
  const swapIn = st.players.find(p => !st.lineup.includes(p.id) && p.pos[0] === out.pos[0] && a.gamesIn(p, dates) && p.status !== 'Out');
  if (swapIn) {
    const was = out.status;
    out.status = 'Out';
    const html = a.withViewedTeam(a.viewWeek, true);
    quiet(a);
    out.status = was;
    assert.match(html, /projects [\d.]+ to /);
    assert.match(html, / proj</);
  }
  // Standings: no category strengths in football
  ui.tab = 'standings'; ui.weekShift = 0;
  assert.ok(!/Category strengths/.test(a.viewStandings()));
  // Players: the week's projections, ranked; no minutes
  ui.tab = 'players'; ui.perfRange = 'proj';
  const p = a.viewPlayers();
  quiet(a);
  assert.match(p, /<option value="proj" selected>Projected</);
  assert.ok(!/\bmin\b/.test(p.replace(/<[^>]*>/g, ' ')), 'no minutes in football');
  // Players is the table alone: pickup ideas are Matchups' (each for the weakest at his own position)
  assert.ok(!/Recommended adds/.test(p));
  ui.weekShift = 1; // next week: this one's games are all played
  const ideas = a.pickupIdeas(a.weekContext());
  ui.weekShift = 0;
  assert.ok(ideas.length);
  for (const x of ideas) assert.equal(x.p.pos[0], x.drop.pos[0]);
  assert.ok(a.get('INFO').win[1].includes('per-game'), "basketball's text is still basketball's");
  assert.match(a.get('SPORT').infoOver.win[1], /Projected score/);
});

test('a live redraw keeps the pickup ideas it has: each one sets a whole lineup', async () => {
  const { a } = await footballNextWeek(), live = a.get('live');
  const fresh = a.pickupsCard(), memo = a.get('pickMemo');
  assert.ok(memo.ideas.length, 'the fixture has some');
  a.set('pickMemo', { ...memo, ideas: memo.ideas.slice(0, 1) });
  live.hold = true;
  const held = a.pickupsCard();
  live.hold = false;
  assert.ok(held.length < fresh.length, 'the list it had, not a new one');
  assert.equal(a.pickupsCard(), fresh, 'anything else works them out again');
});

test('an ESPN football league: not one ESPN knows as basketball, so read as football', async () => {
  const a = loadApp();
  await a.ready();
  await a.connectLeague(ESPN_FOOTBALL);
  const L = a.fxLeague(), st = a.get('state');
  assert.equal(a.get('SPORT').key, 'nfl');
  assert.equal(L.source, 'espn');
  checkLeague(L, 'ESPN football');
  assert.equal(Object.values(L.rosters).flat().filter(x => !x.nba).length, 0, 'every rostered player matched, D/STs too');
  assert.deepEqual([...st.slots].sort(), ['DEF', 'FLX', 'K', 'QB', 'RB', 'RB', 'TE', 'WR', 'WR'].sort());
  assert.equal(st.benchSize, 7);
  // the league's own weeks: NFL weeks, from week 9 when it began
  assert.equal(L.periods[0].n, 9);
  assert.equal(L.periods[0].start, '2026-11-03');
  assert.equal(L.periods[0].end, '2026-11-09');
  // its scoring, in the data's stat names: PPR, and ESPN's D/ST brackets
  for (const [k, v] of Object.entries({ rec: 1, rec_yd: 0.1, pass_yd: 0.04, pass_td: 4, pass_int: -2, fum_lost: -2, xpm: 1, fgm_40_49: 4, fgm_50_59: 5,
    pts_allow_0: 5, pts_allow_14_17: 1, pts_allow_28_34: -1, pts_allow_46p: -5, yds_allow_100_199: 3, yds_allow_550p: -7, int: 2, sack: 1, def_fum_rec: 2, def_st_td: 6 })) {
    assert.equal(L.points[k], v, k);
  }
  assert.ok(!('fum_rec' in L.points) && !('pts_allow_18_21' in L.points), "an offense's fumble recovery scores nothing; 18-21 allowed is 0");
  assert.equal(L.pointsOther.join(), 'ESPN stat 209', 'a stat the data lacks is named, as not projected (a rare defense one here)');
  // ESPN's own points for two of its player-weeks (2026 week 8 and week 3): a receiver, and a D/ST with a punt return TD
  assert.ok(Math.abs(a.lineFp({ rec: 6, rec_yd: 118, rec_td: 1 }) - 23.8) < 1e-9);
  assert.ok(Math.abs(a.lineFp({ pts_allow: 16, pts_allow_14_17: 1, pts_allow_14_20: 1, sack: 6, int: 2, def_st_td: 1, yds_allow_200_299: 1 }) - 19) < 1e-9);
  // live points are ESPN's, by each player's ESPN id
  const raw = a.get('NBA').players.find(r => r.fx && r.fx.st === 'T' && r.pos[0] === 'WR');
  assert.equal(a.leagueFid(L, raw), String(raw.espn));
  assert.equal(L.slpWeek.n, 9);
  // every tab draws
  const ui = a.get('ui');
  for (const tab of ['dashboard', 'week', 'players', 'standings', 'recap']) {
    ui.tab = tab;
    const html = tab === 'week' ? a.withViewedTeam(a.viewWeek, true) : { dashboard: a.viewDashboard, players: a.viewPlayers, standings: a.viewStandings, recap: a.viewRecap }[tab]();
    quiet(a);
    assert.ok(html && !/undefined|NaN|\[object/.test(html.replace(/<[^>]*>/g, ' ')), tab);
  }
});

test("football's day: Monday night's game stays in its week past midnight, and abroad", async () => {
  const a = await footballApp();
  a.setClock('2026-10-27T00:30:00-04:00'); // overtime in New York; 5:30 on Tuesday morning in London
  assert.equal(a.todayIso(), '2026-10-26');
  assert.equal(a.weekStart(), '2026-10-20');
  a.setClock('2026-10-27T06:00:00-04:00');
  assert.equal(a.todayIso(), '2026-10-27');
  // the new week is this week from its first game (Thursday night's): lineups are set for it until then
  assert.equal(a.weekStart(), '2026-10-20');
  const kick = a.periodFirstGame(a.fxPeriodFor('2026-10-27'));
  assert.equal(new Date(kick).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }), 'Thu', 'Thursday night, not the midnight Sleeper gives as its lock');
  a.setClock(new Date(kick).toISOString());
  assert.equal(a.weekStart(), '2026-10-27');
  a.setClock();
  // the other sports go by the device's clock
  app.setClock('2026-10-27T00:30:00-04:00');
  assert.equal(app.todayIso(), '2026-10-27');
  app.setClock();
});

test("Sleeper's live points failing says so, like ESPN's scores", async () => {
  const a = await footballApp(), L = a.fxLeague(), real = a.fetch, sent = [], net = { up: false };
  a.location.hostname = 'leaguelayer.com';
  a.fetch = (u, o) => {
    const s = String(u);
    if (s.includes('/errors')) { sent.push(JSON.parse(o.body)); return Promise.resolve({}); }
    if (s === 'index.html') return Promise.resolve({ ok: true });
    if (s.includes('/matchups/') && !net.up) return Promise.resolve({ ok: false, status: 404 });
    return real(u, o);
  };
  const ask = async () => { L.slpWeek = null; a.sleeperWeekFresh(L); await a.get('slpWeekLoad'); await new Promise(r => setTimeout(r, 5)); };
  a.get('feedFails')['Sleeper live points'] = 0;
  await ask(); await ask();
  assert.equal(sent.length, 0, 'a blip says nothing');
  await ask();
  assert.equal(sent.length, 1);
  assert.match(sent[0].msg, /^Sleeper live points failing \(NFL\): /);
  net.up = true;
  await ask();
  assert.equal(a.get('feedFails')['Sleeper live points'], 0, 'recovering starts the count again');
});

test('football and the other sports leave each other alone', async () => {
  const a = await footballApp();
  await a.switchLeague(CATS9);
  quiet(a);
  assert.equal(a.get('SPORT').key, 'nba');
  assert.equal(a.get('POSITIONS')[0], 'PG');
  assert.equal(a.dayOffset('2026-10-26'), 0, 'basketball weeks start on Monday');
  assert.equal(a.statVal({ fgPct: 0.5, fga: 10 }, 'fgm'), 5);
  assert.equal(a.tabList().length, 9);
  await assert.rejects(a.connectLeague('999000000000000099'), /didn't find that league/);
  assert.equal(a.get('SPORT').key, 'nba');
  await a.switchLeague(FOOTBALL);
  quiet(a);
  assert.equal(a.get('SPORT').key, 'nfl');
  assert.equal(a.get('state').slots.length, 9);
});
