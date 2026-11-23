const { test, assert, sharedApp, readFixture, ESPN, useTeam, onDay, SLEEPER, sleeperWithResults } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("Sleeper: Moves this period is Sleeper's own list of transactions", async () => {
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]), ui = app.get('ui');
  try {
    app.applyFantraxLeague(await app.getLeague(SLEEPER, true)); // the players under their Sleeper ids, as on the page
    await sleeperMovesChecks(app.fxLeague(), ui);
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
    ui.tab = 'dashboard';
  }
});

async function sleeperMovesChecks(L, ui) {
  const P = app.NBA.players.filter(r => r.slp).slice(0, 6);
  const [a, b, c, d, e, f] = P.map(r => r.slp);
  const [t1, t2, t3] = L.teams.map(t => t.id);
  const at = 1793500000000;
  const txs = [
    { type: 'free_agent', status: 'complete', status_updated: at, adds: { [a]: +t1 }, drops: { [b]: +t1 } },
    { type: 'free_agent', status: 'complete', status_updated: at + 1, adds: null, drops: { [a]: +t1 } }, // added and dropped again: both show
    { type: 'waiver', status: 'complete', status_updated: at + 2, settings: { waiver_bid: 7 }, adds: { [c]: +t2 }, drops: null },
    { type: 'waiver', status: 'failed', status_updated: at + 2, settings: { waiver_bid: 3 }, adds: { [c]: +t3 }, drops: null },
    { type: 'trade', status: 'complete', status_updated: at + 3, adds: { [d]: +t1, [e]: +t2 }, drops: { [d]: +t2, [e]: +t1, [f]: +t2 },
      draft_picks: [{ season: '2027', round: 1, roster_id: +t3, previous_owner_id: +t2, owner_id: +t1 }], waiver_budget: [{ sender: +t1, receiver: +t2, amount: 5 }] },
    { type: 'commissioner', status: 'complete', status_updated: at - 9e9, adds: { [f]: +t3 }, drops: null }, // the offseason, before `since`
  ];
  const M = app.sleeperMoves(L, txs, at - 1e9);
  const list = tid => JSON.parse(JSON.stringify((M[tid] || []).map(m => [m.kind, m.nba || (m.pick ? `${m.pick.year}-${m.pick.round}-${m.pick.from}` : `$${m.budget}`), m.from || m.to || m.bid || null])));
  assert.deepEqual(list(t1), [['add', P[0].id, null], ['drop', P[1].id, null], ['drop', P[0].id, null], ['trade', P[3].id, t2], ['away', P[4].id, t2], ['trade', `2027-1-${t3}`, t2], ['away', '$5', t2]],
    'in the order they went through: a player added and dropped again shows both; a trade: each side what it got, a pick, budget');
  assert.deepEqual(list(t2), [['add', P[2].id, 7], ['away', P[3].id, t1], ['trade', P[4].id, t1], ['away', `2027-1-${t3}`, t1], ['trade', '$5', t1], ['drop', P[5].id, null]],
    "a waiver claim keeps its bid; a player dropped to make room in a trade is a drop");
  assert.equal(M[t3], undefined, "a failed claim isn't a move, and the offseason's are left out");

  // drawn on Standings: these, then the fixture's real week 2 (sleeperWeekNow) from Sleeper
  const load = app.get('movesLoad');
  useTeam(t1);
  ui.tab = 'standings';
  load.set(L, { n: 2, at: Date.now(), moves: M });
  const html = app.viewStandings();
  assert.match(html, /<h2>Moves this period <button[^>]*data-key="movesSlp"/);
  assert.match(html, /2027 Round 1 pick <span class="muted small">originally /, 'a pick from a third team says whose it was');
  assert.match(html, /\$5 of waiver budget/);
  assert.match(html, /title="Waiver bid">\$7</);
  assert.match(html, /you \+1 ⇄2 −2 · 9 moves/, "yours, and every move once (a trade's pieces on the side that got them)");
  assert.doesNotMatch(html, /rosters as of/, "Sleeper's own list, not the rosters");
  load.delete(L);
  app.viewStandings(); // asks Sleeper for this week's
  await new Promise(r => setTimeout(r, 30));
  const real = JSON.parse(readFixture(`sleeper/league_${SLEEPER}_transactions_2.json`));
  const n = real.filter(t => t.status === 'complete').reduce((s, t) => s + Object.keys(t.adds || {}).length + Object.keys(t.drops || {}).length, 0);
  assert.match(app.viewStandings(), new RegExp(`${n} moves</span>`), `the fixture's ${real.length} transactions: ${n} adds and drops`);
}

