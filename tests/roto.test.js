const { test, assert, sharedApp, loadApp, readFixture, ESPN, ESPN_ROTO, between } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

// ----- Roto: ESPN's standings and games limits, and every tab without an opponent -----
// The saved league hasn't played a game (it starts Nov 19), so each test season is made up here in ESPN's layout: each team's
// season totals by ESPN stat id, and its roto points from them as ESPN gives them (in each category the best team gets 10,
// the worst 1, ties splitting). Team 3 is "you".
function rotoSeason() {
  const j = JSON.parse(readFixture(`espn/${ESPN_ROTO}/league.json`));
  const ids = j.teams.map(t => t.id); // 1..10
  const totals = Object.fromEntries(ids.map(k => [k, {
    0: k === 2 ? 960 : k === 6 ? 975 : 900 + 25 * k, // PTS: Team 3 (975) tied with Team 6, 25 behind Team 4, 15 ahead of Team 2
    6: 500 - 10 * k, // REB: Team 3 third, 10 behind Team 2 and 10 ahead of Team 4
    1: k === 3 ? 60 : 50, // BLK: Team 3 alone on top, 10 ahead of the other nine
    13: 350 + k, 14: 750, // FG: higher teams shoot better, a make (.001) apart
    15: 150, 16: 200, // FT: all .750
    2: 0, 3: 0, 17: 0, // STL, AST, 3PM: no one yet
    42: 100 + k, // games played
  }]));
  const value = (k, sid) => (sid === 19 ? totals[k][13] / totals[k][14] : sid === 20 ? totals[k][15] / totals[k][16] : totals[k][sid]);
  const points = {};
  for (const sid of [0, 1, 2, 3, 6, 17, 19, 20]) {
    for (const k of ids) {
      const better = ids.filter(x => value(x, sid) > value(k, sid)).length, tied = ids.filter(x => value(x, sid) === value(k, sid)).length;
      (points[k] = points[k] || {})[sid] = ids.length - better - (tied - 1) / 2; // (tied teams share their places' points)
    }
  }
  for (const t of j.teams) {
    t.valuesByStat = { ...totals[t.id], 19: value(t.id, 19), 20: value(t.id, 20) };
    t.pointsByStat = points[t.id];
    t.points = Object.values(points[t.id]).reduce((a, b) => a + b, 0);
  }
  return j;
}

// A page with the roto league loaded from the made-up season, as your team (its own page: the league stays out of other tests)
async function rotoApp() {
  const a = loadApp();
  await a.ready();
  const body = JSON.stringify(rotoSeason()), realFetch = a.fetch;
  a.fetch = (url, init) => (String(url).includes(`/leagues/${ESPN_ROTO}?`) ? Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) }) : realFetch(url, init));
  await a.loadBoxes();
  const L = await a.useLeague(ESPN_ROTO);
  const side = a.fxTeamSide('3');
  Object.assign(a.get('state'), { fxTeam: '3', players: side.players, il: side.il, lineup: side.lineup, teamName: side.name });
  return { a, L };
}

