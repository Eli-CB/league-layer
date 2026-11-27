const { test, assert, sharedApp, CATS9, POINTS, ESPN, useTeam, between } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("a fantasy team's name opens its card: record, opponent, roster by spot, category ranks", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.standings[0].id);
  const other = L.teams.find(t => t.id !== L.standings[0].id);
  assert.match(app.viewStandings(), new RegExp(`data-action="team-card" data-team="${other.id}"`));
  const html = app.teamCardHtml(other.id);
  const title = app.teamCardTitle(other.id);
  assert.ok(title.includes(`<span class="dt-name">${app.esc(other.name)}</span>`), 'its name is the title');
  assert.ok(!html.includes(`<h2>${app.esc(other.name)}`), 'and not again in the card');
  assert.match(title, /<span class="dt-bio"><span class="dt-rec">\d+-\d+(-\d+)?<\/span> · \d+(st|nd|rd|th) of 10/, 'its record and standing in the title, beside or under its name');
  assert.doesNotMatch(html, /\d+(st|nd|rd|th) of 10/, 'and not in the card');
  const opp = app.fxOpponentFor(app.weekStartAt(0), other.id);
  if (opp) assert.ok(title.includes(`<span class="dt-vs">This week vs <span class="dt-rec">${app.teamLink(opp.id)}</span></span>`), "this week's opponent in the title too");
  assert.doesNotMatch(html, /This week vs|No matchup this week/, 'and not in the card');
  assert.doesNotMatch(html, /slot-label|>Roster<|>Starters<|>Bench</, 'no lineup spots or group labels');
  // an injured player: his letter by his name (the note on hover), not the report's words under it
  const hurt = L.teams.flatMap(t => app.fxTeamSide(t.id).players.map(p => [t.id, p])).find(([, p]) => p.inj && p.inj.note);
  assert.ok(hurt, 'an injured player to look at');
  const card = app.teamCardHtml(hurt[0]);
  assert.ok(card.includes(app.injBadge(hurt[1].inj, 'by-name')) && !card.includes('pmeta inj'), hurt[1].name);
  const vals = [...html.matchAll(/<td class="num pf-v">([^<]+)<\/td>/g)].map(m => +m[1].replace('−', '-'));
  assert.equal(vals.length, app.fxTeamSide(other.id).players.length);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), 'every player in one list, best value over the season first');
  assert.match(html, /Compare on Plan Ahead/);
  assert.match(html, /By category <span[^>]*>top \d+, against every team</, "each team's best players, as many as it starts");
  const side = app.fxTeamSide(other.id);
  assert.equal((html.slice(html.indexOf('tc-roster')).match(/data-action="player-detail"/g) || []).length, side.players.length, 'every player, each opening his card');
  // the full category strengths (once a card on Standings): a row a category with its rank, the league's teams on one line
  assert.equal((html.match(/<tr class="cs-row"/g) || []).length, app.scoreCats().length, 'a row for each category');
  assert.equal((html.match(/class="sdot this"/g) || []).length, app.scoreCats().length, "this team's dot in each row");
  assert.equal((html.match(/class="sdot me"/g) || []).length, app.scoreCats().length, 'and your own, in orange');
  assert.match(app.teamCardHtml(L.standings[0].id), /class="sdot this me"/, 'your own card: one dot, both');
  assert.doesNotMatch(app.viewStandings(), /Category strengths|cs-table/, 'no longer on Standings');
  // a past season's names stay plain
  app.get('ui').season = 'x';
  assert.equal(app.teamLink(other.id), app.esc(other.name));
  app.get('ui').season = null;
});

