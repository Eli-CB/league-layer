const { test, assert, sharedApp, loadApp, readFixture, CATS9, POINTS, ESPN, HOCKEY, quiet, hockeyApp } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('a Fantrax league says its sport: reading one changes nothing until it is opened', async () => {
  const a = loadApp();
  await a.ready();
  const { league, idMap } = await a.fetchFantraxLeague(HOCKEY);
  assert.equal(league.sport, 'nhl');
  assert.equal(a.get('SPORT').key, 'nba', 'still basketball');
  assert.equal(a.get('POSITIONS')[0], 'PG');
  // all rostered players matched, the two Elias Petterssons (a center and a defenseman, one team) to the right one
  const rostered = Object.values(league.rosters).flat();
  const missing = rostered.filter(x => !x.nba).map(x => x.name);
  assert.ok(missing.length <= 1 && missing.every(n => n === 'Caleb Malhotra'), `all but a prospect with no NHL games: ${missing}`); // (he's in no NHL data)
  const ids = JSON.parse(readFixture('fantrax/nhl/getPlayerIds.json'));
  const data = JSON.parse(readFixture('nhl/players.json'));
  const eps = Object.entries(ids).filter(([, v]) => v.name === 'Pettersson, Elias');
  assert.equal(eps.length, 2);
  for (const [fid, v] of eps) {
    const raw = data.players.find(p => p.id === idMap.toNba[fid]);
    assert.equal(raw.pos[0] === 'D', v.position === 'D', `${v.position} goes to ${raw.pos}`);
  }
  assert.equal((await a.fetchFantraxLeague(POINTS)).league.sport, 'nba');
  // the same name twice, one listed on another team than the NHL's: each still goes to the player of his role
  const D = { players: [{ id: 1, name: 'Sebastian Aho', team: 'CAR', pos: ['C'] }, { id: 2, name: 'Sebastian Aho', team: 'PIT', pos: ['D'] }] };
  const m = a.matchPlayers({ c: { team: 'CAR', position: 'C' }, d: { team: 'NYI', position: 'D' } }, { c: 'Sebastian Aho', d: 'Sebastian Aho' }, D, a.hockeyRole);
  assert.equal(m.c, 1);
  assert.equal(m.d, 2);
  // a namesake with no NHL data of his own leaves the player he shares a name with alone
  const one = { players: [D.players[0]] };
  const n = a.matchPlayers({ d: { team: 'PIT', position: 'D' }, c: { team: 'CAR', position: 'C' } }, { c: 'Sebastian Aho', d: 'Sebastian Aho' }, one, a.hockeyRole);
  assert.equal(n.c, 1);
  assert.equal(n.d, undefined);
});

test('hockey scoring: goals and assists count apart for skaters and goalies, and every rule comes from the league', async () => {
  const a = await hockeyApp();
  const L = a.fxLeague(), state = a.get('state');
  assert.equal(a.get('SPORT').key, 'nhl');
  assert.equal(state.sport, 'nhl');
  assert.deepEqual({ ...L.points }, { a: 1, ag: 1, blk: 0.1, g: 2, gg: 2, otl: 1, pm: 0.5, so: 3, sog: 0.1, sol: 1, w: 2 });
  assert.deepEqual([...L.pointsOther], []);
  assert.equal(+a.lineFp({ g: 1, a: 1, pm: 1, sog: 2, blk: 1 }).toFixed(2), 3.8);
  assert.equal(a.lineFp({ w: 1, so: 1, ag: 1 }), 6);
  assert.equal(a.lineFp({ sol: 1 }), 1, 'a shootout loss once: Fantrax scores it apart from an overtime loss');
  assert.equal(state.slots.join(), 'C,C,C,W,W,W,W,W,W,D,D,D,D,G,G');
  assert.equal(state.benchSize, 6);
  assert.equal(state.lineupMode, 'weekly');
  // "W" on Fantrax plays either wing
  const w = state.players.find(p => state.lineup.includes(p.id) && a.slotOf(p) === 'W');
  assert.ok(a.canPlay(w, 'W') && !a.canPlay(w, 'D'));
  assert.equal(state.lineup.filter(Boolean).length, 15);
  assert.ok(state.players.every(p => p.pos.every(x => a.get('POSITIONS').includes(x))));
  // goalies' stats never land in a skater's column
  const box = JSON.parse(readFixture('nhl/boxscores.json')), keys = box.keys;
  const row = Object.values(box.games).flatMap(g => g.rows).find(r => r.length > 2 + keys.indexOf('sa'));
  const line = Object.fromEntries(keys.map((k, i) => [k, row[i + 2] || 0]));
  assert.ok(line.sa > 0 && !line.g && !line.a && !line.pts);
});