test('Sleeper players with no NBA.com match are named from the daily file (slpNames): on rosters and in moves', async () => {
  const D = app.NBA, was = D.slpNames;
  // (2009: on a fixture roster, in no fixture player's slp, named by the draft's picks)
  D.slpNames = { 2009: 'Another Name', 99999999: 'Dropped Unmatched' };
  try {
    const { league: L, idMap } = await app.fetchSleeperLeague(SLEEPER);
    assert.equal(idMap.names[99999999], 'Dropped Unmatched', 'the names a league reads (its rosters) include the daily file’s');
    const item = Object.values(L.rosters).flat().find(x => x.fid === '2009');
    assert.equal(item.nba, null);
    assert.equal(item.name, 'Kevin Porter', "Sleeper's own draft record names him first");
    const tid = L.teams[0].id;
    const M = app.sleeperMoves(L, [{ type: 'free_agent', status: 'complete', status_updated: 1, adds: null, drops: { 99999999: +tid } }]);
    assert.equal(M[tid][0].name, 'Dropped Unmatched', 'one dropped, on no roster now, too');
  } finally {
    if (was === undefined) delete D.slpNames; else D.slpNames = was;
  }
});

test('Sleeper league IDs and addresses', () => {
  assert.equal(app.parseLeagueId(SLEEPER), SLEEPER);
  assert.equal(app.parseLeagueId(`https://sleeper.com/leagues/${SLEEPER}/matchup`), SLEEPER);
  assert.equal(app.parseLeagueId(`sleeper.app/leagues/${SLEEPER}`), SLEEPER);
  assert.equal(app.leagueSourceOf(SLEEPER), 'sleeper');
  assert.equal(app.leagueSourceOf('794342666'), 'espn', 'short all-digit IDs stay ESPN');
});

test('reads a Sleeper league into the same shape as the others', async () => {
  const L = await app.useLeague(SLEEPER);
  assert.equal(L.source, 'sleeper');
  assert.equal(app.sourceName(L), 'Sleeper');
  assert.equal(L.name, 'Smart League');
  assert.ok(app.isPoints() && L.oneGame && app.isOneGame());
  assert.deepEqual({ ...L.points }, { ast: 1, blk: 2, dd: 1, pts: 0.5, reb: 1, stl: 2, td: 2, to: -1, tpm: 0.5 });
  assert.deepEqual([...L.pointsOther], ['40+ point games', '50+ point games', 'flagrant fouls', 'technical fouls'], 'bonuses listed, not projected');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX', 'FLX'], bench: 5, ir: 1 });
  assert.equal(L.teams.length, 12);
  const all = Object.values(L.rosters).flat();
  assert.equal(all.filter(x => x.st === 'ACTIVE').length, 12 * 9);
  assert.ok(all.filter(x => x.nba).length >= all.length - 3, 'rostered players matched by their Sleeper ids');
  assert.ok(all.every(x => x.name && !/^Player /.test(x.name)), 'everyone named');
  assert.equal(L.draft.picks.length, 168);
  assert.equal(L.draft.perRound, 12);
  assert.deepEqual([...L.draft.picks[0].slice(0, 3)], [1, 1, '7']);
  assert.equal(L.standings.length, 12);
  assert.ok(L.standings.every((s, i) => !i || s.w <= L.standings[i - 1].w), 'ranked by wins');
  assert.ok(app.hasLineupHistory(L), 'weekly lineups for awards and recaps');
  // weeks: Monday to Sunday from opening night, no All-Star exception; 3 playoff weeks for 6 teams from week 22
  const span = n => { const p = L.periods.find(x => x.n === n); return p && `${p.start}..${p.end}`; };
  assert.equal(span(1), '2026-10-20..2026-10-25');
  assert.equal(span(2), '2026-10-26..2026-11-01');
  assert.equal(span(18), '2027-02-15..2027-02-21');
  assert.equal(span(24), '2027-03-29..2027-04-04');
  assert.equal(L.periods.length, 24);
  assert.equal(L.playoffPeriod, 22);
  assert.deepEqual(Object.keys(L.matchups).map(Number), [1, 2, 3], 'the week before, this week and the next');
  assert.ok(app.fxOpponentFor('2026-10-26', L.teams[0].id), 'an opponent this week');

  // Sleeper's own positions: its lineups follow them (Luka is a PG there, a guard-forward on NBA.com)
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    app.applyFantraxLeague(await app.getLeague(SLEEPER, true));
    const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
    assert.deepEqual([...luka.pos], ['PG']);
    assert.equal(luka.fx.id, luka.slp);
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
});