test("ESPN roto: the standings are ESPN's points by category, ties sharing, with each team's season totals and games limit", async () => {
  const { a, L } = await rotoApp();
  assert.ok(a.isRoto() && L.scoring === 'ROTO');
  assert.deepEqual([L.periods.length, Object.keys(L.matchups).length], [0, 0], 'no weekly matchups');
  assert.deepEqual({ ...L.roto }, { gpMax: 680, gpSpot: 68, start: '2026-11-19', end: a.addDays('2026-11-19', 143) }, '7 spots of 68 and three Util spots sharing 204; ESPN days 31 to 174');
  const me = L.standings.find(r => r.id === '3');
  assert.equal(me.pts, 46.5, 'PTS 3.5 (tied 7th), REB 8, BLK 10, FG% 3, and 5.5 in each category no one leads');
  assert.deepEqual({ ...me.cats }, { fgPct: 3, ftPct: 5.5, tpm: 5.5, pts: 3.5, reb: 8, ast: 5.5, stl: 5.5, blk: 10 });
  assert.equal(me.tot.fgm, 353);
  assert.equal(me.tot.gp1, 103);
  // ranked by points, best first; a tie shares the better rank
  assert.ok(L.standings.every((r, i) => !i || L.standings[i - 1].pts >= r.pts));
  assert.ok(L.standings.every(r => r.rank === 1 + L.standings.filter(x => x.pts > r.pts).length));

  // where you stand: the nearest teams above and below, every team at that gap
  const at = key => a.rotoStanding('3').find(x => x.c.key === key);
  const near = x => x && [x.gap, [...x.ids].sort((p, q) => p - q)]; // (they come best placed first: the one the table names)
  assert.deepEqual([near(at('pts').above), near(at('pts').below)], [[25, ['4']], [15, ['2']]], 'the team tied with you is neither');
  assert.deepEqual([near(at('reb').above), near(at('reb').below)], [[10, ['2']], [10, ['4']]]);
  assert.deepEqual([at('blk').above, near(at('blk').below)], [null, [10, ['1', '2', '4', '5', '6', '7', '8', '9', '10']]], 'first: no one to pass');
  assert.ok(Math.abs(at('fgPct').v - 353 / 750) < 1e-12 && Math.abs(at('fgPct').above.gap - 1 / 750) < 1e-12, 'a percentage from makes and attempts');
  assert.deepEqual([at('ftPct').above, at('ftPct').below, at('stl').above], [null, null, null], 'everyone tied');
});

test('ESPN roto: Standings, the Matchup tab, Plan Ahead and a team card, all without an opponent; no Recap', async () => {
  const { a } = await rotoApp();
  const standings = a.viewStandings();
  assert.ok(standings.includes('Roto standings') && standings.includes('<b>46.5</b>'));
  assert.ok(!/<th class="num">W<\/th>|Win %/.test(standings), 'no win-loss record');
  assert.ok(!standings.includes('Season totals'), "ESPN's totals are the table");
  assert.ok(!standings.includes('No games counted yet'));

  const m = a.dashMatchupCard();
  assert.ok(m.includes('To pass') && m.includes('Lead'), 'where you stand, by category');
  assert.ok(m.includes('<b>103</b> of 680 games'), 'your games against the limit');
  assert.ok(m.includes('This week') && !m.includes('This period'), 'a roto week is the calendar\'s');
  assert.ok(m.includes('mu-rows solo') && !m.includes('No opponent this week'));
  assert.ok(/<b>10<\/b><span class="rt-who">.*?<span class="muted" title="[^"]*">\+8<\/span><\/span>/.test(m), 'BLK: 10 ahead of nine teams, the first named');

  const week = a.viewWeek();
  assert.ok(week.includes('Season outlook') && /Projected <b>\d+(st|nd|rd|th)<\/b> of 10/.test(week), "the season's outlook where an opponent would be");
  assert.ok(!week.includes('Load your opponent') && !week.includes('>Opponent<') && !week.includes('compare against'), 'no opponent to load or pick');
  assert.ok(/<div class="card rt-outlook"><div class="sb-week solo"><div class="wk-nav">.*?class="wk-pick"><span>(This|Next) week<\/span>/s.test(week), "no scoreboard: the week's picker heads the outlook card");

  const title = a.teamCardTitle('4');
  assert.ok(title.includes('roto points') && !/This week vs|No matchup this week/.test(title));
  assert.ok(!a.teamCardHtml('4').includes('Compare on Plan Ahead'));
  // a team's card: its real standing first (totals, points, the teams either side), then its roster's averages, said not to be the standings
  const card = a.teamCardHtml('4');
  assert.ok(card.indexOf('<h3 class="sub" style="margin-top:0">Standings') < card.indexOf('Roster by category') && card.includes('not the standings'));
  assert.ok(card.includes('<th class="num">Total</th>') && !card.includes('<th class="num">You</th>'), "another team's: its total, not yours");
  assert.ok(a.teamCardHtml('3').includes('<th class="num">You</th>'));
  // the Matchup head says the games pace plainly: when the limit runs out, else the games on pace for
  const o = a.rotoOutlook().get('3');
  assert.ok(m.includes(o.rest.full ? `runs out ~${a.fmtMonthDay(o.rest.full)}` : `on pace for ${a.fmt(103 + o.rest.wanted, 0)}`), 'the pace beside the games');
  assert.ok(!m.includes('% of the season</span>'), 'the season played moves to the tip');
  assert.ok(!a.tabList().some(([k]) => k === 'recap'), 'no weekly matchups to recap');
  assert.ok(!a.tabList().some(([k]) => k === 'awards'), "no Awards tab where every day's lineups aren't read (ESPN)");
  assert.ok(standings.includes('<span class="rt-tot">1,150</span>'), "a season's count with its thousands comma (Team 10's PTS)");
  // each category shaded by its points: you (Team 3) alone first in BLK, green over your row's orange; everyone tied in FT%, plain
  const myRow = standings.split('<tr class="me-row">')[1].split('</tr>')[0], cellOf = label => myRow.match(new RegExp(`<td class="num rt-c" style="([^"]*)" title="${label}:`))[1];
  assert.match(cellOf('BLK'), /var\(--good\) 40%, var\(--accent-soft\)/);
  assert.equal(cellOf('FT%'), '');
  assert.match(cellOf('FG%'), /--bad/, '3 points of 10: on the red side');
  assert.ok(/<table class="rt-table rt-board">/.test(standings) && standings.includes('<td class="num rt-rk">'), 'the rank and team stay put as the table scrolls on a phone');
  assert.ok(a.INFO.roto, 'the (i) explains roto');
});