test("player profile: value per game (each game, each season's averages) and this season's games added up", async () => {
  await app.useLeague(CATS9);
  const raw = app.NBA.players.find(r => r.log && r.log.length && app.statObj(r.cur) && app.statObj(r.cur).gp >= 2);
  assert.ok(raw, 'a player with games this season');
  const els = {}, doc = app.document, before = doc.querySelector;
  doc.querySelector = sel => (els[sel] = els[sel] || { innerHTML: '', open: false, showModal() { this.open = true; } });
  try {
    app.showPlayerDetail(raw.id);
    const html = els['#detailBody'].innerHTML;
    const cur = app.statObj(raw.cur), per = app.lineValue(app.statLine(cur));
    assert.ok(Math.abs(per - app.lineValue(cur)) < 1e-9, 'makes and attempts as they are (season rows have no FG%)');
    const proj = app.nbaStats(raw);
    assert.ok(Math.abs(app.statLine(proj).fgm - proj.fgPct * proj.fga) < 1e-9, 'projections: makes from FG%');
    // (VAL, a value or a change in value with no "+": the owner's ask, Nov 23, 2026)
    assert.equal(app.fmtValue(0.51), '0.51');
    assert.equal(app.fmtValue(-0.02), '−0.02');
    assert.ok(html.includes('VAL per game') && html.includes(`>${app.fmtValue(per)}<`) && !html.includes('Value'), 'this season per game');
    assert.ok(html.includes(`${app.fmtValue(per * Math.round(cur.gp), 1)} <span class="muted small">in ${Math.round(cur.gp)} G</span>`), 'this season in all');
    // linear: an average line is worth the average of its games
    const games = raw.log.map(g => Object.fromEntries(app.NBA.logKeys.map((k, i) => [k, g[i]])));
    for (const o of games) assert.ok(html.includes(app.fmtValue(app.lineValue(o))), `${o.date}: its value`);
    const avg = Object.fromEntries(['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta'].map(k => [k, games.reduce((t, o) => t + o[k], 0) / games.length]));
    assert.ok(Math.abs(app.lineValue(avg) - games.reduce((t, o) => t + app.lineValue(o), 0) / games.length) < 1e-9);
    assert.ok(html.includes(`<th class="num">VAL</th></tr></thead><tbody><tr><td><b>${app.NBA.season}</b>`), 'a VAL column for each season, this one first');
    assert.ok(!html.includes('Projection') && !html.includes('(NBA:'), 'no projection row, no NBA position');
    // his rank among everyone this season: per game (regulars) and added up
    const R = app.valueRanks();
    const better = app.NBA.players.map(r => app.statObj(r.cur)).filter(s => s && s.gp && app.lineValue(app.statLine(s)) * Math.round(s.gp) > per * Math.round(cur.gp)).length;
    assert.equal(R.tot.get(raw.id), better + 1);
    assert.ok(html.includes(`>#${better + 1} of ${R.totN}</div>`), 'under Value this season');
    if (Math.round(cur.gp) >= R.minGp) assert.ok(html.includes(`>#${R.per.get(raw.id)} of ${R.perN}</div>`), 'under Value per game');
    assert.ok(!html.includes('Rank per game'), 'no separate tiles');
    // the title: his name, then his team, positions and flag (no jersey number, and his age is under the photo); beside the photo, whose he is in the league
    const title = els['#detailTitle'].innerHTML;
    assert.match(title, /^<span class="dt-name">[^<]+<\/span><span class="dt-bio">/);
    assert.match(title, / · <span class="dt-bit"><span class="pt /, 'each piece whole (a phone breaks the line between them)');
    assert.doesNotMatch(title, />#\d|>age \d/, 'no number, no age');
    assert.doesNotMatch(title, /<span class="dt-bio"> · /, 'no separator before the first piece');
    if (raw.exp) assert.ok(title.includes(raw.exp === 1 ? '>1 yr in league<' : `>${raw.exp} yrs in league<`));
    if (raw.nat) assert.ok(title.includes(`flagcdn.com/w20/${raw.nat.toLowerCase()}.png`));
    if (raw.born) assert.equal(html.match(/age \d\d/g).length, 1, 'his age once, under the photo');
    assert.ok(html.includes('<div class="pc-who"><p class="pc-owner">'), 'his fantasy team, or free agent, beside the photo');
    assert.ok(html.indexOf('pc-who') < html.indexOf('pc-tiles'), 'and the tiles after it');
    // Games: the whole season from the box scores, newest first, scrolling past five
    await app.loadBoxes();
    app.showPlayerDetail(raw.id);
    const full = els['#detailBody'].innerHTML;
    const box = app.get('BOX').byPlayer.get(raw.id) || [];
    assert.ok(full.includes(`Games <span class="muted small">${box.length}</span>`), `all ${box.length} games`);
    assert.ok(full.includes('pc-games-wrap'));
    const gamesTable = full.split('pc-games-wrap pc-log-wrap"><table class="pc-log">')[1];
    // each game in one cell, "20/11 @ DET" (day/month), green won and red lost (the owner's ask, Nov 23, 2026)
    const cells = [...gamesTable.matchAll(/<tr><td><span class="pc-game( pos-good| pos-bad|)"[^>]*>(\d\d)\/(\d\d) (vs|@) /g)];
    assert.equal(cells.length, box.length);
    const newest = [...box].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    cells.forEach((m, i) => {
      const [d, , margin] = newest[i];
      assert.equal(`${m[2]}/${m[3]}`, `${d.slice(8, 10)}/${d.slice(5, 7)}`, d);
      assert.equal(m[1], margin > 0 ? ' pos-good' : margin < 0 ? ' pos-bad' : '', `${d}: its result`);
    });
    assert.match(gamesTable, /data-key="date"[^>]*>Game ↓<\/th><th/, 'one Game column, newest first');
    assert.ok(!gamesTable.includes('>Matchup<'), 'no Matchup column');
    // PF, after TO (the owner's ask, Nov 23, 2026)
    const labels = app.cardStats(raw).map(c => c[0]);
    assert.equal(labels.indexOf('PF'), labels.indexOf('TO') + 1);
    // both tables on one column grid: the same stat columns after Season + GP / Game
    const cols = t => (t.match(/<colgroup>([\s\S]*?)<\/colgroup>/) || [])[1];
    const [avgCols, gameCols] = [full.split('Per-game averages')[1], gamesTable].map(cols);
    assert.equal(avgCols.replace('<col class="c-label"><col class="c-gp">', ''), gameCols.replace('<col class="c-game">', ''), 'the same stat columns in both');
    // sorted by a column: most points first, then the other way
    const ptsCol = app.cardStats(raw).findIndex(c => c[0] === 'PTS');
    const order = () => { const t = els['#detailBody'].innerHTML.split('pc-games-wrap pc-log-wrap"><table class="pc-log">')[1]; return [...t.matchAll(/<tr><td><span class="pc-game[\s\S]*?<\/tr>/g)].map(m => +[...m[0].matchAll(/<td class="num">([^<]*)<\/td>/g)][ptsCol][1]); };
    app.actions['card-sort']({ dataset: { key: String(ptsCol) } });
    const most = order();
    assert.deepEqual(most, [...most].sort((x, y) => y - x), 'most points first');
    app.actions['card-sort']({ dataset: { key: String(ptsCol) } });
    const least = order();
    assert.deepEqual(least, [...least].sort((x, y) => x - y), 'then fewest');
    app.showPlayerDetail(app.NBA.players.find(r => r.id !== raw.id && r.cur).id);
    assert.equal(app.get('ui').cardSort.key, 'date', "another player's card: newest first again");
  } finally { doc.querySelector = before; }
});

test('player card: who he is under the photo, and each category against an average rostered player beside it', async () => {
  const els = {}, doc = app.document, before = doc.querySelector;
  doc.querySelector = sel => (els[sel] = els[sel] || { innerHTML: '', open: false, showModal() { this.open = true; } });
  const raw = () => app.NBA.players.filter(r => app.statObj(r.cur) && app.statObj(r.cur).gp >= 3).sort((a, b) => app.statObj(b.cur).pts - app.statObj(a.cur).pts)[0];
  const card = id => { app.showPlayerDetail(id); return els['#detailBody'].innerHTML; };
  const bars = html => [...html.matchAll(/<span class="cp-k">([^<]+)<\/span><span class="cp-bar"><span class="cp-fill (up|down)"/g)].map(m => [m[1], m[2]]);
  const r = raw(), born = r.born;
  try {
    await app.useLeague(CATS9);
    Object.assign(r, { ht: 78, wt: 195, born: '2000-11-01', col: 'Kentucky', dft: [2018, 11] });
    let html = card(r.id);
    assert.match(html, /<div class="pc-side"><div class="pc-photo[\s\S]*?<\/div><p class="pc-bio"><span>6′6″ · 195 lb · age 25<\/span><span>Drafted 11th in 2018<\/span><\/p><\/div>/, 'height, weight, age (26 next week), draft; no college; each piece whole');
    for (const [pick, said] of [[1, '1st'], [2, '2nd'], [3, '3rd'], [9, '9th'], [12, '12th'], [21, '21st'], [52, '52nd']]) {
      r.dft = [2021, pick];
      assert.ok(card(r.id).includes(`<span>Drafted ${said} in 2021</span>`), said);
    }
    // the league's own categories, in its order; the top scorer is above average in points
    assert.deepEqual(bars(html).map(b => b[0]), Array.from(app.scoreCats(), c => c.label));
    assert.deepEqual(bars(html).find(b => b[0] === 'PTS'), ['PTS', 'up']);
    assert.ok(html.indexOf('pc-owner') < html.indexOf('pc-prof') && html.indexOf('pc-prof') < html.indexOf('pc-tiles'), 'under his fantasy team, before the tiles');
    Object.assign(r, { dft: 0, col: undefined, ht: undefined, wt: undefined, born: undefined });
    assert.match(card(r.id), /<p class="pc-bio"><span>Undrafted<\/span><\/p>/);
    delete r.dft;
    assert.ok(!card(r.id).includes('pc-side'), 'nothing known: the photo alone');
    // a points league: the fantasy points each scored stat gives him a game (no FP row)
    await app.useLeague(POINTS);
    html = card(r.id);
    assert.ok(!html.includes('cp-head'), 'no heading over the bars');
    assert.ok(bars(html).length >= 5 && !bars(html).some(b => b[0] === 'FP'), JSON.stringify(bars(html)));
    assert.match(html, /data-tip="[\d.-]+ FP a game from [^"]+; an average rostered player: [\d.-]+"/);
  } finally { doc.querySelector = before; for (const k of ['ht', 'wt', 'col', 'dft']) delete r[k]; if (born) r.born = born; else delete r.born; }
});

test('player card: a fantasy team with its lineup spot', async () => {
  const L = await app.useLeague(CATS9);
  const [tid, roster] = Object.entries(L.rosters).find(([, r]) => r.some(x => x.nba && x.st === 'INJURED_RESERVE'));
  const x = roster.find(y => y.nba && y.st === 'INJURED_RESERVE');
  const html = app.cardOwner(app.nbaById.get(x.nba));
  assert.ok(html.includes(app.esc(app.fxTeamName(tid))) && html.includes('badge bad">IR'), 'team and a red IR badge');
  const fa = app.NBA.players.find(r => r.fx && r.fx.st !== 'T' && !Object.values(L.rosters).flat().some(y => y.nba === r.id));
  if (fa) assert.match(app.cardOwner(fa), /badge fa">(Waivers|Free agent|Available)</);
});

test("the player card's games from ESPN's feed: the matchup, the result once it's over, live only while it's on", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const live = app.get('live'), raw = [...app.nbaById.values()].find(p => p.team), d = '2026-10-26';
  const was = { games: live.games, lines: live.lines };
  try {
    live.lines = new Map([[d, new Map([[raw.id, { pts: 20, min: 30, gp1: 1 }]])]]);
    live.games = [{ id: 'x', d, home: raw.team, away: 'ZZZ', hs: 101, as: 99, state: 'post' }];
    let g = app.cardGames(raw).find(o => o.date === d);
    assert.equal(g.matchup, 'vs ZZZ');
    assert.equal(g.wl, 'W');
    live.games = [{ id: 'x', d, home: 'ZZZ', away: raw.team, hs: 50, as: 40, state: 'in' }];
    g = app.cardGames(raw).find(o => o.date === d);
    assert.equal(g.matchup, '@ ZZZ · live');
    assert.equal(g.wl, '');
  } finally { Object.assign(live, was); }
});

test("player photos get their NBA team's logo behind them, and no ring in its colors", async () => {
  await app.ready();
  const raw = app.NBA.players.find(r => r.team === 'BOS');
  const html = app.headshot({ nbaId: raw.id, name: raw.name }, 40);
  assert.match(html, /class="hs hs-none"/, 'no image file: initials, no logo');
  assert.ok(!html.includes('--t1') && !/\btm\b/.test(html), html);
  assert.equal(Object.keys(app.TEAM_COLORS).length, 30);
  // with the image file in: the logo by a class (one rule a team, not the logo itself in every photo), the photo's spot on the sheet
  const was = app.get('IMG'), index = app.get('IMG_INDEX');
  try {
    app.set('IMG', { cols: 24, logos: { BOS: 'data:image/svg+xml;base64,AAAA' }, ids: [raw.id] });
    index.set(raw.id, 25);
    const shot = app.headshot({ nbaId: raw.id, name: raw.name }, 28);
    assert.match(shot, /class="hs lg lg-BOS"/, shot);
    assert.match(app.headshot({ name: 'No Photo', team: 'BOS' }, 28), /class="hs hs-none lg lg-BOS"/, 'no photo: the logo behind the initials');
    assert.ok(shot.includes('--hs-sz:672px auto;--hs-pos:-28px -28px') && !shot.includes('data:image'), shot);
    const other = app.NBA.players.find(r => r.team === 'LAL');
    assert.ok(!app.headshot({ nbaId: other.id, name: other.name }, 28).includes(' lg'), 'a team without a logo: no logo class');
    const style = { textContent: '' };
    const doc = app.document, get = doc.getElementById;
    doc.getElementById = () => style;
    app.logoRules(app.get('IMG').logos);
    doc.getElementById = get;
    assert.equal(style.textContent, '.hs.lg-BOS{--logo:url("data:image/svg+xml;base64,AAAA")}');
  } finally {
    app.set('IMG', was);
    index.delete(raw.id);
  }
});

test("team codes link to the Players tab filtered by that team; a player's photo knows whose it is", async () => {
  await app.useLeague(CATS9);
  const teams = Object.keys(app.NBA.teams), [a, b] = teams;
  const html = app.linkTeams(`Tue @ ${a} <span class="x">${b} 112</span> ${a}X ZZZ`);
  const links = [...html.matchAll(/data-team="([A-Z]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, [a, b], 'each known code in the text, nothing else');
  assert.ok(html.includes(`${a}X`) && html.includes('ZZZ') && html.includes('class="x"'), 'longer words, unknown codes and tags left as they are');
  const ui = app.get('ui');
  Object.assign(ui, { perfPos: ['C'], perfQ: 'smith', perfTeam: [] });
  app.actions['team-players']({ dataset: { team: a } });
  assert.deepEqual([...ui.perfTeam], [a]);
  assert.equal(ui.perfPos.length, 0, 'other filters off, so the whole team shows');
  assert.equal(ui.perfQ, '');
  assert.equal(ui.perfFiltOpen, true, 'and the panel open to say why the list is short');
  assert.equal(ui.perfRange, 'year', "over the season: a day could have no game of theirs");
  const raw = app.NBA.players.find(r => r.team === a);
  assert.match(app.headshot({ nbaId: raw.id, name: raw.name }, 28), new RegExp(`data-photo="${raw.id}"`));
  assert.doesNotMatch(app.headshot({ name: 'No One' }, 28), /data-photo/, 'no player id: nothing to open');
  Object.assign(ui, { perfTeam: [], perfFiltOpen: false });
});

test("a team's code opens its card in the popup: its schedule, then its players by value, each with whose he is", async () => {
  await app.useLeague(CATS9);
  const doc = app.document, realQuery = doc.querySelector, els = {};
  doc.querySelector = sel => (['#detailBody', '#detailTitle', '#detailDialog'].includes(sel) ? (els[sel] = els[sel] || { innerHTML: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } }) : realQuery(sel));
  try {
    const tri = app.NBA.players.find(r => r.team && r.cur).team;
    assert.match(app.teamBtn(tri), /data-action="sport-team"/, 'the link opens the card, not another tab');
    app.actions['sport-team']({ dataset: { team: tri } });
    assert.equal(els['#detailDialog'].open, true);
    assert.ok(els['#detailTitle'].innerHTML.includes(app.SPORT.teamNames[tri]), `its full name: ${app.SPORT.teamNames[tri]}`);
    const html = els['#detailBody'].innerHTML;
    assert.match(html, /Next game/);
    const ids = [...html.matchAll(/data-action="player-detail" data-nba="(\d+)"/g)].map(m => +m[1]);
    const team = app.nbaPlayers().filter(p => p.team === tri);
    assert.equal(new Set(ids).size, team.length, 'every player on the team');
    const vals = ids.map(id => app.seasonTotal(app.nbaById.get(id))).filter(t => t.gp).map(t => t.v);
    assert.deepEqual(vals, [...vals].sort((a, b) => b - a), 'by value over the season (a game or two can\'t top it), best first');
    const one = team.find(p => p.gp);
    assert.ok(Math.abs(app.seasonTotal(app.nbaById.get(one.nbaId)).v - app.value({ ...app.nbaStats(app.nbaById.get(one.nbaId), 'cur'), pos: one.pos }) * one.gp) < 1e-9, 'his average game this season times his games');
    assert.match(html, /class="pt pt-\w+ pc pc-/, 'positions in their lineup-spot colors');
    assert.match(html, new RegExp(`data-action="team-players" data-team="${tri}"`), 'the whole team on the Players tab, from the foot');
    assert.equal(Object.keys(app.SPORTS.nba.teamNames).length, 30);
  } finally { doc.querySelector = realQuery; }
});

test("a team's card has its record: its finals, then today's game once it's over (not a preseason one)", async () => {
  await app.useLeague(CATS9);
  await app.loadBoxes();
  const saved = app.get('BOX'), live = app.get('live'), was = live.games;
  const tri = 'PHI', dates = [...app.get('teamDates').get(tri)].sort();
  const game = (d, home, away, hs, as, last) => [`${d} ${home}`, `${d} ${away}`].map(k => [k, { home, away, hs, as, last }]);
  const doc = app.document, realQuery = doc.querySelector, els = {};
  doc.querySelector = sel => (['#detailBody', '#detailTitle', '#detailDialog'].includes(sel) ? (els[sel] = els[sel] || { innerHTML: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } }) : realQuery(sel));
  try {
    // the real season's box scores: a record for every team that has played
    const real = app.teamRecord(tri);
    assert.match(real, /^\d+-\d+$/, `W-L: ${real}`);
    const [w, l] = real.split('-').map(Number);
    assert.equal(w + l, [...saved.scores.keys()].filter(k => k.endsWith(` ${tri}`)).length, 'one result a game played');
    // made-up results: won at home, lost away, won by one
    app.set('BOX', { ...saved, scores: new Map([...game(dates[0], tri, 'BOS', 110, 100), ...game(dates[1], 'NYK', tri, 120, 99), ...game(dates[2], tri, 'MIA', 101, 100)]) });
    live.games = [];
    assert.equal(app.teamRecord(tri), '2-1');
    app.actions['sport-team']({ dataset: { team: tri } });
    assert.match(els['#detailTitle'].innerHTML, /<span class="dt-bio dt-team-rec"><span class="dt-rec"[^>]*>2-1<\/span><\/span><span class="dt-bio dt-team-rec dt-team-po"/, 'in the title, after its name');
    // then its games in each of the league's playoff periods, from its schedule
    const L = app.fxLeague(), ps = L.periods.filter(q => q.n >= L.playoffPeriod);
    const each = ps.map(q => app.periodDates(q).filter(d => dates.includes(d)).length);
    assert.ok(ps.length > 1 && each.every(n => n > 0), `the test league has playoffs: ${each}`);
    assert.match(els['#detailTitle'].innerHTML, new RegExp(`<span class="dt-bio dt-team-rec dt-team-po"[^>]*>Playoff Games: <span class="dt-rec">${each.join('-')}</span></span>$`), 'Playoff Games: one number a period');
    assert.doesNotMatch(els['#detailTitle'].innerHTML.replace(/<[^>]*>/g, ''), /\bPHI\b/, 'without its code: the full name says it');
    // its players' cards have them too, a tile after Games next period
    const player = app.NBA.players.find(r => r.team === tri);
    app.showPlayerDetail(player.id);
    const card = els['#detailBody'].innerHTML;
    assert.match(card, new RegExp(`<div class="k">Playoff games</div><div class="v">${each.join('-')}</div>`), "a player's card: his team's playoff games");
    assert.ok(card.indexOf('Games next period') < card.indexOf('Playoff games') && card.indexOf('Playoff games') < card.indexOf('per game</div>'), 'between the games tiles and the value tiles');
    // tonight's game counts once it's over; a preseason game (not on its schedule) never does
    live.games = [{ d: dates[3], home: 'ATL', away: tri, hs: 90, as: 95, state: 'in', period: 4 }, { d: '2026-10-05', home: tri, away: 'ORL', hs: 80, as: 120, state: 'post', period: 4 }];
    assert.equal(app.teamRecord(tri), '2-1', 'not while it is on');
    live.games[0].state = 'post';
    assert.equal(app.teamRecord(tri), '3-1');
    // a tie (football's) is a third number, only when there is one
    app.set('BOX', { ...saved, scores: new Map([...game(dates[0], tri, 'BOS', 20, 20)]) });
    live.games = [];
    assert.equal(app.teamRecord(tri), '0-0-1');
    // no games yet: nothing, rather than 0-0
    app.set('BOX', { ...saved, scores: new Map() });
    assert.equal(app.teamRecord(tri), '');
  } finally { app.set('BOX', saved); live.games = was; doc.querySelector = realQuery; }
});

test("the player card: how he came to his fantasy team", async () => {
  const L = await app.useLeague(CATS9);
  const [t1, t2] = L.teams.map(t => t.id);
  const pick = L.draft.picks.find(p => p[2] === t1 && p[3]);
  const keeper = (L.draft.keepers[t1] || [])[0];
  assert.ok(pick && keeper, 'a pick and a keeper to look at');
  const owner = entries => new Map(entries.map(([f, tid]) => [f, { tid, on: true }]));
  const weeks = [
    { n: 1, start: '2026-10-20T00:00:00', end: '2026-10-26T18:59:00', owner: owner([['pick', t1], ['keep', t1], ['traded', t2]]) },
    { n: 2, start: '2026-10-26T19:00:00', end: '2026-11-02T18:59:00', owner: owner([['pick', t1], ['keep', t1], ['traded', t1], ['added', t1]]) },
  ];
  const loads = app.get('rosterWeeksLoad'), was = loads[L.id];
  loads[L.id] = Object.assign(Promise.resolve(weeks), { done: weeks });
  try {
    const how = (nba, f) => app.cardHow(L, { id: nba }, t1, f);
    assert.equal(how(keeper, 'keep'), 'Keeper');
    assert.equal(how(pick[3], 'pick'), `Drafted · round ${pick[0]}, pick ${pick[1]}`);
    assert.equal(how(1, 'added'), 'Pickup · week 2');
    assert.equal(how(2, 'traded'), `Traded from ${app.fxTeamName(t2)} · week 2`);
    // the team he came from: a link to its card, on the card's line
    const out = {}, line = app.howBadge(app.cardHow(L, { id: 2 }, t1, 'traded', out), out.from);
    assert.equal(out.from, t2);
    assert.ok(line.includes(`from ${app.teamLink(t2)} · week 2`) && line.includes('data-action="team-card"'), line);
    assert.equal(how(3, 'new'), 'Pickup · this week', 'not on the latest weekly rosters yet');
  } finally { if (was) loads[L.id] = was; else delete loads[L.id]; }
  // without weekly rosters (ESPN): the draft, else added after it
  const E = await app.useLeague(ESPN);
  const ep = E.draft.picks.find(p => p[3]);
  assert.equal(app.cardHow(E, { id: ep[3] }, ep[2], 'x'), `Drafted · round ${ep[0]}, pick ${ep[1]}`);
  assert.equal(app.cardHow(E, { id: ep[3] }, E.teams.find(t => t.id !== ep[2]).id, 'x'), 'Added after the draft');
});