test('Sleeper counts one game a week for each starter', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(SLEEPER);
  const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
  const p = app.playerFromRaw(luka);
  const week1 = app.matchDates('2026-10-20');
  const lines = week1.map(d => app.actualLine(p, d)).filter(Boolean);
  assert.equal(lines.length, 3);
  // Sleeper's 53 points for him in week 1 are his 52-point night (Oct 25), not his week
  L.slpWeek = { n: 1, pts: { [luka.slp]: 53 }, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines).pts, 52);
  // with no points from Sleeper: his latest game, as Sleeper counts one that isn't locked in
  L.slpWeek = { n: 1, pts: {}, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines).min, lines[2].min);
  assert.equal(app.oneGameLine(p, lines).bonus, 4, 'with its bonus points');
  // Sleeper's 0 for a player with games: he went into the lineup after them, so none counts
  L.slpWeek = { n: 1, pts: { [luka.slp]: 0 }, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines), null);

  // a finished week projects to one game per starter, well under every game added up
  const A = app.fxTeamSide(L.teams[0].id);
  const one = app.projectSide(A.players, week1, null);
  L.oneGame = false;
  let every;
  try { every = app.projectSide(A.players, week1, null); } finally { L.oneGame = true; }
  assert.ok(one.games <= 9 && one.games > 0, `${one.games} starters' games count`);
  assert.ok(every.games > one.games);
  const fp = S => app.fpTotals(S).a;
  assert.ok(fp(one) < fp(every) * 0.6, `one game each: ${fp(one)} FP, every game: ${fp(every)}`);
});

test("Sleeper on the Dashboard: this period shows the game that counts", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(SLEEPER);
  const tid = L.teams[0].id;
  useTeam(tid);
  const ui = app.get('ui'), was = ui.dashRange;
  L.slpWeek = { n: 1, pts: {}, at: Date.now() }; // fresh: nothing asks Sleeper again
  try {
    ui.dashRange = 'week';
    const m = await onDay('2026-10-25', () => app.dashMatchupCard());
    assert.ok(m.includes(app.fxTeamName(tid)));
    assert.ok(m.includes('this one counts'), 'a starter with more than one game shows which counts');
    assert.ok(!m.includes('Game minutes left'), 'no minutes-left chip: games beyond the first one may not count');
    const score = +[...m.matchAll(/class="mu-score">([^<]*)</g)][0][1];
    assert.ok(score > 0 && score < 500, `period score ${score}`);
  } finally { ui.dashRange = was; app.get('state').fxTeam = null; }
});

// The Sleeper league as the site has it once connected: its players matched by their Sleeper ids (raw.fx)
async function asSleeper(fn) {
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    await app.useLeague(SLEEPER);
    app.applyFantraxLeague(await app.getLeague(SLEEPER, true));
    return await fn(app.fxLeague());
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
}