test('ESPN roto: no one has played yet, so every team is tied', async () => {
  const L = await app.useLeague(ESPN_ROTO); // (the saved league as ESPN sent it, before its first night)
  try {
    assert.ok(L.standings.every(r => r.pts === 44 && r.rank === 1), '5.5 in each of 8 categories');
    assert.ok(app.viewStandings().includes('No games counted yet, so every team is tied.'));
    assert.ok(app.rotoStanding(L.teams[0].id).every(x => !x.above && !x.below));
  } finally { await app.useLeague(ESPN); }
  assert.ok(!app.isRoto(), 'a head-to-head league is not roto');
  assert.ok(app.viewStandings().includes('<th class="num">W</th>'), 'and keeps its win-loss standings');
});

test("ESPN roto: a player's value is the roto points his game adds over the season", async () => {
  const { a, L } = await rotoApp();
  const W = a.winWeights(), BASE = a.get('BASE'), c = a.scoreCats().find(x => x.key === 'pts');
  // a team over 680 starter games spreads across 10 teams; a team passes (10 − 1) ÷ (2√π × that spread) of them per point
  const spread = Math.sqrt(680 * 680 / 10 * BASE.pts[1] ** 2 + 680 * a.gameSd('pts', BASE.pts[0]) ** 2);
  assert.ok(Math.abs(W.pts.per - 2 * Math.sqrt(Math.PI) * spread / 9) < 1e-9, 'standings gain points from the league\'s own size and games limit');
  assert.ok(Math.abs(a.rotoSpread(c, 680, 1) - spread) < 1e-9);
  const star = a.sortDesc(a.nbaPlayers().filter(p => p.gp > 2), p => a.value(p))[0];
  const z = a.catWins(star);
  assert.ok(Math.abs(z.pts - a.statVal(star, 'pts') / W.pts.per) < 1e-12, 'his points over the points one place takes');
  assert.ok(Math.abs(a.value(star) - Object.values(z).reduce((s, x) => s + x, 0)) < 1e-12);
  assert.ok(between(a.value(star), 0.1, 0.6), `the best game is a fraction of a roto point: ${a.value(star)}`);
  // a season of more games makes each one worth less
  const was = L.roto.gpMax;
  try {
    L.roto = { ...L.roto, gpMax: 2 * was };
    assert.ok(a.winWeights().pts.per > 1.9 * W.pts.per, 'twice the games: each worth about half');
  } finally { L.roto = { ...L.roto, gpMax: was }; }
});

