const { test, assert, sharedApp, loadApp, CATS9, POINTS, DAILY, ESPN, useTeam, leagueInfo, between } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('the columns a matchup is decided on follow the league', async () => {
  await app.useLeague(CATS9);
  assert.equal(app.scoreCats().map(c => c.key).join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk,to');
  await app.useLeague(POINTS);
  assert.equal(app.scoreCats().map(c => c.key).join(), 'pts,reb,ast,stl,blk,to,fp');
  assert.ok(app.scoreCats().find(c => c.key === 'to').neg, 'negative points make a stat count against you');
});

test('category lists other than the standard nine', () => {
  const base = leagueInfo(CATS9).scoringSystem;
  const withCats = list => ({ ...base, scoringCategorySettings: [{ ...base.scoringCategorySettings[0], configs: list.map(([shortName, code]) => ({ position: { code: 'DEFAULT' }, scoringCategory: { shortName, code } })) }] });
  const cfgs = base.scoringCategorySettings[0].configs.map(c => [c.scoringCategory.shortName, c.scoringCategory.code]);

  const eight = app.fxCategories(withCats(cfgs.filter(([s]) => s !== 'TO')));
  assert.equal(eight.cats.join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk');

  const eleven = app.fxCategories(withCats([...cfgs, ['3PT%', 'INDIVIDUAL_THREE_POINT_FIELD_GOAL_PERCENTAGE'], ['DD', 'INDIVIDUAL_DOUBLE_DOUBLES'], ['A/TO', 'INDIVIDUAL_ASSIST_TO_TURNOVER_RATIO']]));
  assert.equal(eleven.cats.join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk,to,tpPct,dd', 'the nine in their order, then the others');
  assert.deepEqual([...eleven.catsOther], ['A/TO'], "ratios aren't projected, and say so");

  assert.deepEqual({ ...app.fxCategories(leagueInfo(POINTS).scoringSystem) }, {}, 'points leagues have no category list');
});

test("basketball's stats are always listed MIN, FG, FT, 3PM, PTS, REB, AST, STL, BLK, TO, then any others, VAL last (the owner's rule, Nov 23, 2026)", async () => {
  const a = loadApp();
  await a.ready();
  const NINE = ['FG', 'FT', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'];
  const rank = l => { const k = l.replace(/%$/, '').replace(/^(FG|FT)(M|A| miss)$/, '$1').replace(/^3P(A| miss)$/, '3PM'); return k === 'MIN' ? -1 : NINE.includes(k) ? NINE.indexOf(k) : ['VAL', 'FP'].includes(k) ? 99 : 50; };
  const ordered = (labels, what) => assert.deepEqual([...labels], [...labels].sort((x, y) => rank(x) - rank(y)), what);
  const L = await a.useLeague(CATS9);
  // a category league, saved on the device in another order, takes this one
  const cats = L.cats;
  L.cats = ['pts', 'reb', 'oreb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgPct', 'ftPct', 'tpPct'];
  a.set('catsMemo', { L: undefined, cats: [] });
  assert.equal(a.scoreCats().map(c => c.label).join(), 'FG%,FT%,3PM,PTS,REB,AST,STL,BLK,TO,3P%,OREB');
  // a points league: each stat it scores, a shooting pair as one in its place, fantasy points last
  const was = { scoring: L.scoring, points: L.points };
  Object.assign(L, { cats: undefined, scoring: 'POINTS', points: { oreb: 0.5, reb: 1.2, pts: 1, to: -1, fga: -1, fgm: 2, tpm: 1, ftm: 1, fta: -1, ast: 1.5, stl: 3, blk: 3 } });
  a.set('catsMemo', { L: undefined, cats: [] });
  assert.equal(a.lineCats().map(c => c.label).join(), 'FG,FT,3PM,PTS,REB,AST,STL,BLK,TO,OREB,FP');
  ordered(a.scoreCats().map(c => c.label), 'its columns');
  Object.assign(L, { cats, ...was });
  a.set('catsMemo', { L: undefined, cats: [] });
  // the player card's columns and a game's line (PF after them, in gray)
  const raw = a.NBA.players.find(r => r.cur && r.cur.gp);
  assert.equal(a.cardStats(raw).map(c => c[0]).join(), 'MIN,FG%,FT%,3PM,PTS,REB,AST,STL,BLK,TO,PF');
  const [main, gray] = a.gameStats(raw, { min: 30, fgm: 7, fga: 14, ftm: 3, fta: 4, tpm: 2, pts: 19, reb: 6, ast: 5, stl: 1, blk: 1, to: 2, pf: 3 });
  assert.equal(main.map(x => x.split(' ').pop()).join(), NINE.join());
  assert.deepEqual([...gray], ['3 PF']);
  // past rosters' tables, the sandbox's points editor
  assert.equal(a.get('SPORT').tableCols.map(x => x[1]).join(), 'MIN,FG%,FT%,3PM,PTS,REB,AST,STL,BLK,TO');
  const editor = a.get('SB_POINT_STATS').nba[0][1];
  assert.deepEqual([...editor], [...a.inCatOrder(editor)]);
  // Trends' lists: minutes, the categories with shooting in its place, shot attempts
  await a.loadBoxes();
  assert.equal(a.trendStats().map(x => x.label).join(), 'Minutes,FG%,FT%,Threes,Points,Rebounds,Assists,Steals,Blocks,Shot attempts');
  // the landing page's samples
  const land = a.viewLanding();
  assert.ok(land.includes('<th>Game</th><th>FG</th><th>3PM</th><th>PTS</th><th>REB</th><th>VAL</th>'), "the card's games");
  for (const [, , , , , tiles] of a.get('LAND_RECAP').filter(x => Array.isArray(x[5]))) ordered(tiles.map(t => t[1]), 'an award');
  ordered(a.get('LAND_PLAN').chips.map(c => c[0]), "a swap's chips");
});

test('an 11-category league projects every category', async () => {
  const L = await app.useLeague(CATS9);
  L.cats = ['fgPct', 'ftPct', 'tpPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'dd'];
  app.set('catsMemo', { L: null, cats: [] }); // forget the league's nine
  assert.equal(app.scoreCats().length, 11);
  const [a, b] = app.fxPickable();
  const A = app.fxTeamSide(a.id), B = app.fxTeamSide(b.id);
  for (const p of A.players) {
    const z = app.catZ(p);
    assert.equal(Object.keys(z).length, 11);
    assert.ok(Number.isFinite(app.value(p)), `${p.name} has a value`);
  }
  const dates = app.matchDates();
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  assert.equal(cats.length, 11);
  for (const c of cats) assert.ok(between(c.p, 0, 1), `${c.label} win chance ${c.p}`);
  const tp = cats.find(c => c.key === 'tpPct');
  assert.ok(between(tp.a, 0.2, 0.5), `team 3P% ${tp.a}`);
  assert.ok(between(app.matchOdds(cats).win, 0, 1));
  delete L.cats;
});

test('points matchups project fantasy points with sensible odds', async () => {
  await app.useLeague(POINTS);
  const [a, b] = app.fxPickable();
  const A = app.fxTeamSide(a.id), B = app.fxTeamSide(b.id);
  const dates = app.matchDates();
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  const fp = cats.find(c => c.fp);
  assert.ok(fp.a > 100 && fp.b > 100, `projected FP ${fp.a} vs ${fp.b}`);
  const odds = app.matchOdds(cats);
  assert.ok(between(odds.win, 0, 1) && odds.points);
});

test('a matchup week covers the league period, and daily leagues still project', async () => {
  await app.useLeague(CATS9);
  assert.equal(app.matchDates().length, 7);
  await app.useLeague(DAILY);
  const dates = app.matchDates();
  assert.ok(dates.length >= 6, `${dates.length} days`);
  const pool = app.nbaPlayers().slice(0, 13).map(x => app.playerFromRaw(app.nbaById.get(x.nbaId)));
  const S = app.projectSide(pool, dates, null);
  assert.ok(Number.isFinite(app.fpTotals(S).a) && app.fpTotals(S).a > 0, 'double/triple-double points included without NaN');
});

test('player value everywhere is the Dashboard\'s: categories won per game; trades count it over a waiver player', async () => {
  useTeam((await app.useLeague(CATS9)).teams[0].id); // its trade needs a team being managed
  const list = app.nbaPlayers().filter(p => p.gp >= 2).sort((a, b) => b.val - a.val);
  const p = list[0];
  assert.ok(Math.abs(p.val - Object.values(app.catWins(p)).reduce((a, b) => a + b, 0)) < 1e-12);
  // an average game of his is worth his value (FG% × attempts for makes, the same as a game line)
  const line = { ...app.statLine(p) };
  assert.ok(Math.abs(app.lineValue(line) - app.value(p)) < 1e-9);
  assert.ok(list.filter(x => x.val < 0).length < list.length / 10, 'nearly every player adds something when he plays');
  const wv = app.waiverValue();
  assert.ok(wv > 0 && wv < p.val, `the best waiver player is worth ${wv.toFixed(2)} a game`);
  // starting a player for the week: his games × his value
  const raw = app.nbaById.get(p.nbaId), pl = app.playerFromRaw(raw);
  const dates = app.matchDates(app.weekStart());
  if (pl.status !== 'Out') assert.ok(Math.abs(app.weeklyPriority(pl, dates) - app.gamesIn(pl, dates) * Math.max(app.value(pl), 0.01)) < 1e-12);
  // a trade: two for one only wins if they beat the one plus the waiver player you'd otherwise keep
  const mine = app.get('state').players;
  const theirTeam = app.fxPickable().find(t => t.id !== app.get('state').fxTeam);
  const theirs = app.fxTeamSide(theirTeam.id).players.filter(x => x.nbaId);
  const ui = app.get('ui');
  ui.tradeTeam = theirTeam.id; ui.tradeGive.clear(); ui.tradeGet.clear();
  try {
    const give = mine[0], get = theirs.slice(0, 2);
    ui.tradeGive.add(give.id); get.forEach(x => ui.tradeGet.add(String(x.nbaId)));
    const html = app.viewTrade();
    const net = get.reduce((t, x) => t + app.value(x) - wv, 0) - (app.value(give) - wv);
    assert.ok(html.includes(`over a waiver player"><b>${app.fmtValue(net)}</b>`), 'net over a waiver player, in For your team');
  } finally { ui.tradeGive.clear(); ui.tradeGet.clear(); }
});

test("value baselines come from the data: the league's rostered pool, that season's stats", async () => {
  await app.ready();
  const L = await app.useLeague(CATS9);
  app.scoreCats();
  const B = app.get('BASE');
  assert.equal(B.pool, L.teams.length * (app.state.slots.length + app.state.benchSize), 'teams x roster spots');
  assert.ok(B.pts[0] > 10 && B.pts[0] < 25 && B.pts[1] > 2, `PTS ${B.pts}`);
  assert.notDeepEqual([...B.ftPct], [0.78, 0.7], 'not the old fixed numbers');
  const E = await app.useLeague(ESPN);
  app.scoreCats();
  const BE = app.get('BASE');
  assert.equal(BE.pool, E.teams.length * (app.state.slots.length + app.state.benchSize), 'ESPN too: teams x roster spots');
  const stats = app.get('NBA').players.map(r => app.nbaStats(r, 'blend')).filter(Boolean).map(x => ({ ...x, sample: x.gp }));
  assert.ok(app.computeBase(stats, 60).pts[0] > app.computeBase(stats, 200).pts[0], 'a smaller league rosters better players, so the bar is higher');
  // a past season is judged against its own season's stats
  await app.loadSeason('czqgnyozmf2tbr93');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let past;
  try { app.withSeason(() => { app.scoreCats(); past = app.get('BASE'); }); } finally { app.get('ui').season = null; }
  assert.notEqual(app.get('BASE'), past, "this season's baselines are back as soon as the past season is done");
  await app.useLeague(CATS9);
  app.scoreCats();
  const now = app.get('BASE');
  assert.ok(past.pool >= 20 && past !== now && past.pts[0] !== now.pts[0], `2025-26 PTS ${past.pts} vs now ${now.pts}`);
});

test('value weights follow the league: two leagues of the same size with different categories', async () => {
  const L = await app.useLeague(CATS9);
  const keys = () => Object.keys(app.winWeights()).sort().join();
  const before = keys();
  // the same league without one of its categories: same teams and spots, so the same baselines
  const L2 = { ...L, cats: L.cats.slice(1) };
  app.get('NBA').league = L2;
  app.applyLeagueRules(L2);
  try {
    assert.equal(keys(), app.scoreCats().filter(c => !c.fp).map(c => c.key).sort().join(), 'weights for exactly these categories');
    assert.notEqual(keys(), before);
  } finally { await app.useLeague(CATS9); }
});

test("Stats used is a choice only early in a season: once the typical team is more than 10 games in, it's this season's alone", async () => {
  const a = loadApp();
  await a.ready();
  try {
    const S = a.get('state'), NBA = a.get('NBA');
    const raw = NBA.players.find(p => p.cur && p.cur[0] && p.prev && p.prev[0]);
    const key = NBA.statKeys.find(k => k !== 'gp' && a.get('nbaStats')(raw, 'cur')[k] !== a.get('nbaStats')(raw, 'prev')[k]);
    const now = () => a.get('nbaStats')(raw)[key];
    assert.equal(a.get('seasonSettled')(), false, 'a week in: the choice stands');
    S.basis = 'prev';
    assert.equal(now(), a.get('nbaStats')(raw, 'prev')[key]);
    assert.equal(a.get('basisLabel')(), 'Last season');
    a.setClock('2026-12-15T12:00:00-05:00');
    assert.equal(a.get('seasonSettled')(), true, 'two months in');
    assert.equal(now(), a.get('nbaStats')(raw, 'cur')[key], 'this season, whatever was chosen');
    assert.equal(a.get('basisLabel')(), 'This season');
    assert.equal(a.get('nbaPlayers')().find(p => p.nbaId === raw.id)[key], now(), 'the Players list too');
    // someone yet to play this season: last season's, not nothing
    const out = { ...raw, cur: null };
    assert.equal(a.get('nbaStats')(out)[key], a.get('nbaStats')(raw, 'prev')[key]);
    assert.equal(a.get('nbaStats')(out, 'cur'), null, "asked for this season by name (a draft's grades): only this season");
  } finally { a.setClock(); }
});