test("Sleeper's weekly lineups: each week's starters, and the one game of each that counted", () => asSleeper(async L => {
  await app.loadBoxes();
  const weeks = await app.fetchRosterWeeks(L);
  assert.deepEqual([...weeks.map(w => w.n)], [1, 2], 'every week started (the fixtures are in week 2)');
  const w1 = weeks[0];
  const byTeam = {};
  for (const [, o] of w1.owner) if (o.on) byTeam[o.tid] = (byTeam[o.tid] || 0) + 1;
  assert.ok(Object.values(byTeam).every(n => n <= 9) && Object.keys(byTeam).length === 12, 'up to 9 starters a team');
  assert.ok([...w1.owner.values()].every(o => o.pts != null), "everyone's points that week");
  // the pairings of every week come with its lineups (the league brings only this week's and its neighbors')
  const pairs = JSON.stringify(L.matchups[1]);
  delete L.matchups[1];
  await app.fetchRosterWeeks(L);
  assert.equal(JSON.stringify(L.matchups[1]), pairs);
  assert.ok(![...w1.owner.values()].some(o => o.tid === '#m'));
  const G = await app.loadGameLog('cur');
  const fidNba = app.currentFidNba();
  const L2 = { ...L, weeks: [w1], fidNba };
  // Luka's counted game in week 1: his 52-point night, not his first or every game
  const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
  const rows = (G.players.get(luka.id) || []).filter(r => app.periodDays(G, w1).has(r[0]));
  assert.equal(rows.length, 3);
  const c = app.countedRows(L2, G, w1, luka.slp, rows);
  assert.equal(c.length, 1);
  assert.equal(app.gameLine(G, c[0]).pts, 52);
  assert.equal(app.lineFp(app.gameLine(G, c[0])), 53, 'with its 40- and 50-point bonuses');
  assert.equal(app.countedRows({ ...L2, oneGame: false }, G, w1, luka.slp, rows).length, 3, 'other leagues count every game');
  // each team's week, one counted game per starter, comes to Sleeper's own score less the bonuses we don't count
  const tot = app.pastSeasonTotals(L2, G);
  const ms = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/sleeper/league_1369432599025442816_matchups_1.json'), 'utf8'));
  for (const m of ms) {
    const T = tot[String(m.roster_id)];
    const fp = T ? app.lineFp(T.s) : 0;
    // within a technical foul or a stat correction (bonuses included: Luka's 52-point night is worth 53 there)
    assert.ok(Math.abs(fp - m.points) <= 3, `team ${m.roster_id}: ${fp} against Sleeper's ${m.points}`);
    assert.ok(!T || T.gp <= 9, 'one game a starter');
  }
}));