test('hockey: every tab shows real numbers, the player card speaks hockey', async () => {
  const a = await hockeyApp();
  // lineup spots in Fantrax's hockey colors: F green, D purple, G brown (basketball's G stays its own orange)
  assert.match(a.slotBadge('F'), /pc-emerald-1/);
  assert.match(a.slotBadge('D'), /pc-purple-2/);
  assert.match(a.slotBadge('G'), /pc-amber-2/);
  assert.match(app.slotBadge('G'), /pc-orange-1/);
  await a.loadBoxes();
  const ui = a.get('ui'), L = a.fxLeague();
  assert.equal(a.tabList().length, 9);
  assert.equal(a.hasLineupHistory(L), true);
  for (const [tab, make] of Object.entries({ dashboard: () => a.viewDashboard(), week: () => a.withViewedTeam(a.viewWeek, true), players: () => a.viewPlayers(), standings: () => a.viewStandings() })) {
    ui.tab = tab;
    const html = make();
    quiet(a);
    assert.ok(html.length > 500, `${tab} draws`);
    assert.ok(!/undefined|NaN|\[object/.test(html.replace(/<[^>]*>/g, ' ')), `${tab} has only real numbers`);
  }
  ui.tab = 'standings';
  // a week's projection and a win chance from real rosters
  const ctx = a.weekContext();
  assert.ok(ctx.oSet.expected > 20 && ctx.oSet.win > 0 && ctx.oSet.win < 1, JSON.stringify(ctx.oSet));
  // the player card speaks hockey, a goalie his own language
  const raw = a.get('NBA').players;
  const goalie = raw.find(p => p.pos.includes('G') && p.cur), skater = raw.find(p => p.pos.includes('C') && p.cur);
  assert.equal(a.cardStats(goalie).map(c => c[0]).join(), 'GS,MIN,W,L,OTL,SO,GA,SV%,GAA');
  // his card's second tile: the starts he's likely to get, not his team's games (the test page keeps what's drawn into the card)
  const doc = a.document, realQuery = doc.querySelector, card = realQuery();
  doc.querySelector = sel => (sel === '#detailBody' ? card : realQuery(sel));
  try {
    a.showPlayerDetail(goalie.id);
    const tile = String(card.innerHTML).match(/Starts left this week<\/div><div class="v">([^<]*)</);
    assert.ok(tile && /^(about [\d.]+|—)$/.test(tile[1]), `a goalie's tile: ${tile && tile[1]}`);
    // his categories against goalies, a skater's against skaters (a skater has no saves)
    const profile = () => [...String(card.innerHTML).matchAll(/<span class="cp-k">([^<]+)<\/span>/g)].map(m => m[1]);
    const goalieLabels = new Set(a.lineCats().filter(c => !c.fp && a.SPORT.goalieCats.includes(c.key)).map(c => c.label));
    assert.ok(profile().length && profile().every(l => goalieLabels.has(l)), `a goalie's: ${profile()}`);
    a.showPlayerDetail(skater.id);
    assert.ok(profile().length && !profile().some(l => goalieLabels.has(l)), `a skater's: ${profile()}`);
    assert.match(String(card.innerHTML), /Games left this week/, "a skater's: games left");
    assert.doesNotMatch(String(card.innerHTML), /Starts left this week/);
  } finally { doc.querySelector = realQuery; }
  assert.equal(a.cardStats(skater).map(c => c[0]).slice(0, 4).join(), 'MIN,G,A,PTS');
  assert.match(a.gameStats(goalie, { sv: 30, sa: 32, ga: 2, w: 1 })[0][0], /30 saves on 32/);
  assert.equal(a.gameStats(goalie, { sv: 30, sa: 32, ga: 2, w: 1 })[1][0], 'Win');
  assert.equal(a.gameStats(skater, { g: 1, a: 2, sog: 4, hit: 1, blk: 0, pm: 2, pim: 0 })[1][0], '+2');
});

test('hockey category leagues: lower is better for goals against, and a rate is not a percentage', async () => {
  const a = await hockeyApp();
  const cfg = (code, shortName) => ({ position: { code: 'DEFAULT' }, scoringCategory: { code, shortName }, points: 0 });
  const ss = { type: 'HEAD_TO_HEAD', scoringCategorySettings: [
    { group: { code: 'HOCKEY_SKATING' }, configs: [cfg('INDIVIDUAL_ASSISTS', 'A'), cfg('INDIVIDUAL_GOALS', 'G'), cfg('POWER_PLAY_POINTS', 'PPP'), cfg('INDIVIDUAL_SHOTS_ON_GOAL', 'SOG'), cfg('FACEOFF_WIN_PERCENT', 'FO%'), cfg('MADE_UP', 'XYZ')] },
    { group: { code: 'HOCKEY_GOALIE' }, configs: [cfg('INDIVIDUAL_GOALIE_WINS', 'W'), cfg('GOALS_AGAINST_AVERAGE', 'GAA'), cfg('SAVE_PERCENTAGE', 'SV%')] },
  ] };
  const { cats, catsOther } = a.fxCategories(ss, 'nhl');
  assert.deepEqual([...cats], ['g', 'a', 'sog', 'ppp', 'foPct', 'w', 'gaa', 'svPct'].sort((x, y) => a.get('CAT_ORDER').indexOf(x) - a.get('CAT_ORDER').indexOf(y)));
  assert.deepEqual([...catsOther], ['XYZ']);
  const L = a.fxLeague();
  L.scoring = 'HEAD_TO_HEAD'; L.points = undefined; L.cats = cats;
  a.set('catsMemo', { L: undefined, cats: [] });
  const list = a.scoreCats(), gaa = list.find(c => c.key === 'gaa');
  assert.ok(gaa.pct && gaa.neg && gaa.rate);
  const side = (ga, gt) => ({ tot: { ga, gt, sv: 300, sa: 300 + ga, ppg: 3, ppa: 4, fow: 10, fot: 20 }, vr: { ga: 3 }, left: { gt: gt / 2, sa: 100 } });
  const c = a.compareCats(side(10, 5), side(20, 5)).find(x => x.key === 'gaa');
  assert.equal(c.a, 2);
  assert.ok(c.p > 0.5, `fewer goals against wins it (${c.p})`);
  assert.ok(Number.isFinite(c.p));
  const players = a.get('NBA').players, goalie = players.find(p => p.pos.includes('G') && p.cur);
  const w = a.catWins({ ...a.nbaStats(goalie) });
  assert.ok(Object.values(w).every(Number.isFinite), JSON.stringify(w));
  assert.equal(a.get('PCT_CATS').gaa[3].rate, true);
  assert.equal(a.pctWords(gaa, 2.5), '2.50');
});

test('hockey live scores: forwards, defensemen and goalies from ESPN, Vancouver\'s Petterssons kept apart', async () => {
  const a = await hockeyApp();
  const D = a.get('NBA').players.find(p => p.name === 'Elias Pettersson' && p.pos.includes('D'));
  const C = a.get('NBA').players.find(p => p.name === 'Elias Pettersson' && !p.pos.includes('D'));
  const G = a.get('NBA').players.find(p => p.pos.includes('G') && p.team);
  const skKeys = ['blockedShots', 'hits', 'plusMinus', 'timeOnIce', 'goals', 'assists', 'shotsTotal', 'faceoffsWon', 'faceoffsLost', 'penaltyMinutes'];
  const noId = (r, name) => ({ athlete: { id: '1', displayName: name }, stats: r });
  const sm = { boxscore: { players: [
    { team: { abbreviation: 'VAN' }, statistics: [
      { name: 'forwards', keys: skKeys, athletes: [noId(['1', '2', '-1', '18:30', '1', '1', '3', '7', '5', '2'], 'Elias Pettersson')] },
      { name: 'defenses', keys: skKeys, athletes: [noId(['3', '1', '2', '21:00', '0', '1', '1', '0', '0', '0'], 'Elias Pettersson')] },
    ] },
    { team: { abbreviation: G.team }, statistics: [{ name: 'goalies', keys: ['goalsAgainst', 'shotsAgainst', 'saves', 'timeOnIce', 'penaltyMinutes'], athletes: [{ athlete: { id: String(G.espn || 1), displayName: G.name }, stats: ['2', '30', '28', '60:00', '0'] }] }] },
  ] } };
  if (C.espn) delete C.espn;
  if (D.espn) delete D.espn;
  const lines = a.espnLines(sm);
  assert.equal(lines.get(C.id).fow, 7);
  assert.equal(lines.get(C.id).min, 18.5);
  assert.equal(lines.get(D.id).blk, 3);
  assert.equal(lines.get(G.id).sv, 28);
  assert.equal(lines.get(G.id).gt, 1);
  assert.equal(a.espnTri({ abbreviation: 'TB' }), 'TBL');
  // a hockey clock: three periods of twenty minutes
  assert.equal(a.gameMinLeft({ state: 'pre' }), 60);
  assert.equal(a.gameMinLeft({ state: 'in', period: 2, clock: 600 }), 30);
  assert.equal(a.gameMinLeft({ state: 'in', period: 4, clock: 100 }), 0);
});

test('changing sports: each league comes back as it was, and one that does not load changes nothing', async () => {
  const a = await hockeyApp();
  const hockeyTeam = a.get('state').fxTeam;
  await a.switchLeague(CATS9);
  a.adoptTeam(a.fxLeague().teams[0].id);
  quiet(a);
  assert.equal(a.get('SPORT').key, 'nba');
  assert.equal(a.get('POSITIONS')[0], 'PG');
  assert.equal(a.get('state').sport, 'nba');
  assert.equal(a.fxLeague().id, CATS9);
  assert.equal(a.get('state').slots.length, 8);
  assert.equal(a.tabList().length, 9);
  const nbaTeam = a.get('state').fxTeam;
  await a.switchLeague(HOCKEY);
  quiet(a);
  assert.equal(a.get('SPORT').key, 'nhl');
  assert.equal(a.get('state').fxTeam, hockeyTeam);
  assert.equal(a.get('state').slots.length, 15);
  assert.equal(a.get('BOX'), null, "no box scores of the other sport's");
  await assert.rejects(a.connectLeague('nosuchleague01'), /didn't find that league/);
  assert.equal(a.get('SPORT').key, 'nhl');
  assert.equal(a.fxLeague().id, HOCKEY);
  assert.equal(a.get('ui').hold, false);
  await a.switchLeague(CATS9);
  quiet(a);
  assert.equal(a.get('state').fxTeam, nbaTeam);
  // a saved hockey league opens as hockey after a refresh
  const saved = a.get('state');
  saved.sport = 'nhl';
  a.localStorage.setItem('league-layer-v1', JSON.stringify({ ...saved, slots: ['C', 'W', 'D', 'G'], players: [{ name: 'A Goalie', pos: ['G'] }] }));
  const s = a.load();
  assert.equal(a.get('SPORT').key, 'nhl');
  assert.equal(s.slots.join(), 'C,W,D,G');
  assert.equal(s.players[0].pos[0], 'G');
});

test('who starts in goal: shares from recent starts, the night after, and ESPN naming the starter', async () => {
  const a = await hockeyApp();
  const NBA = a.get('NBA');
  // a team of two, made up: the first has started most, and the last game
  const [one, two] = NBA.players.filter(p => p.pos.includes('G')).slice(0, 2);
  Object.assign(one, { team: 'XXX', st: 0.7, inj: null });
  Object.assign(two, { team: 'XXX', st: 0.3, inj: null });
  NBA.teams.XXX = { lg: [one.id, '2026-10-26'], dates: [], left: 2 };
  a.get('teamDates').set('XXX', new Set(['2026-10-27', '2026-10-29', '2026-10-31']));
  a.set('startMemo', { key: null, teams: new Map() });
  const P = { pos: ['G'], team: 'XXX', nbaId: one.id }, Q = { pos: ['G'], team: 'XXX', nbaId: two.id };
  const on = (x, d) => +a.startChance(x, d).toFixed(3);
  // the night after his start he rarely goes again: 0.7 × 0.1 against 0.3
  assert.equal(on(P, '2026-10-27'), +(0.07 / 0.37).toFixed(3));
  assert.equal(+(on(P, '2026-10-27') + on(Q, '2026-10-27')).toFixed(2), 1, "the team's chances add up");
  assert.ok(on(P, '2026-10-29') > 0.6, 'with a day off he is the likely starter again');
  assert.equal(a.startChance({ pos: ['G'], team: 'XXX', nbaId: 1 }, '2026-10-27'), 0, 'a goalie with no share');
  assert.equal(a.startChance({ pos: ['C'], team: 'XXX' }, '2026-10-27'), 1, 'skaters play their games');
  // his week: three team games, under three starts
  const dates = ['2026-10-27', '2026-10-29', '2026-10-31'];
  const week = a.expectedGames(P, dates) + a.expectedGames(Q, dates);
  assert.equal(+week.toFixed(2), 3);
  assert.ok(a.weekGames(P, dates) < 2.5 && a.weekGames(P, dates) > 1, String(a.weekGames(P, dates)));
  assert.equal(a.weeklyPriority({ ...P, status: 'Healthy' }, dates) < a.gamesIn(P, dates) * Math.max(a.value(P), 0.01), true);
  // ruled Out: all to the other
  one.inj = { status: 'Out', label: 'Out', note: '' };
  a.set('startMemo', { key: null, teams: new Map() });
  assert.equal(on(Q, '2026-10-27'), 1);
  one.inj = null;
  // ESPN names him: Expected counts for most of it, Confirmed for all, and the page says so
  const live = a.get('live');
  live.at = 123;
  live.games = [{ d: '2026-10-27', home: 'XXX', away: 'YYY', state: 'pre', goalies: { XXX: { a: { id: 'none', displayName: two.name }, sure: false } } }];
  two.espn = 777; live.games[0].goalies.XXX.a.id = '777';
  a.set('espnIndex', null);
  assert.ok(on(Q, '2026-10-27') >= 0.75 && on(Q, '2026-10-27') < 1);
  live.games[0].goalies.XXX.sure = true;
  live.at = 124;
  assert.equal(on(Q, '2026-10-27'), 1);
  assert.equal(on(P, '2026-10-27'), 0);
  assert.equal(a.startWords(Q, '2026-10-27'), 'starting');
  assert.equal(a.startWords(P, '2026-10-27'), 'not starting');
  live.games = [];
  live.at = 125;
  assert.match(a.startWords(P, '2026-10-29'), /^\d+% to start$/);
});

test('goalies project by their starts: a team of two does not count two goalies a game', async () => {
  const a = await hockeyApp();
  await a.loadBoxes();
  const state = a.get('state'), dates = a.matchDates(a.weekStartAt(0));
  const goalies = state.players.filter(p => p.pos.includes('G'));
  assert.ok(goalies.length, 'the team has goalies');
  const g = goalies[0], ids = new Set([g.id]);
  const full = a.get('NBA').players.find(p => p.id === g.nbaId);
  // from the projection: his wins are his per-game rate × his expected starts, not × his team's games
  const games = dates.filter(d => a.playsOn(g, d) && !a.gameFinal(g, d)), S = a.projectSide([g], games, ids);
  const pg = a.perGame(g).m.w;
  assert.ok(Math.abs(S.tot.w - pg * a.expectedGames(g, games)) < 1e-9);
  assert.ok(a.expectedGames(g, games) < games.length, `${a.expectedGames(g, games)} of ${games.length}`);
  assert.ok(full.st > 0 && full.st <= 1);
  // the projection's spread is wider for not knowing whether he plays
  const sd = a.perGame(g).sd.w, c = a.startChance(g, games[0]);
  const one = a.projectSide([g], [games[0]], ids);
  assert.ok(Math.abs(one.vr.w - (c * (sd ** 2 + pg ** 2) - (c * pg) ** 2)) < 1e-9);
  // a league's value baselines hold a league's goalies, not every goalie who's played
  const base = a.computeBase(a.get('NBA').players.map(r => { const s = a.nbaStats(r, 'blend'); return s && { ...s, sample: s.gp }; }), 252);
  assert.ok(base.w[0] > 0 && base.w[0] < 0.2, `wins per pool player: ${base.w[0]}`);
});

test('hockey history: weeks, recaps and awards run on its box scores, and a healthy backup never missed a game', async () => {
  const a = await hockeyApp();
  const L = a.fxLeague(), ui = a.get('ui');
  const [weeks, G] = await Promise.all([a.loadRosterWeeks(L), a.loadGameLog('cur')]);
  quiet(a);
  assert.ok(weeks.length >= 4, `${weeks.length} weeks`);
  assert.ok(G.keys.includes('sv') && G.keys.includes('gg'), "the game log has hockey's columns");
  const line = a.gameLine(G, [...G.players.values()][0][0]);
  assert.ok(line.gp1 === 1 && Object.values(line).every(Number.isFinite), 'a trimmed row reads as zeros');
  // week by week the two teams add up from their starters
  const LL = { ...L, weeks, fidNba: a.currentFidNba() };
  const period = L.periods.find(p => p.n === 3), pair = L.matchups['3'][0];
  const R = a.benchSwaps(LL, G, weeks, period, pair);
  assert.equal(R.length, 2);
  assert.ok(a.lineFp(R[0].tot) > 10 && a.lineFp(R[1].tot) > 10);
  // Street Clothes: skaters who sat, no goalies
  const missed = Object.values(a.startersMissed(LL, G)).flat();
  assert.ok(missed.length > 0, 'skaters miss games');
  assert.ok(!missed.some(x => a.isGoalie(a.nbaById.get(x.nba))), 'no goalie is in it');
  // a recap line is a skater's or a goalie's, not both
  assert.ok(!/ W|SOG/.test(a.fullLine({ min: 60, sa: 30, sv: 28, ga: 2, gs: 1, w: 1 }).join(' ').replace(/ W\b/, '')), 'a goalie has no shots');
  assert.match(a.fullLine({ min: 60, sa: 30, sv: 28, ga: 2, gs: 1, w: 1 }).join(' '), /1 W/);
  assert.ok(!a.fullLine({ min: 20, g: 1, a: 1, sog: 3 }).join(' ').includes(' W'), 'a skater has no wins');
  // the tabs that were basketball's
  await a.loadBoxes();
  for (const [tab, make] of Object.entries({ recap: () => a.viewRecap(), awards: () => a.viewAwards(), draft: () => a.viewDraft(), trade: () => a.viewTrade() })) {
    ui.tab = tab;
    const html = make();
    await new Promise(r => setTimeout(r, 30));
    const again = make();
    quiet(a);
    assert.ok(!/undefined|NaN|\[object/.test(again.replace(/<[^>]*>/g, ' ')), `${tab} has only real numbers`);
    assert.ok(html.length && again.length > 100, tab);
  }
  // the recap's hockey items: a goalie of the week (a goalie's line), and three-goal games
  const X = [...a.get('recaps').values()].find(Boolean);
  assert.ok(!X.goalie || (X.goalie.line.sa || X.goalie.line.gs) && X.goalie !== X.mvp, 'Goalie of the period: a goalie, not the Player of the period');
  assert.ok(X.hats.every(x => a.lineStat(x.line, 'g') >= 3));
  ui.tab = 'standings';
});

test('hockey trades and waivers weigh a goalie by the games he plays; past seasons stay with their sport', async () => {
  const a = await hockeyApp();
  const players = a.get('NBA').players, backup = players.find(p => p.pos.includes('G') && p.st > 0 && p.st < 0.5 && p.cur && p.cur[0] > 2);
  const P = a.playerFromRaw(backup);
  assert.ok(Math.abs(a.gameWorth(P)) < Math.abs(a.value(P))); // (nearer nothing: a backup can be worth less than not playing)
  assert.equal(a.gameWorth(P).toFixed(4), (a.value(P) * backup.st).toFixed(4));
  const skater = a.playerFromRaw(players.find(p => p.pos.includes('C') && p.cur));
  assert.equal(a.gameWorth(skater), a.value(skater));
  // a trade proposal: a goalie's line is a goalie's, a skater's a skater's; the side with no goalie has no goalie rates
  const goalieKeys = new Set(a.get('SPORT').goalieCats), cats = a.dealCats();
  const labels = keep => new Set(cats.filter(c => !c.fp && keep(goalieKeys.has(c.key))).map(c => ` ${c.label}`));
  const has = (line, set) => line.some(x => [...set].some(l => x.endsWith(l) || x.includes(`${l.replace('%', '')} (`))); // ("25.1-27.3 SV (.919)")
  assert.ok(!has(a.dealLine(P), labels(g => !g)) && !has(a.dealLine(skater), labels(g => g)));
  const [t1, t2] = a.fxPickable().map(t => t.id);
  const M = a.tradeModel({ from: t1, to: t2, give: [String(skater.nbaId)], get: [String(backup.id)] });
  for (const r of M.rows.filter(r => cats.some(c => c.key === r.key && (c.pct || c.rate) && goalieKeys.has(c.key)))) assert.ok(r.sb === '—' && r.lead === 0, r.key);
  assert.ok(!M.rows.some(r => /NaN|undefined/.test(r.sa + r.sb)));
  // a retired player from a past season's archive plays his own position, not every one
  const A = { players: new Map([[99, { n: 'Old Goalie', p: 'G' }], [98, { n: 'Old Winger', p: 'L' }]]) };
  const find = a.matchInactive({ rosters: {} }, A);
  assert.equal(a.nbaById.get(find('Old Goalie')).pos[0], 'G');
  assert.equal(a.nbaById.get(find('Old Winger')).pos[0], 'LW');
  assert.equal(a.isGoalie(a.nbaById.get(find('Old Winger'))), false);
  // table columns follow the sport
  assert.equal(a.get('SPORT').tableCols.map(x => x[1]).slice(1, 3).join(), 'G,A');
  assert.ok(a.statCells({ min: 20, g: 0.5, a: 0.5, sog: 3, hit: 1, blk: 1, sv: 0, sa: 0 }).includes('0.5'));
});

test('the landing page offers both sports, and says so when a league is on a site without hockey', async () => {
  const a = loadApp();
  await a.ready();
  const html = a.viewLanding();
  assert.match(html, /fantasy basketball or hockey week/);
  assert.match(html, /basketball on Fantrax, ESPN and Sleeper, hockey on Fantrax/);
  assert.match(html, /Try the sandbox<\/b><small>A team of any NBA or NHL players/);
  // a look inside: the live matchup, the draft board and the recap's picture, each with a way into its tab in the demo
  assert.match(html, /Every game, live[^]*data-tab="dashboard"[^]*Every pick on one board[^]*data-tab="draft"[^]*Recaps for the league chat[^]*data-tab="recap"/);
  // the brand in the head, where a league's menu goes once there is one
  const menu = new (a.document.createElement().constructor)(), find = a.document.querySelector;
  a.document.querySelector = sel => (sel === '#leagueMenu' ? menu : find(sel));
  a.leagueMenu();
  a.document.querySelector = find;
  assert.match(menu.innerHTML, /lm-mark[^]*League Layer/);
  await assert.rejects(a.connectLeague('https://fantasy.espn.com/hockey/league?leagueId=12345678'), /hockey works with Fantrax leagues/);
});

test("a season's memos don't cross sports", async () => {
  const a = await hockeyApp();
  a.get('gameLogs')['2025-26'] = { made: 'up' };
  a.get('archives')['2025-26'] = { made: 'up' };
  await a.switchLeague(CATS9);
  quiet(a);
  assert.equal(a.get('gameLogs')['2025-26'], undefined);
  assert.equal(a.get('archives')['2025-26'], undefined);
  assert.equal(a.get('SPORT').tableCols.map(x => x[1]).slice(1, 3).join(), 'FG%,FT%');
});

test("a hockey team's record keeps its overtime and shootout losses apart (W-L-OT), today's too", async () => {
  const a = await hockeyApp();
  await a.loadBoxes();
  const box = a.get('BOX'), tri = a.NBA.players.find(r => r.team && r.cur).team, dates = [...a.get('teamDates').get(tri)].sort();
  assert.ok([...box.scores.values()].every(s => ['REG', 'OT', 'SO'].includes(s.last)), "every final says how it ended");
  const real = a.teamRecord(tri);
  assert.match(real, /^\d+-\d+-\d+$/, `W-L-OT even with no overtime loss: ${real}`);
  const game = (d, home, away, hs, as, last) => [`${d} ${home}`, `${d} ${away}`].map(k => [k, { home, away, hs, as, last }]);
  a.set('BOX', { ...box, scores: new Map([...game(dates[0], tri, 'BOS', 3, 2, 'OT'), ...game(dates[1], tri, 'BOS', 2, 3, 'OT'), ...game(dates[2], 'NYR', tri, 4, 3, 'SO'), ...game(dates[3], 'NYR', tri, 5, 1, 'REG')]) });
  a.get('live').games = [{ d: dates[4], home: tri, away: 'TOR', hs: 1, as: 2, state: 'post', period: 4 }];
  assert.equal(a.teamRecord(tri), '1-1-3', 'an overtime win is a win; two late losses, and tonight\'s in overtime');
});
