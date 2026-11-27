const { test, assert, sharedApp, CATS9, POINTS, ESPN, useTeam, onDay, answer, quiet } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('a trade proposal: both sides with photos and lines, compared per game, shared as a picture and a link that opens it for either team', async () => {
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui');
  const was = { fxTeam: state.fxTeam, players: state.players, il: state.il, lineup: state.lineup, teamName: state.teamName, leagueChosen: state.leagueChosen };
  const [t1, t2, t3] = app.fxPickable().map(t => t.id);
  const realToast = app.toast, toasts = [];
  app.toast = msg => toasts.push(msg);
  const loc = { search: app.location.search, hash: app.location.hash }, realHistory = app.history;
  app.history = { replaceState() { app.location.search = ''; } };
  try {
    useTeam(t1);
    const mine = state.players.filter(p => p.nbaId), theirs = app.fxTeamSide(t2).players.filter(p => p.nbaId);
    ui.tradeTeam = t2; ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeSeen = null;
    ui.tradeGive.add(mine[0].id);
    const oneSide = app.viewTrade();
    assert.ok(oneSide.includes('Trade proposal') && oneSide.includes('For your team') && !oneSide.includes('trade-share'), 'one side: what it does for you, nothing to share yet');
    theirs.slice(0, 2).forEach(p => ui.tradeGet.add(String(p.nbaId)));
    const T = app.tradeDeal();
    assert.deepEqual(JSON.parse(JSON.stringify(T)), { from: t1, to: t2, give: [String(mine[0].nbaId)], get: theirs.slice(0, 2).map(p => String(p.nbaId)), givePicks: [], getPicks: [] });
    const html = app.viewTrade();
    // under the pickers: who gets whom, each with his photo, his card and his average game in the league's categories
    assert.ok(html.indexOf('trade-grid') < html.indexOf('Trade proposal'));
    // the lists: each player's NBA team and positions, not his next game
    const lists = html.slice(0, html.indexOf('Trade proposal'));
    for (const p of [mine[0], theirs[0]]) assert.ok(lists.includes(`<div class="pmeta">${app.teamBtn(p.team)} · ${app.posTags(p.pos)}</div>`), p.name);
    assert.ok(mine[0].next && !/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (vs|@) /.test(lists.replace(/<[^>]*>/g, '')), 'no games');
    // an injured player: the status badge alone (O, D...), no note under his name
    const hurt = [...state.players, ...app.fxTeamSide(t2).players].find(p => p.inj && p.inj.note);
    assert.ok(hurt && lists.includes(app.statusBadge(hurt)) && !lists.includes('pmeta inj') && !lists.replace(/<[^>]*>/g, '').includes(app.esc(hurt.inj.note.slice(0, 30))), hurt && hurt.name); // (the note only in the badge's hover)
    const card = html.slice(html.indexOf('Trade proposal'));
    for (const p of [mine[0], ...theirs.slice(0, 2)]) assert.ok(card.includes(`data-photo="${p.nbaId}"`) && card.includes(`data-nba="${p.nbaId}"`), p.name);
    assert.ok(card.includes(`${app.teamLink(t1)} gets`) && card.includes(`${app.teamLink(t2)} gets`));
    const M = app.tradeModel(T);
    assert.deepEqual([...M.A.players.map(p => p.nbaId)].sort(), theirs.slice(0, 2).map(p => p.nbaId).sort());
    assert.deepEqual([...M.B.players.map(p => p.nbaId)], [mine[0].nbaId]);
    // (shooting with its makes and attempts a game, as the Recap's lines)
    assert.match(app.dealLine(M.B.players[0]).join(' · '), /^[\d.]+ MIN · [\d.]+\/[\d.]+ FG \((\.\d{3}|—)\) · [\d.]+\/[\d.]+ FT \((\.\d{3}|—)\) · [\d.]+ 3PM · [\d.]+ PTS · /);
    // side by side: value over a waiver player (under each side's total), then each category's per-game total, the better marked
    const wv = app.waiverValue(), over = ps => ps.reduce((t, p) => t + app.gameWorth(p) - wv, 0);
    assert.deepEqual([M.rows[0].sa, M.rows[0].sb], [app.fmtValue(over(M.A.players)), app.fmtValue(over(M.B.players))]);
    assert.ok(card.includes(`${M.rows[0].sa} over waiver`) && card.includes(`${M.rows[0].sb} over waiver`));
    assert.deepEqual([...M.rows.slice(1).map(r => r.key)], ['po', ...L.cats], 'playoff games, then the categories');
    const pts = M.rows.find(r => r.key === 'pts'), ptsOf = ps => ps.reduce((t, p) => t + p.pts, 0);
    assert.equal(pts.sa, app.fmt(ptsOf(M.A.players), 1));
    assert.equal(pts.lead, ptsOf(M.A.players) > ptsOf(M.B.players) ? 1 : -1);
    const to = M.rows.find(r => r.key === 'to');
    if (to.sa !== to.sb) assert.equal(to.lead, +to.sa < +to.sb ? 1 : -1, 'fewer turnovers is better');
    assert.match(card, /tp-lead pos-good/, 'your side: its better numbers green');
    // one table: each player with his games and games missed this season, each side's total (value added up, and over a
    // waiver player, which is what's marked), then what it does for your team. No ranks (the owner's ask)
    const rowOf = p => card.slice(card.indexOf(`data-nba="${p.nbaId}"`)).split('</tr>')[0];
    const asOf = app.isoDay(new Date(app.get('NBA').updated));
    for (const p of [...M.A.players, ...M.B.players]) {
      const gp = Math.round(app.statObj(app.nbaById.get(p.nbaId).cur).gp), missed = Math.max(0, app.get('NBA').teams[p.team].dates.filter(d => d < asOf).length - gp);
      assert.equal(app.gamesMissed(p), missed, p.name);
      assert.ok(rowOf(p).includes(`<td class="num">${gp}</td><td class="num${missed ? '' : ' muted'}">${missed}</td>`), p.name);
      assert.ok(rowOf(p).includes(`<b>${app.fmtValue(app.value(p))}</b>`));
    }
    assert.ok(!/>(Rank|Season)</.test(card.slice(card.indexOf('<thead>'), card.indexOf('</thead>'))) && !/>#\d+</.test(card), 'no ranks');
    // a side getting two players has a total row under them; one getting one player doesn't repeat his line: his row is its total
    assert.equal((card.match(/class="tp-tot"/g) || []).length, 1);
    assert.equal((card.match(/class="tp-one"/g) || []).length, 1);
    assert.ok(rowOf(M.B.players[0]).includes(`<div class="tp-vol">${app.fmtValue(M.B.value)} over waiver</div>`), 'the lone player carries his side\'s value over waiver');
    for (const S of [M.A, M.B]) assert.ok(card.includes(`<b>${app.fmtValue(S.sum)}</b><div class="tp-vol">${app.fmtValue(S.value)} over waiver</div>`), S.name);
    const you = card.slice(card.indexOf('For your team')).split('</tr>')[0], Y = app.tradeForYou([mine[0]], theirs.slice(0, 2));
    assert.equal(you.match(/<td class="num/g).length, L.cats.length + 2, 'the net playoff games, a change for each category, then the net value');
    assert.ok(you.includes(`<b>${app.fmtValue(Y.diff)}</b>`) && !you.includes('<b>+'), 'the net value, with no "+"');
    // numbers only: never who wins or whether it's fair (the owner's rule), in the card, its (i) or the share
    const info = app.get('INFO').trade, infoText = `${info[0]} ${info[1]()}`;
    const said = [html, infoText, app.tradeShare(L, T).text].join(' ');
    assert.ok(!/\b(win|wins|lose|loses|won|lost|fair|unfair|even|verdict|steal|ripoff|rip-off)\b/i.test(said.replace(/<[^>]*>/g, ' ')), 'no verdict');
    // the table carries no notes or labels it doesn't need (the owner's ask): what it all means is in the title's (i)
    assert.ok(html.includes(`<h2>Trade proposal ${app.infoBtn('trade')}</h2>`));
    const head = card.slice(card.indexOf('<thead>'), card.indexOf('</thead>'));
    assert.equal((head.match(/<tr>/g) || []).length, 1, 'one header row');
    assert.ok(!/>(Player|Per game|Total)</.test(head) && !card.includes('>Total<') && !card.includes('change per game'));
    assert.ok(!/class="[^"]*\b(tp-sum|tp-foot)\b/.test(card) && !card.includes('give +') && !card.includes('Ranks: this season'), 'no value line, no notes under the table');
    for (const said of ['GP</b> and <b>Missed', 'Playoff G', 'FG% and FT% count volume', 'over a waiver player', 'For your team', "Draft picks</b> aren't in the numbers"]) assert.ok(infoText.includes(said), said);
    // playoff games: each player's NBA team's games in the league's playoff periods (from L.playoffPeriod to the last),
    // each side's added up and the side with more marked, and your net
    const P = app.playoffDays(), poDays = L.periods.filter(q => q.n >= L.playoffPeriod).flatMap(q => app.periodDates(q));
    assert.ok(P && !P.started && L.playoffPeriod > 1 && [...P.days].join() === poDays.join(), 'the playoffs are all to come');
    assert.ok(P.from >= L.periods.find(q => q.n === L.playoffPeriod).start && P.to <= L.periods[L.periods.length - 1].end);
    const teamGames = p => app.get('NBA').teams[p.team].dates.filter(d => poDays.includes(d)).length;
    for (const p of [...M.A.players, ...M.B.players]) {
      assert.equal(app.playoffGames(p, P), teamGames(p), p.name);
      assert.match(rowOf(p), new RegExp(`<td class="num tp-po[^"]*">${teamGames(p)}</td>`), p.name);
    }
    const poOf = S => S.players.reduce((t, p) => t + teamGames(p), 0), po = M.rows.find(r => r.key === 'po');
    assert.deepEqual([po.sa, po.sb], [String(poOf(M.A)), String(poOf(M.B))]);
    assert.equal(po.lead, poOf(M.A) === poOf(M.B) ? 0 : poOf(M.A) > poOf(M.B) ? 1 : -1);
    const net = poOf(M.A) - poOf(M.B);
    assert.ok(you.includes(`>${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}</td>`), `net ${net}`);
    assert.ok(card.includes('Playoff G') && card.includes(`weeks ${L.playoffPeriod}–${L.periods[L.periods.length - 1].n}`));
    // once the playoffs are on, only the games left count; a league without playoffs has no column
    const savedPo = L.playoffPeriod;
    try {
      L.playoffPeriod = null;
      assert.equal(app.playoffDays(), null);
      assert.ok(!app.viewTrade().includes('Playoff G') && !app.tradeModel(T).rows.some(r => r.key === 'po'));
    } finally { L.playoffPeriod = savedPo; }
    const mid = app.addDays(L.periods.find(q => q.n === L.playoffPeriod).start, 3);
    await onDay(mid, () => {
      const Q = app.playoffDays();
      assert.ok(Q.started && Q.from === mid && [...Q.days].join() === poDays.filter(d => d >= mid).join(), 'the games still to play');
      assert.equal(app.playoffGames(M.A.players[0], Q), app.get('NBA').teams[M.A.players[0].team].dates.filter(d => d >= mid && poDays.includes(d)).length);
    });
    // FG% and FT% count volume: makes/attempts a game under each side's %, and the better side adds more makes over the
    // league average on its attempts, so a few shots at a high % lose to many at a good one
    const avg = app.get('BASE').fgPct[0], madeOver = p => (p.fgPct - avg) * p.fga;
    const fgRow = M.rows.find(r => r.key === 'fgPct');
    assert.equal(fgRow.va, `${app.fmt(M.A.tot.fgm, 1)}/${app.fmt(M.A.tot.fga, 1)}`);
    assert.ok(card.includes(`<div class="tp-vol">${fgRow.va}</div>`));
    const all = app.nbaPlayers().filter(p => p.gp >= 3);
    const few = all.find(p => p.fga > 0.5 && p.fga < 2 && p.fgPct > avg + 0.05);
    const many = [...all].filter(p => p.fgPct < few.fgPct - 0.01).sort((a, b) => madeOver(b) - madeOver(a))[0];
    assert.ok(madeOver(many) > madeOver(few) + 0.1, `${many.name} adds more makes than ${few.name}`);
    const V = app.tradeModel({ from: t1, to: t2, give: [String(few.nbaId)], get: [String(many.nbaId)] });
    const fg = V.rows.find(r => r.key === 'fgPct');
    assert.ok(+fg.sb > +fg.sa && fg.lead === 1, `${fg.sa} on volume beats ${fg.sb} on ${app.fmt(few.fga, 1)} shots`);
    assert.match(fg.ta, /^[\d.]+\/[\d.]+ a game: [\d.]+ more makes than the league's average of \.\d{3} would give$/);
    // shared: a picture (the same numbers), the text and a link
    const S = app.tradeShare(L, T);
    assert.ok(S.url.endsWith(`?league=${L.id}&from=${t1}&to=${t2}&give=${T.give.join(',')}&get=${T.get.join(',')}#trade`), S.url);
    assert.deepEqual([...S.text.split('\n\n')], [`🏀 ${L.name} · Trade proposal`, ...[[t1, M.A], [t2, M.B]].map(([t, X]) => `${app.fxTeamName(t)} gets: ${X.players.map(p => `${p.name} (${p.team})`).join(', ')}`)]);
    assert.match(S.file, /-trade\.png$/);
    const link = url => { app.location.search = url.slice(url.indexOf('?'), url.indexOf('#')); app.location.hash = '#trade'; };
    // before a team is picked, the landing page says what's waiting
    Object.assign(state, { fxTeam: null, leagueChosen: true });
    ui.afterPick = '#trade'; ui.tradeLink = T;
    assert.match(app.viewLanding(), /Pick your team to see the trade a league mate shared/);
    ui.afterPick = null; ui.tradeLink = null;
    // the team it was sent to: the deal in its own pickers, from its side
    useTeam(t2); ui.tradeGive.clear(); ui.tradeGet.clear();
    link(S.url); await app.openSharedLink();
    app.viewTrade();
    assert.equal(app.location.search, '', 'the link is tidied away');
    assert.equal(ui.tradeTeam, t1);
    assert.deepEqual([...ui.tradeGive].map(id => String(app.byId(id).nbaId)).sort(), [...T.get].sort());
    assert.deepEqual([...ui.tradeGet], [...T.give]);
    assert.ok(!ui.tradeSeen && !ui.tradeLink && !toasts.length);
    // anyone else in the league: the deal as it was sent, above their own pickers and neutral, until they close it
    useTeam(t3); ui.tradeGive.add(state.players[0].id);
    link(S.url); await app.openSharedLink();
    const seen = app.viewTrade();
    assert.ok(seen.indexOf('Trade proposal') < seen.indexOf('trade-grid') && seen.includes('A trade a league mate shared'));
    assert.ok(seen.includes('tp-lead') && !/tp-lead pos-/.test(seen), 'neither side is theirs');
    assert.equal(ui.tradeGive.size + ui.tradeGet.size, 0);
    assert.equal(app.tradeShare(L, app.tradeDeal()).url, S.url, 'shared on as it came');
    app.get('actions')['trade-seen-close']();
    assert.ok(!app.viewTrade().includes('Trade proposal'));
    // the sender, after one of its players has moved: the rest of the deal, and a toast says so
    useTeam(t1);
    const moved = theirs[theirs.length - 1].nbaId; // (on the other team, not the sender's)
    link(app.tradeUrl(L, { ...T, give: [...T.give, String(moved)] })); await app.openSharedLink();
    app.viewTrade();
    assert.deepEqual([[...ui.tradeGive].map(id => String(app.byId(id).nbaId)), [...ui.tradeGet]], [[...T.give], [...T.get]]);
    assert.deepEqual(toasts, ['A player in the shared trade is on another team now']);
    // a link whose teams aren't the league's is let go
    ui.tradeGive.clear(); ui.tradeGet.clear();
    link(app.tradeUrl(L, { ...T, to: 'nobody' })); await app.openSharedLink();
    app.viewTrade();
    assert.ok(!ui.tradeLink && !ui.tradeSeen && ui.tradeGive.size === 0);
  } finally {
    Object.assign(state, was);
    Object.assign(app.location, loc);
    app.history = realHistory; app.toast = realToast;
    ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeSeen = null; ui.tradeLink = null; ui.afterPick = null; ui.tab = 'dashboard';
    quiet(app);
  }
});

test('a points trade proposal compares fantasy points first', async () => {
  const L = await app.useLeague(POINTS);
  const [t1, t2] = app.fxPickable().map(t => t.id);
  const ids = t => app.fxTeamSide(t).players.filter(p => p.nbaId).slice(0, 2).map(p => String(p.nbaId));
  const M = app.tradeModel({ from: t1, to: t2, give: ids(t1), get: ids(t2) });
  assert.deepEqual([...M.rows.filter(r => r.key !== 'po').slice(0, 2).map(r => r.key)], ['value', 'fp']);
  assert.equal(M.rows[0].label, 'FP/G');
  const p = M.A.players[0];
  assert.equal(app.dealLine(p)[1], `${app.fmt(app.fantasyPoints(p), 1)} FP`);
  assert.equal(M.rows.find(r => r.key === 'fp').sa, app.fmt(M.A.players.reduce((t, x) => t + app.fantasyPoints(x), 0), 1));
  assert.deepEqual([...M.rows.filter(r => r.key !== 'po').slice(2).map(r => r.key)].sort(), Object.keys(L.points).sort());
  await app.useLeague(CATS9);
});

test("draft picks in trades: each team's future picks (read once, with the league), ticked on either side, in the proposal, its text and its link", async () => {
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui'), loads = app.get('picksLoads');
  const [t1, t2, t3] = app.fxPickable().map(t => t.id);
  const was = { fxTeam: state.fxTeam, players: state.players, il: state.il, lineup: state.lineup, teamName: state.teamName };
  const realFetch = app.fetch, asked = [], realToast = app.toast, realHistory = app.history, loc = { search: app.location.search, hash: app.location.hash };
  app.fetch = url => { if (String(url).includes('getDraftPicks')) asked.push(String(url)); return realFetch(url); };
  app.toast = () => {};
  app.history = { replaceState() { app.location.search = ''; } };
  const clear = () => { for (const s of ['tradeGive', 'tradeGet', 'tradeGivePicks', 'tradeGetPicks']) ui[s].clear(); ui.tradeSeen = null; };
  try {
    delete L.futurePicks;
    useTeam(t1); ui.tradeTeam = t2; clear();
    assert.ok(app.leaguePicks().loading && app.viewTrade().includes('Loading draft picks'));
    await loads.get(L.id);
    // Fantrax's list: next season's draft, every round of every team, none traded yet
    const list = app.leaguePicks().list;
    assert.equal(list.length, 110);
    assert.ok(list.every(p => p.year === 2027 && p.round >= 1 && p.round <= 11 && p.owner === p.from));
    app.viewTrade(); app.leaguePicks();
    assert.equal(asked.length, 1, 'read once');
    const kept = app.readLeagueCache()[L.id];
    assert.ok(!kept || kept.res.league.futurePicks.list.length === 110, 'kept with the league on the device');
    // under each list, the team's picks to tick; one traded for says whose it was
    const tradedFor = list.find(p => p.from === t3 && p.round === 3);
    tradedFor.owner = t1;
    let html = app.viewTrade();
    assert.equal((html.match(/data-change="trade-pick" data-side="give"/g) || []).length, 12);
    assert.equal((html.match(/data-change="trade-pick" data-side="get"/g) || []).length, 11);
    assert.ok(html.includes(`value="${app.pickKey(tradedFor)}"`) && html.includes(`<span class="pp-from">${app.esc(app.fxTeamName(t3))}</span>`));
    // a player and two picks for a player: the picks on the getting side's rows, said in the text and carried by the link
    const mine = state.players.filter(p => p.nbaId), theirs = app.fxTeamSide(t2).players.filter(p => p.nbaId);
    ui.tradeGive.add(mine[0].id); ui.tradeGet.add(String(theirs[0].nbaId));
    ui.tradeGivePicks.add(`2027:2:${t1}`); ui.tradeGivePicks.add(app.pickKey(tradedFor));
    const T = app.tradeDeal();
    assert.deepEqual([...T.givePicks], [`2027:2:${t1}`, `2027:3:${t3}`]);
    html = app.viewTrade();
    const card = html.slice(html.indexOf('Trade proposal'));
    assert.ok(card.includes('<b>2027 Round 2</b>') && card.includes('<b>2027 Round 3</b>') && card.includes(`originally ${app.teamLink(t3)}`));
    assert.ok(card.indexOf('<b>2027 Round 2</b>') > card.indexOf(`${app.teamLink(t2)} gets`), "on the side that gets them");
    assert.ok(!card.includes('Draft picks aren') && app.get('INFO').trade[1]().includes("Draft picks</b> aren't in the numbers"), 'said in the (i), not under the table');
    const S = app.tradeShare(L, T);
    assert.ok(S.text.endsWith(`, 2027 Round 2 pick, 2027 Round 3 pick (originally ${app.fxTeamName(t3)})`), S.text);
    assert.ok(S.url.includes(`&givepicks=${encodeURIComponent(`2027:2:${t1}`)},${encodeURIComponent(`2027:3:${t3}`)}#trade`), S.url);
    // picks alone against a player are a deal too
    ui.tradeGive.clear();
    assert.ok(app.tradeDeal() && app.viewTrade().includes('data-action="trade-share"'));
    // the team it went to gets the picks on its own get side
    useTeam(t2); clear();
    app.location.search = S.url.slice(S.url.indexOf('?'), S.url.indexOf('#')); app.location.hash = '#trade';
    await app.openSharedLink();
    app.viewTrade();
    assert.deepEqual([...ui.tradeGetPicks], [`2027:2:${t1}`, `2027:3:${t3}`]);
    assert.equal(ui.tradeGivePicks.size, 0);
    // a pick no longer the other team's drops out
    tradedFor.owner = t3;
    app.viewTrade();
    assert.deepEqual([...ui.tradeGetPicks], [`2027:2:${t1}`]);
    // the picks don't come: said, with Try again
    delete L.futurePicks;
    app.fetch = url => (String(url).includes('getDraftPicks') ? Promise.resolve({ ok: false, status: 404, headers: { get: () => null } }) : realFetch(url));
    app.leaguePicks();
    await loads.get(L.id);
    assert.match(app.leaguePicks().error, /404/);
    assert.ok(app.viewTrade().includes('data-action="trade-picks-retry"'));
    app.get('actions')['trade-picks-retry']();
    assert.ok(!L.futurePicks);
    app.fetch = realFetch;
    app.leaguePicks(); await loads.get(L.id);
  } finally {
    Object.assign(state, was); Object.assign(app.location, loc);
    app.fetch = realFetch; app.toast = realToast; app.history = realHistory;
    clear(); ui.tradeLink = null; ui.afterPick = null; ui.tab = 'dashboard';
    quiet(app);
  }
  // ESPN doesn't trade picks; on Sleeper only keeper and dynasty leagues do, and it lists just the traded ones
  assert.deepEqual([...app.leaguePicks({ id: '1', source: 'espn' }).list], []);
  assert.deepEqual([...app.leaguePicks({ id: '2', source: 'sleeper', pickInfo: { type: 0, rounds: 3, season: 2026, drafted: true } }).list], []);
  const SL = { id: '3', source: 'sleeper', teams: [{ id: '1' }, { id: '2' }], pickInfo: { type: 2, rounds: 2, season: 2026, drafted: true } };
  app.fetch = url => (String(url).includes('traded_picks') ? answer([{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }]) : realFetch(url));
  try {
    const dyn = await app.fetchSleeperPicks(SL);
    assert.equal(dyn.length, 3 * 2 * 2, 'a dynasty league: three seasons from the next draft');
    assert.deepEqual([...new Set(dyn.map(p => p.year))], [2027, 2028, 2029]);
    assert.deepEqual([...dyn.filter(p => p.owner !== p.from).map(p => JSON.stringify(p))], [JSON.stringify({ year: 2027, round: 1, from: '1', owner: '2' })]);
    const keeper = await app.fetchSleeperPicks({ ...SL, pickInfo: { ...SL.pickInfo, type: 1, drafted: false } });
    assert.deepEqual([...new Set(keeper.map(p => p.year))], [2026, 2027], "a keeper league before its draft: this season's, and a season a trade names");
  } finally { app.fetch = realFetch; }
});