test('Sleeper recap and awards: one counted game per starter', () => asSleeper(async L => {
  const ui = app.get('ui');
  useTeam(L.teams[0].id);
  ui.tab = 'recap';
  try {
    app.viewRecap();
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewRecap();
    assert.match(html, /Period 1 recap/);
    const X = app.get('recaps').get(`${L.id}|1`);
    assert.equal(X.games.length, 6);
    assert.ok(X.mvp && X.mvp.line.gp1 === 1, 'Player of the period: his counted game');
    assert.equal(X.game, null, 'no separate Game of the period');
    assert.equal(X.brick, null, 'no Worst period: a period is one game');
    assert.ok(X.dud && X.dud.line.gp1 === 1);
    assert.ok(!html.includes('Game of the period') && html.includes('Player of the period'));
    assert.ok(X.missed.every(x => x.games === 1 && x.sched === 1), 'Street clothes: a start without any game');
    if (X.missed.length) assert.ok(html.includes('started without playing a game'));
    // a points week's best is the top score, already in the finals; the share text and the image come from the same list
    assert.ok(X.allPlay && !app.recapItems(X).some(x => x.label === 'Best period') && !html.includes('Best period') && !app.recapText(L, X).includes('Best period'));
    // the results crown the week's top score and mark the lowest
    const scores = Object.entries(X.rank.score), hi = Math.max(...scores.map(s => s[1])), lo = Math.min(...scores.map(s => s[1]));
    assert.deepEqual(Array.from(X.rank.top, String), scores.filter(s => s[1] === hi).map(s => s[0]));
    assert.deepEqual(Array.from(X.rank.bottom, String), scores.filter(s => s[1] === lo).map(s => s[0]));
    assert.equal(app.recapMark(X, X.rank.top[0]), 'top');
    assert.equal(app.recapMark(X, X.rank.bottom[0]), 'bottom');
    assert.ok(html.includes(`title="Most points this period: ${app.fmtFp(hi)}"`) && html.includes(`title="Fewest points this period: ${app.fmtFp(lo)}"`));
    // a points week's luck: the best score that lost and the worst that won (each only on the wrong side of the middle),
    // the closest final, and the starter with the biggest share of his team's points
    const decided = X.games.filter(g => g.margin > 0);
    const tight = decided.reduce((a, b) => (b.margin < a.margin ? b : a));
    if (tight.margin >= 0.05 * tight.sc.me) assert.equal(X.close, null, 'no Nail-biter: the closest final is 5% of the winner or more');
    else if (X.close) assert.equal(X.close.margin, tight.margin, 'Nail-biter: the closest final');
    if (X.unlucky) assert.ok(X.unlucky.place <= 6 && X.unlucky.sc.opp === Math.max(...decided.map(g => g.sc.opp)), 'Tough luck: the best losing score');
    if (X.lucky) assert.ok(X.lucky.place > 6 && X.lucky.sc.me === Math.min(...decided.map(g => g.sc.me)), 'Lucky win: the worst winning score');
    assert.ok(X.carry && X.carry.share >= 0.2 && X.carry.pts < X.carry.of, "Carried: a fifth or more of his team's points");
    assert.ok(app.recapItems(X).some(x => x.label === 'Carried'));
    assert.ok(!X.goalie && !X.hats.length && !X.defense, 'no hockey or football items in basketball');
  } finally { ui.tab = 'dashboard'; }
  // Awards so far run on the same weeks
  ui.tab = 'awards';
  try {
    app.viewAwardsSoFar();
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewAwardsSoFar();
    assert.ok(!/No awards for Sleeper/.test(html), 'awards for Sleeper leagues');
    assert.match(html, /Best manager|Waiver Wire Wizard|Old/);
    if (html.includes('Street Clothes')) assert.match(html, /empty start/);
  } finally { ui.tab = 'dashboard'; app.get('state').fxTeam = null; }
}));