test("ESPN roto: the projected finish adds each roster's games to come to the totals so far, within the games limit", async () => {
  const { a, L } = await rotoApp();
  const O = a.rotoOutlook(), n = 10, cats = a.scoreCats().filter(c => !c.fp);
  assert.equal(O.size, n);
  const all = [...O.values()];
  // every category hands out 1 + 2 + ... + 10 points, so they add up to that whatever the chances
  for (const c of cats) assert.ok(Math.abs(all.reduce((s, t) => s + t.pts[c.key], 0) - n * (n + 1) / 2) < 1e-9, c.key);
  assert.ok(all.every(t => cats.every(c => between(t.pts[c.key], 1, n))));
  assert.ok(all.every(t => t.rank === 1 + all.filter(u => u.total > t.total + 1e-9).length));
  for (const r of L.standings) {
    const t = O.get(r.id);
    assert.ok(t.fin.pts >= r.tot.pts && t.fin.gp1 === r.tot.gp1 + t.rest.games, 'totals so far, plus the rest');
    assert.ok(t.rest.games <= 680 - r.tot.gp1, 'never past the limit');
  }
  assert.ok(all.some(t => t.rest.full), 'teams that start everyone run out of games before the end');
  assert.strictEqual(a.rotoOutlook(), O, 'worked out once a day');

  // with 20 games left, a team keeps its 20 best, and says when it runs out
  const side = a.fxTeamSide('3'), val = new Map(side.players.map(p => [p.id, a.value(p)]));
  const rest = a.rotoRest(side.players, 680 - 20);
  assert.equal(rest.games, 20);
  assert.ok(rest.wanted > 20 && rest.full > '2026-11-19');
  assert.match(a.rotoPace(L.roto, 660, rest), /past the limit of 680: it runs out around/);
  // a player ruled out until after the season plays no part
  const star = a.sortDesc(side.players, p => val.get(p.id))[0];
  const hurt = side.players.map(p => (p === star ? { ...p, status: 'Out', inj: { status: 'Out', back: '2027-12-01' } } : p));
  assert.ok(a.rotoRest(hurt, 0).tot.pts < a.rotoRest(side.players, 0).tot.pts);

  // Standings' Projected view: best projected first, expected points to a tenth
  a.get('ui').rotoView = 'proj';
  const html = a.viewStandings();
  assert.ok(html.includes("At the season's end") && /data-v="proj" aria-pressed="true"/.test(html));
  const order = [...html.split('<tbody>')[1].matchAll(/<td class="rt-team"><b><button[^>]*?data-team="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, a.sortDesc(all, t => t.total).map(t => t.id), 'best projected first');
  assert.ok(html.includes(`<b>${a.fmt(all.find(t => t.rank === 1).total, 1)}</b>`), 'expected points to a tenth');
  a.get('ui').rotoView = 'now';
  assert.ok(a.dashMatchupCard().includes(`Projected ${a.ordinal(O.get('3').rank)} · ${a.fmt(O.get('3').total, 1)} pts`));
});

test("ESPN roto: a trade's For your team is its change to your projected roto points", async () => {
  const { a } = await rotoApp();
  const ui = a.get('ui'), mine = a.fxTeamSide('3').players, theirs = a.fxTeamSide('4').players;
  const byVal = list => a.sortDesc(list, p => a.value(p));
  // your best player for their worst
  const give = [byVal(mine)[0]], get = [byVal(theirs).pop()];
  ui.tradeTeam = '4';
  const Y = a.tradeForYou(give, get);
  assert.ok(Y.roto, 'a roto league works out the projected finish');
  assert.equal(Y.roto.before.total, a.rotoOutlook().get('3').total, 'before: the projection as it stands');
  assert.ok(Y.roto.after.total < Y.roto.before.total, `worse without your best player: ${Y.roto.before.total} -> ${Y.roto.after.total}`);
  const card = a.tradeCard({ from: '3', to: '4', give: give.map(p => String(p.nbaId)), get: get.map(p => String(p.nbaId)), givePicks: [], getPicks: [] }, Y);
  assert.ok(card.includes('projected roto points'));
  assert.ok(card.includes(`<b>${a.signed(Y.roto.after.total - Y.roto.before.total, 1)}</b>`), 'the change in all, in the Value column');
  assert.equal(a.rotoOutlook().get('3').total, Y.roto.before.total, "working out the deal doesn't change the league's own projection");
});

test('ESPN roto: a copy kept on the device from before the site read roto is read again', () => {
  const key = app.get('FX_CACHE_KEY'), was = app.localStorage.getItem(key);
  const keep = league => app.localStorage.setItem(key, JSON.stringify({ [ESPN_ROTO]: { at: Date.now(), res: { league, fxPlayers: {} } } }));
  try {
    keep({ id: ESPN_ROTO, scoring: 'ROTO' });
    assert.equal(app.cachedLeague(ESPN_ROTO), null);
    keep({ id: ESPN_ROTO, scoring: 'ROTO', roto: { gpMax: 680 } });
    assert.ok(app.cachedLeague(ESPN_ROTO), 'one with its roto standings is kept');
  } finally { if (was == null) app.localStorage.removeItem(key); else app.localStorage.setItem(key, was); }
});

test('ESPN roto: past the games limit, Plan Ahead\'s daily bench swaps start only the games worth one', async () => {
  const { a, L } = await rotoApp();
  const was = L.roto, memo = a.get('rotoMemo');
  try {
    // a limit the season's lineups run well past: the projection keeps the best games, and the weakest kept is the bar
    L.roto = { ...was, gpMax: 200 };
    memo.clear();
    const rest = a.rotoOutlook().get('3').rest;
    assert.ok(rest.wanted > rest.room && Number.isFinite(rest.bar), 'over the limit: a bar');
    assert.equal(a.rotoGameBar('3'), rest.bar);
    const ctx = a.weekContext(), today = a.todayIso();
    assert.equal(ctx.bar, rest.bar);
    const mine = new Map(ctx.mine.map(p => [p.id, p]));
    ctx.best.days.forEach(x => { if (x.date >= today) for (const id of x.active) assert.ok(a.value(mine.get(id)) >= ctx.bar, `${x.date}: a start under the bar`); });
    const all = a.projectSide(ctx.mine, ctx.dates, null);
    assert.ok(ctx.best.games < all.games, `fewer starts than every game the bench could add: ${ctx.best.games} of ${all.games}`);
    const week = a.viewWeek();
    assert.ok(week.includes("You're on pace to pass the league's limit of 200 games") && week.includes('sitting the rest saves their games'));
    // all of it used: no start counts
    L.roto = { ...was, gpMax: 100 };
    memo.clear();
    assert.equal(a.rotoGameBar('3'), Infinity);
    assert.ok(a.weekContext().best.days.filter(x => x.date >= today).every(x => !x.active.size));
    // a limit the season won't reach: every game helps, as before
    L.roto = { ...was, gpMax: 100000 };
    memo.clear();
    assert.equal(a.rotoGameBar('3'), null);
    assert.equal(a.weekContext().best.games, a.projectSide(a.weekContext().mine, a.weekContext().dates, null).games);
    assert.ok(!a.viewWeek().includes('on pace to pass'));
  } finally { L.roto = was; memo.clear(); }
});