// The fixture league made a dynasty league: a taxi squad on team 1, a 3-round rookie draft whose slots were traded
test('a Sleeper dynasty league: its taxi squad never starts, and its rookie draft follows its own order and pool', async () => {
  const fs = require('fs'), path = require('path');
  const fx = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sleeper', name), 'utf8'));
  const DYN = '999000000000000002';
  const lg = fx(`league_${SLEEPER}.json`), rosters = fx(`league_${SLEEPER}_rosters.json`);
  const draft = fx(`draft_${lg.draft_id}.json`), picks = fx(`draft_${lg.draft_id}_picks.json`).filter(p => p.round <= 3);
  const bySlp = new Map(app.NBA.players.filter(r => r.slp).map(r => [r.slp, r]));
  const r1 = rosters[0], taxiSid = r1.players.find(s => !r1.starters.includes(s) && !(r1.reserve || []).includes(s) && bySlp.has(s));
  r1.taxi = [taxiSid];
  const answers = {
    [`league/${DYN}`]: { ...lg, league_id: DYN, settings: { ...lg.settings, type: 2, draft_rounds: 3 } },
    [`league/${DYN}/rosters`]: rosters, [`league/${DYN}/users`]: fx(`league_${SLEEPER}_users.json`),
    [`draft/${lg.draft_id}`]: { ...draft, settings: { ...draft.settings, rounds: 3, player_type: 1 } }, [`draft/${lg.draft_id}/picks`]: picks,
  };
  for (const n of [1, 2, 3]) answers[`league/${DYN}/matchups/${n}`] = fx(`league_${SLEEPER}_matchups_${n}.json`);
  const real = app.get('fetch');
  app.set('fetch', (url, init) => {
    const u = new URL(String(url)), k = u.hostname === 'api.sleeper.app' && u.pathname.replace(/^\/v1\//, '');
    return k in answers ? Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(answers[k]) }) : real(url, init);
  });
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    const L = await app.useLeague(DYN);
    app.applyFantraxLeague(await app.getLeague(DYN, true));
    // the taxi squad: with the IR (out of every lineup and projection), drawn as Taxi
    assert.deepEqual([...L.taxi], [taxiSid]);
    assert.equal(L.rosters[String(r1.roster_id)].find(x => x.fid === taxiSid).st, 'TAXI');
    const side = app.fxTeamSide(String(r1.roster_id)), p = side.players.find(x => x.nbaId === bySlp.get(taxiSid).id);
    assert.ok(side.il.includes(p.id) && !side.lineup.includes(p.id) && app.onTaxi(p));
    assert.equal(side.players.filter(x => side.il.includes(x.id) && !app.onTaxi(x)).length, (r1.reserve || []).filter(s => bySlp.has(s)).length, 'the IR stays the IR');
    assert.match(app.slotBadge('TAXI'), />Taxi</);
    // past weeks: never a bench player to have started (bench regret, Benchwarmer Blues)
    const weeks = await app.fetchRosterWeeks(L);
    const o = weeks[0].owner.get(taxiSid);
    assert.ok(o && !o.on && o.taxi);
    // the rookie draft: everyone else on a roster was kept (off the board for Reach and Fall), and the board's columns are
    // the draft's own slots
    const drafted = new Set(picks.map(x => (bySlp.get(x.player_id) || {}).id));
    assert.ok(L.draft.rostered.length > 100 && L.draft.rostered.every(id => !drafted.has(id)));
    assert.deepEqual([...L.draft.slots], Array.from({ length: 12 }, (x, i) => String(draft.slot_to_roster_id[i + 1])));
    assert.ok(L.draft.picks.every(x => x[6] >= 1 && x[6] <= 12), 'each pick in its slot');
    const d = app.draftData();
    assert.deepEqual([...d.rostered], [...L.draft.rostered]);
    assert.ok(L.draft.rookies && d.rookies, 'a rookies-only draft (player_type 1)');
    // a plain redraft league: no taxi, no pool
    const R = await app.useLeague(SLEEPER);
    assert.ok(!R.taxi && !R.draft.rostered && R.draft.slots);
  } finally {
    app.set('fetch', real);
    for (const [r, fx0, pos] of saved) { if (fx0) r.fx = fx0; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
});

// the recap of a week, once its lineups have loaded
async function recapOf(L, n) {
  const ui = app.get('ui');
  ui.tab = 'recap'; ui.recapWeek = n;
  app.viewRecap();
  await new Promise(r => setTimeout(r, 30));
  return { html: app.viewRecap(), X: app.get('recaps').get(`${L.id}|${n}`) };
}

test("Sleeper basketball: its own winners and, once the site has seen a week end, its real scores", () => sleeperWithResults('999000000000000003', 1, async (L, { real, flipWin }) => {
  // the records, week by week, and the season total, which says week 1's real score (the first week: all of it)
  assert.deepEqual(Object.keys(L.results).map(Number), [1]);
  assert.equal(L.totals.n, 1);
  const pts = app.slpWeekPts(L, 1);
  for (const [tid, v] of Object.entries(real[1])) assert.ok(Math.abs(pts[tid] - v) < 0.01, `team ${tid}: ${pts[tid]} is Sleeper's ${v}`);
  useTeam(L.teams[0].id);
  const { html, X } = await recapOf(L, 1);
  assert.ok(X && !X.est && !html.includes('≈'), 'a week the site saw end: real scores');
  for (const g of X.games) {
    assert.ok(Math.abs(g.sc.me - real[1][g.a]) < 0.01 && Math.abs(g.sc.opp - real[1][g.b]) < 0.01, 'the scores are Sleeper\'s');
    assert.equal(L.results[1][g.a], 'W', 'the winner first');
  }
  // the matchup the lineups get wrong: Sleeper's winner, by Sleeper's score
  assert.ok(X.games.some(g => g.a === flipWin), "the lineups' loser won, as Sleeper says");
  // Best manager counts the weeks with real scores, its record theirs
  app.get('ui').tab = 'awards';
  app.viewAwardsSoFar();
  await new Promise(r => setTimeout(r, 30));
  const aw = app.viewAwardsSoFar();
  assert.match(aw, /aw-title">Best manager/);
  assert.ok(!aw.includes('none yet') && !aw.includes('whose Sleeper scores'), 'every finished week has its real scores: no note');
}));

test("Sleeper basketball: weeks before the site saw one end are estimates, marked, with Sleeper's winners", async () => {
  app.setClock('2026-11-03T12:00:00-05:00'); // week 2 over: the first read, so week 1's own total was never seen
  try {
    await sleeperWithResults('999000000000000004', 2, async (L, { flipWin }) => {
      assert.equal(L.totals.n, 2);
      assert.equal(app.slpWeekPts(L, 1), null);
      assert.equal(app.slpWeekPts(L, 2), null, 'week 2 needs the total after week 1 too');
      useTeam(L.teams[0].id);
      const { html, X } = await recapOf(L, 1);
      assert.ok(X && X.est);
      assert.ok(X.games.every(g => L.results[1][g.a] === 'W' && g.won && g.sc.est && app.scoreLine(g.sc).startsWith('≈')), "Sleeper's winners, scores marked");
      const flipped = X.games.find(g => g.a === flipWin);
      assert.ok(flipped && flipped.sc.me < flipped.sc.opp, 'the winner as Sleeper has it, though the lineups give him less');
      assert.ok(!X.unlucky && !X.lucky && !X.close && !X.carry && !X.regret && !X.rank, 'nothing that hangs on an estimated score');
      assert.ok(html.includes('≈ estimated') && !html.includes('rc-badge'));
      // the finished-week card: Sleeper's result, no bench swaps
      app.get('ui').tab = 'week';
      const card = await onDay('2026-11-03', () => app.pastWeekCard('2026-10-20'));
      assert.ok(card.includes('≈') && card.includes('no bench swaps'), 'marked, without swaps');
      // Awards: no week with real scores yet, so no Best manager, Week of the Year or Heartbreak Hotel
      app.get('ui').tab = 'awards';
      app.viewAwardsSoFar();
      await new Promise(r => setTimeout(r, 30));
      const aw = app.viewAwardsSoFar();
      assert.ok(!/aw-title">(Best manager|Week of the Year|Heartbreak Hotel)/.test(aw) && aw.includes('none yet'), 'none of the three, and the page says why');
      assert.match(aw, /aw-title">(Street Clothes|Old|Fan Boy)/, "the lineups' awards stay");
      // once the site has the total through week 1 (a read the week before), week 2's real score is the difference
      const t1 = Object.fromEntries(L.teams.map(t => [t.id, 100]));
      app.slpTotalsSave(L.id, { n: 1, pts: t1 });
      const w2 = app.slpWeekPts(L, 2);
      assert.ok(L.teams.every(t => Math.abs(w2[t.id] - (L.totals.pts[t.id] - 100)) < 0.01));
      assert.deepEqual({ ...app.slpWeekPts(L, 1) }, t1, 'and week 1 is that total');
    });
  } finally { app.setClock(); }
});
