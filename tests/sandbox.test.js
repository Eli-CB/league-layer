const { test, assert, sharedApp, loadApp, CATS9, ESPN, HOCKEY } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('the sandbox, as a first visit opens it: no league anywhere, the Players and Trends tabs among its own', async () => {
  await app.loadBoxes();
  const st = app.get('state'), ui = app.get('ui');
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  const was = { browse: st.browse, fxTeam: st.fxTeam, demo: st.demo, leagueChosen: st.leagueChosen };
  await app.useLeague(CATS9); // the daily file's own league stays loaded underneath
  try {
    st.fxTeam = undefined; st.demo = false; st.leagueChosen = false; // as on a first visit
    assert.ok(app.needsLanding(), 'no team: the landing page');
    assert.match(app.viewLanding(), /data-action="land-browse"/);
    app.actions['land-browse']();
    assert.ok(st.browse && !app.needsLanding());
    assert.equal(app.fxLeague(), null, "the site's league isn't this visitor's");
    assert.deepEqual([...app.tabList().map(t => t[0])], ['team', 'watch', 'players', 'trends', 'trade']);
    assert.ok(app.NBA.players.every(r => !r.fx), "nobody shows as free in someone else's league");
    const html = app.viewPlayers();
    assert.ok(!html.includes('browse-note') && /data-sport="nba">✓ Basketball/.test(app.sbMenus()), 'the sport and scoring in the head, no bar');
    assert.ok(!html.includes('perf-owner') && !html.includes('badge good'), 'no fantasy teams or free-agent badges');
    assert.ok(/data-nba="\d+"/.test(html), 'players listed');
    assert.equal(app.scoreCats().length, 9, 'a standard 9-category league');
    // Trends: through the latest saved day, with the same note, and no fantasy teams
    ui.tab = 'trends';
    const tr = app.viewTrends();
    assert.ok(tr.startsWith('<div class="card trends">'), 'Trends, with no bar above it');
    assert.ok(!tr.includes('perf-owner') && !tr.includes('Rostered') && !tr.includes('Waivers'), 'nobody rostered');
    // back out: the landing page again
    app.actions['browse-exit']();
    assert.ok(!st.browse && app.needsLanding());
  } finally {
    Object.assign(st, was);
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
    ui.tab = 'standings'; // no live box scores in the background
    const live = app.get('live');
    clearTimeout(live.timer); live.timer = null;
  }
});

test('the sandbox: a team of any players, marked on Players and Trends, up to 12 followed live, and trades for anyone', async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const st = a.get('state'), ui = a.get('ui');
  ui.tab = 'standings'; // (no live box scores in the background until a tab here wants them)
  assert.ok(a.needsLanding(), 'a first visit: the landing page');
  assert.match(a.viewLanding(), /data-action="land-browse">[^]*?<b>Try the sandbox<\/b>/);
  a.actions['land-browse']();
  assert.ok(st.browse && !a.needsLanding() && a.fxLeague() === null);
  assert.equal(a.location.hash, '#team', 'it opens on My team');
  assert.equal(a.myTeamId(), a.SB_ME);
  // My team, empty: the search and what it's for
  let team = a.viewSandboxTeam();
  assert.ok(!team.includes('browse-note'), 'no bar under the tabs');
  assert.match(a.sbMenus(), /<details class="tm sb-m" data-m="sport">[\s\S]*<span class="tm-name">Basketball<\/span>[\s\S]*data-m="scoring">[\s\S]*<span class="tm-name">9 categories<\/span>/, 'its sport and scoring as menus in the head');
  assert.match(team, /id="sbQ-team"[\s\S]*Build a team from any NBA players/);
  // a search: the best matches by value, each a button that adds him
  const best = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val), [p1, p2, p3, p4] = best;
  ui.sbQ.team = p1.name.slice(0, 5);
  team = a.viewSandboxTeam();
  assert.ok(team.includes(`data-action="sb-add" data-id="${p1.nbaId}"`), 'he matches');
  assert.ok((team.match(/class="sb-hit"/g) || []).length <= 8, 'eight matches at most');
  ui.sbQ.team = 'zzqqxx';
  assert.match(a.viewSandboxTeam(), /No NBA player matches “zzqqxx”/);
  for (const p of [p1, p2, p3]) a.actions['sb-add']({ dataset: { id: String(p.nbaId) } });
  assert.deepEqual([...a.sbState().roster], [p1.nbaId, p2.nbaId, p3.nbaId]);
  assert.equal(ui.sbQ.team, '', 'the search is cleared for the next name');
  assert.deepEqual(JSON.parse(a.localStorage.getItem('league-layer-v1')).sandbox.nba.roster, [...a.sbState().roster], 'kept on the device');
  a.actions['sb-add']({ dataset: { id: String(p1.nbaId) } });
  assert.equal(a.sbState().roster.length, 3, 'once each');
  team = a.viewSandboxTeam();
  for (const p of [p1, p2, p3]) assert.ok(team.includes(`data-action="sb-drop" data-id="${p.nbaId}"`), `${p.name}: on the team, with a ✕`);
  assert.match(team, /<tfoot><tr class="sb-tot"><td class="pf-name"><b>My team<\/b>/, 'the team a game');
  ui.sbQ.team = p1.name;
  assert.ok(a.viewSandboxTeam().includes(`${p1.name} is already on My team.`), "searching for someone already on it says so");
  ui.sbQ.team = '';
  // an injury is its short badge (the news on hover and on his card), not the whole note under his name
  const hurt = a.nbaPlayers().find(p => p.inj && p.inj.note && !best.slice(0, 4).includes(p));
  a.actions['sb-add']({ dataset: { id: String(hurt.nbaId) } });
  const hurtRow = a.viewSandboxTeam().split('<tr>').find(r => r.includes(`data-id="${hurt.nbaId}"`));
  assert.ok(hurtRow.includes('class="badge inj') && !hurtRow.includes('pmeta inj'), 'the badge alone');
  a.actions['sb-drop']({ dataset: { id: String(hurt.nbaId) } });
  // the Players tab: My team's rows marked, its filters My team and everyone else (no other teams, no lineups)
  Object.assign(ui, { perfRange: 'year', perfPer: true, perfFiltOpen: true });
  const players = a.viewPlayers();
  assert.ok(players.includes('<tr class="pf-me">') && /<span class="perf-owner mine"[^>]*><span class="team-mine">My team<\/span><\/span>/.test(players), 'his row says My team, in orange');
  assert.match(players, /data-key="me"[^>]*>My team<[\s\S]*data-key="fa"[^>]*>Everyone else</);
  assert.ok(!players.includes('perfOthers') && !players.includes('data-action="perf-spot"'), 'no other teams, no lineups');
  // each row's + adds him to My team; ✓ (he's on it) takes him off
  assert.ok(players.includes(`data-action="sb-drop" data-id="${p1.nbaId}" aria-pressed="true"`) && players.includes(`data-action="sb-add" data-id="${p4.nbaId}" aria-pressed="false"`));
  a.actions['sb-add']({ dataset: { id: String(p4.nbaId) } });
  assert.ok(a.sbState().roster.includes(p4.nbaId) && a.viewPlayers().includes(`data-action="sb-drop" data-id="${p4.nbaId}"`), 'added from the Players tab');
  a.actions['sb-drop']({ dataset: { id: String(p4.nbaId) } });
  assert.ok(!a.sbState().roster.includes(p4.nbaId));
  ui.perfWhose = { me: true, opp: true, other: true, fa: false };
  const mineOnly = a.viewPlayers();
  assert.ok(mineOnly.includes(`data-nba="${p1.nbaId}"`) && !mineOnly.includes(`data-nba="${p4.nbaId}"`), 'My team alone');
  a.actions['perf-whose']({ dataset: { key: 'me' } });
  assert.equal(ui.perfWhose.me, true, 'never nobody (the opponent and other teams are no one here)');
  Object.assign(ui, { perfWhose: { me: true, opp: true, other: true, fa: true }, perfFiltOpen: false, perfRange: null, perfPer: false });
  // a player's card: on My team or not, followed live or not, each a button
  assert.match(a.cardOwner(a.nbaById.get(p1.nbaId)), /team-mine"><b>My team<\/b>[\s\S]*data-action="sb-drop"[\s\S]*data-action="sb-watch"/);
  assert.match(a.cardOwner(a.nbaById.get(p4.nbaId)), /data-action="sb-add"[^>]*>\+ Add to my team/);
  // Live: up to 12, My team's in one tap
  a.actions['sb-watch-team']();
  assert.deepEqual([...a.sbState().watch], [p1.nbaId, p2.nbaId, p3.nbaId], 'My team, best first');
  for (const p of best.slice(3, 20)) a.actions['sb-watch']({ dataset: { id: String(p.nbaId) } });
  assert.equal(a.sbState().watch.length, a.WATCH_MAX, 'twelve at most');
  ui.tab = 'watch';
  assert.ok(a.liveTab(), 'the live scores follow them');
  const watch = a.viewSandboxWatch();
  assert.equal((watch.match(/class="mu-p sb-w/g) || []).length, 12);
  assert.ok(watch.includes(`data-action="sb-unwatch" data-id="${p4.nbaId}"`) && !watch.includes('id="sbQ-watch"'), 'each with a ✕; no search while full');
  assert.ok(watch.includes('12 of 12</span><span class="badge sb-max"') && !/Following 12|room for/.test(watch), 'full: a Max badge by the count, no sentence');
  assert.ok(!watch.includes('>Mine<') && watch.includes('data-action="dash-full" aria-pressed="false"'), 'no Mine badge (the owner\'s ask); the full-screen button');
  // full screen, as the Matchup tab's: the players alone, no count, search or ✕
  ui.dashFull = true;
  try {
    const fs = a.viewSandboxWatch();
    assert.ok(fs.includes('class="card sb-watch-card mu-card full"') && fs.includes('aria-pressed="true"'));
    assert.equal((fs.match(/class="mu-p sb-w/g) || []).length, 12);
    assert.ok(!fs.includes('data-action="sb-unwatch"') && !fs.includes('12 of 12') && !fs.includes('class="info-btn"'));
  } finally { ui.dashFull = false; }
  // the week (Monday to Sunday) so far: each player's games played and left, his line added up
  ui.watchRange = 'week';
  const wk = a.viewSandboxWatch();
  assert.ok(wk.includes('data-range="week" aria-pressed="true"') && wk.includes('data-range="today"'), 'Today, Yesterday, Week');
  assert.equal((wk.match(/<div class="mu-game">\d+ G/g) || []).length, 12, 'each player: his games this week');
  ui.watchRange = null;
  a.actions['sb-unwatch']({ dataset: { id: String(p4.nbaId) } });
  assert.ok(!a.sbState().watch.includes(p4.nbaId) && a.viewSandboxWatch().includes('id="sbQ-watch"'));
  // Trades: My team's players for anyone, found by name
  ui.tab = 'trade';
  assert.match(a.viewSandboxTrade(), /Pick who you'd give and who you'd get/);
  ui.sbGive.add(p2.nbaId);
  ui.sbQ.get = p4.name.slice(0, 6);
  assert.ok(a.viewSandboxTrade().includes(`data-action="sb-get" data-id="${p4.nbaId}"`), 'anyone, found by name');
  a.actions['sb-get']({ dataset: { id: String(p4.nbaId) } });
  a.actions['sb-get']({ dataset: { id: String(p1.nbaId) } });
  assert.deepEqual([...ui.sbGet], [p4.nbaId], 'not one of your own');
  const trade = a.viewSandboxTrade();
  assert.match(trade, /Trade proposal[\s\S]*<span class="team-mine">My team<\/span> gets[\s\S]*Other team gets[\s\S]*For your team/);
  assert.ok(!/you'd need to drop/.test(trade), 'no roster limit');
  assert.ok(trade.includes('data-action="trade-share"'), "shared as a league's");
  const S = a.sbTradeShare();
  assert.ok(S.text.includes('League Layer · Trade proposal') && S.text.includes(`My team gets: ${p4.name}`) && S.text.includes(`Other team gets: ${p2.name}`), S.text);
  assert.ok(!S.url.includes('league='), 'no league link');
  // taking a player off My team takes him out of the deal too
  a.actions['sb-drop']({ dataset: { id: String(p2.nbaId) } });
  assert.ok(!ui.sbGive.has(p2.nbaId) && !a.sbState().roster.includes(p2.nbaId));
  // a saved copy that's been tampered with: numbers only, each once, as many as fit
  const n = a.normalize({ ...st, sandbox: { roster: [1, 1, 'x', 2, ...Array.from({ length: 40 }, (x, i) => 100 + i)], watch: 'no' } });
  assert.deepEqual([...n.sandbox.nba.roster.slice(0, 3)], [1, 2, 100]);
  assert.equal(n.sandbox.nba.roster.length, a.SANDBOX_MAX);
  assert.deepEqual([...n.sandbox.nba.watch], []);
  // Trends: the sandbox's, no league lists
  ui.tab = 'trends';
  const tr = a.viewTrends();
  assert.ok(tr.startsWith('<div class="card trends">'), 'Trends, no bar above it');
  assert.ok(!tr.includes('<span>Rostered</span>') && !tr.includes('<span>Waivers</span>'), 'no league lists');
  // out of it: no league to go back to, so the landing page; My team stays for next time
  ui.tab = 'standings';
  await a.actions['browse-exit']();
  assert.ok(!st.browse && a.needsLanding());
  assert.equal(a.sbState().roster.length, 2);
  // and back in, the address still on My team (no hash change to route it): My team, not a blank page
  ui.tab = 'standings';
  a.actions['land-browse']();
  assert.equal(ui.tab, 'team');
  ui.tab = 'standings';
  const live = a.get('live');
  clearTimeout(live.timer); live.timer = null;
});

test("the sandbox's scoring and sport: categories, a site's standard points or your own, basketball or hockey, each sport its own team", async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const st = a.get('state'), ui = a.get('ui'), near = (x, y) => Math.abs(x - y) < 1e-6;
  ui.tab = 'standings';
  a.actions['land-browse']();
  const best = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val);
  for (const p of best.slice(0, 3)) a.actions['sb-add']({ dataset: { id: String(p.nbaId) } });
  // the bar: the sport and the scoring
  assert.match(a.sbMenus(), /data-action="sb-sport-pick" data-sport="nba">✓ Basketball<[\s\S]*data-sport="nhl">Hockey<[\s\S]*data-action="sb-scoring-pick" data-k="cats">✓ 9 categories<[\s\S]*data-k="espn">ESPN points<[\s\S]*data-k="yahoo">Yahoo points<[\s\S]*data-k="custom">Your own points</);
  assert.ok(!a.isPoints() && !a.sbMenus().includes('Edit your points'));
  // the menu's own choices do the same (and keep the menus shut after)
  a.actions['sb-scoring-pick']({ dataset: { k: 'yahoo' } });
  assert.ok(a.isPoints() && a.sbMenus().includes('<span class="tm-name">Yahoo points</span>'));
  a.actions['sb-scoring-pick']({ dataset: { k: 'cats' } });
  assert.ok(!a.isPoints());
  const id = best[0].nbaId, me = () => a.nbaPlayers().find(p => p.nbaId === id), v = k => a.statVal(me(), k);
  // ESPN's default points (since 2020): each player's value in fantasy points, and the scored stats as the columns
  assert.equal(a.sbSetScoring('espn'), true);
  assert.ok(a.isPoints() && a.valueLabel() === 'FP/G');
  assert.ok(near(me().val, v('pts') + v('tpm') + 2 * v('fgm') - v('fga') + v('ftm') - v('fta') + v('reb') + 2 * v('ast') + 4 * v('stl') + 4 * v('blk') - 2 * v('to')), 'ESPN');
  assert.deepEqual([...a.scoreCats().map(c => c.key).sort()], ['ast', 'blk', 'fga', 'fgm', 'fp', 'fta', 'ftm', 'pts', 'reb', 'stl', 'to', 'tpm']);
  assert.match(a.viewSandboxTeam(), /title="Fantasy points[^"]*">FP\/G</);
  a.sbSetScoring('yahoo');
  assert.ok(near(me().val, v('pts') + 1.2 * v('reb') + 1.5 * v('ast') + 3 * v('stl') + 3 * v('blk') - v('to')), 'Yahoo');
  // your own: the editor opens first (nothing changes until it's saved), then those points
  assert.equal(a.sbSetScoring('custom'), false);
  assert.equal(a.sbState().scoring, 'yahoo');
  const form = boxes => ({ querySelectorAll: () => Object.entries(boxes).map(([name, value]) => ({ name, value })) });
  a.forms['sb-points'](form({ pts: '', reb: '0', ast: 'x' }));
  assert.equal(a.sbState().scoring, 'yahoo', 'no points given: nothing changes');
  a.forms['sb-points'](form({ pts: '2', reb: '', ast: '-1', stl: '0' }));
  assert.deepEqual({ ...a.sbState().points }, { pts: 2, ast: -1 });
  assert.ok(a.sbState().scoring === 'custom' && near(me().val, 2 * v('pts') - v('ast')), 'your own');
  assert.ok(a.sbMenus().includes('data-k="custom">✓ Your own points') && a.sbMenus().includes('data-action="sb-points" >Edit your points…'), 'Edit your points');
  assert.deepEqual(JSON.parse(a.localStorage.getItem('league-layer-v1')).sandbox.nba.points, { pts: 2, ast: -1 }, 'kept on the device');
  a.sbSetScoring('cats');
  assert.ok(!a.isPoints() && a.scoreCats().length === 9);
  // hockey: its own team, its categories, your own points (no site's preset)
  await a.sbSetSport('nhl');
  assert.equal(a.SPORT.key, 'nhl');
  assert.equal(st.sandbox.sport, 'nhl');
  assert.deepEqual([...a.sbState().roster], [], 'its own team');
  assert.match(a.sbMenus(), /data-sport="nhl">✓ Hockey<[\s\S]*data-k="cats">✓ 8 categories<\/button><button type="button" class="lm-item" data-action="sb-scoring-pick" data-k="custom">Your own points</);
  assert.ok(a.NBA.players.every(r => !r.fx), 'no league details on its players either');
  await a.loadBoxes();
  const hp = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val), skater = hp.find(p => !a.isGoalie(p)), goalie = hp.find(p => a.isGoalie(p));
  for (const p of [skater, goalie]) a.actions['sb-add']({ dataset: { id: String(p.nbaId) } });
  const team = a.viewSandboxTeam();
  assert.ok(team.includes(`data-id="${skater.nbaId}"`) && team.includes(`data-id="${goalie.nbaId}"`) && team.includes('SV%'), 'skaters and goalies, in hockey categories');
  assert.match(a.viewSandboxTeam(), /Build a team|sb-tot/);
  ui.sbGive.add(goalie.nbaId);
  a.actions['sb-get']({ dataset: { id: String(hp.find(p => a.isGoalie(p) && p.nbaId !== goalie.nbaId).nbaId) } });
  assert.match(a.viewSandboxTrade(), /Trade proposal[\s\S]*For your team/);
  a.actions['sb-watch-team']();
  assert.equal((a.viewSandboxWatch().match(/class="mu-p sb-w/g) || []).length, 2);
  a.forms['sb-points'](form({ g: '3', a: '2', w: '4', ga: '-1', sv: '0.2' }));
  const s2 = a.nbaPlayers().find(p => p.nbaId === skater.nbaId);
  assert.ok(a.isPoints() && near(s2.val, 3 * a.statVal(s2, 'g') + 2 * a.statVal(s2, 'a')), 'hockey points');
  // back to basketball: its team and scoring as they were
  await a.sbSetSport('nba');
  assert.deepEqual([...a.sbState().roster], best.slice(0, 3).map(p => p.nbaId));
  assert.ok(!a.isPoints() && a.scoreCats().length === 9);
  assert.equal(JSON.parse(a.localStorage.getItem('league-layer-v1')).sandbox.nhl.roster.length, 2, "hockey's team kept too");
  const live = a.get('live');
  clearTimeout(live.timer); live.timer = null;
});

test("box scores started for one sport and finishing after a switch stay out of the other's page; a failed load says so with Try again", async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const real = a.fetch, ui = a.get('ui');
  ui.tab = 'standings';
  // basketball's still coming when the page turns to hockey (the sandbox's sport menu, or a hockey league): they gave
  // hockey's players basketball's games, and could leave Live on "Loading" until a click
  a.set('BOX', null); a.set('boxLoad', null);
  a.fetch = (u, ...r) => (/^data\/box\//.test(String(u)) ? new Promise(res => setTimeout(() => res(real(u, ...r)), 40)) : real(u, ...r));
  const slow = a.loadBoxes();
  await a.useSport('nhl');
  a.fetch = real;
  const B = await slow;
  assert.equal(a.SPORT.key, 'nhl');
  assert.ok(a.get('BOX') === B && B.cols.includes('sog'), "hockey's box scores, not basketball's");
  // a load that fails: Trends says so, with Try again, rather than loading for ever
  a.set('BOX', null); a.set('boxLoad', null);
  a.fetch = (u, ...r) => (/^data\/(nhl\/)?box(\/|scores)/.test(String(u)) ? Promise.resolve({ ok: false, status: 404, text: async () => '' }) : real(u, ...r));
  ui.tab = 'trends';
  assert.match(a.viewTrends(), /Loading the season's box scores/);
  await a.loadBoxes().catch(() => {});
  assert.match(a.viewTrends(), /Couldn't load the box scores[\s\S]*data-action="box-retry">Try again/);
  a.fetch = real;
  a.actions['box-retry']();
  await a.loadBoxes();
  assert.ok(a.get('BOX') && !/Couldn't load/.test(a.viewTrends()), 'and Try again loads them');
  ui.tab = 'standings';
  const live = a.get('live');
  clearTimeout(live.timer); live.timer = null;
});

test("the sandbox Live's Today / Yesterday / Week pick holds over a reload, and gives way to the default once on a new day", async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  a.get('ui').tab = 'standings';
  a.actions['land-browse']();
  const best = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val);
  a.actions['sb-watch']({ dataset: { id: String(best[0].nbaId) } });
  a.actions['watch-range']({ dataset: { range: 'week' } });
  // the page loads again: still the week, not the default (Yesterday before tip-off)
  const saved = k => a.localStorage.getItem(k);
  const b = loadApp({ 'league-layer-v1': saved('league-layer-v1'), 'league-layer-picks': saved('league-layer-picks') });
  await b.ready();
  await b.loadBoxes();
  const ui = b.get('ui');
  ui.tab = 'standings';
  assert.equal(ui.watchRange, 'week');
  assert.ok(b.viewSandboxWatch().includes('data-range="week" aria-pressed="true"'), 'Week shown after the reload');
  b.dropOldPicks();
  assert.equal(ui.watchRange, 'week', 'the same day: kept');
  // a new day (new games in): the default once, and the next pick holds again
  b.setClock('2026-10-27T20:00:00-04:00');
  b.dropOldPicks();
  assert.equal(ui.watchRange, null);
  assert.ok(!JSON.parse(b.localStorage.getItem('league-layer-picks')).watch, 'forgotten');
  b.actions['watch-range']({ dataset: { range: 'today' } });
  assert.equal(JSON.parse(b.localStorage.getItem('league-layer-picks')).watch.at, '2026-10-27');
  b.setClock();
  for (const x of [a, b]) { x.get('ui').tab = 'standings'; const live = x.get('live'); clearTimeout(live.timer); live.timer = null; }
});

test('a reload in the sandbox on the other sport keeps the league underneath, its team pick included', async () => {
  const a = loadApp();
  await a.ready();
  await a.switchLeague(CATS9);
  const tid = a.fxLeague().teams[0].id;
  a.get('ui').tab = 'standings';
  a.adoptTeam(tid);
  a.commit();
  a.actions['land-browse']();
  await a.sbSetSport('nhl');
  // the page loads again (a refresh) on the hockey sandbox: the basketball league's team isn't in hockey's data, and was dropped
  const b = loadApp({ 'league-layer-v1': a.localStorage.getItem('league-layer-v1') });
  await b.ready();
  const st = b.get('state');
  b.get('ui').tab = 'standings';
  assert.ok(st.browse && b.SPORT.key === 'nhl', 'still the hockey sandbox');
  assert.equal(st.fxTeam, tid, 'the team pick kept');
  b.get('ui').tab = 'team'; // (on My team, a tab leagues don't have)
  await b.actions['league-switch']({ dataset: { id: CATS9 } }); // (picked in the league menu)
  b.get('ui').tab = 'standings';
  assert.ok(b.fxLeague() && b.fxLeague().id === CATS9 && st.fxTeam === tid && !b.needsLanding(), 'back to the league with its team');
  assert.equal(b.location.hash, '#dashboard', "on the league's own tabs");
  // a pick already lost that way comes back from the copy kept with the league
  b.actions['land-browse']();
  for (let i = 0; i < 50 && !(st.browse && b.SPORT.key === 'nhl'); i++) await new Promise(r => setTimeout(r, 10));
  st.fxTeam = null;
  await b.actions['league-switch']({ dataset: { id: CATS9 } });
  assert.ok(b.fxLeague().id === CATS9 && st.fxTeam === tid, 'its team again');
  for (const x of [a, b]) { x.get('ui').tab = 'standings'; const live = x.get('live'); clearTimeout(live.timer); live.timer = null; }
});

test('the sandbox from a league: the league menu offers it, and leaving it goes back to the league as it was', async () => {
  const a = loadApp();
  await a.ready();
  await a.switchLeague(CATS9);
  const st = a.get('state'), L = a.fxLeague(), tid = L.teams[0].id;
  a.get('ui').tab = 'standings';
  a.adoptTeam(tid);
  const fx = () => a.NBA.players.filter(r => r.fx).length, before = fx();
  assert.ok(before > 100, "the league's players");
  await a.loadBoxes();
  assert.ok(a.viewPlayers().includes('data-nba=') && !a.viewPlayers().includes('sb-add'), "a league's Players tab has no sandbox +");
  const lineup = JSON.stringify(st.lineup), slots = JSON.stringify(st.slots);
  assert.ok(st.lineup.filter(Boolean).length > 3, 'a lineup set');
  a.actions['land-browse']();
  assert.ok(st.browse && a.fxLeague() === null && fx() === 0);
  assert.equal(st.sandbox.back.name, L.name, 'the league it came from, to go back to');
  // the sandbox on hockey with a basketball league underneath: adding a player works (its lineup's spots, PG, SG..., aren't
  // hockey's: this threw), and the league's lineup stays as it was
  await a.sbSetSport('nhl');
  const puck = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val)[0];
  a.actions['sb-add']({ dataset: { id: String(puck.nbaId) } });
  assert.deepEqual([...a.sbState().roster], [puck.nbaId]);
  assert.equal(JSON.stringify(st.lineup), lineup, "the league's lineup untouched");
  await a.actions['browse-exit']();
  assert.ok(!st.browse && a.fxLeague() && a.fxLeague().id === CATS9, 'the league again');
  assert.equal(a.SPORT.key, 'nba', 'in its own sport');
  assert.equal(st.fxTeam, tid, 'your team');
  assert.equal(fx(), before, "its players' league details are back");
  assert.ok(JSON.stringify(st.lineup) === lineup && JSON.stringify(st.slots) === slots, 'and its lineup');
  assert.equal(a.location.hash, '#dashboard');
  // the other way round: a hockey league underneath, the sandbox on basketball
  await a.switchLeague(HOCKEY);
  a.adoptTeam(a.fxLeague().teams[0].id);
  const hockeyLineup = JSON.stringify(st.lineup);
  a.get('ui').tab = 'standings';
  st.sandbox.sport = 'nba'; // (the sandbox opens on the sport it was last on)
  a.actions['land-browse']();
  for (let i = 0; i < 50 && !(st.browse && a.SPORT.key === 'nba'); i++) await new Promise(r => setTimeout(r, 10)); // (its sport loads first)
  assert.equal(a.SPORT.key, 'nba');
  const hoop = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val)[0];
  a.actions['sb-add']({ dataset: { id: String(hoop.nbaId) } });
  assert.ok(a.sbState().roster.includes(hoop.nbaId));
  assert.equal(JSON.stringify(st.lineup), hockeyLineup, "the hockey league's lineup untouched");
  assert.equal(st.sandbox.back.id, HOCKEY);
  // back by picking it in the league menu (league-switch), from the basketball sandbox
  await a.actions['league-switch']({ dataset: { id: HOCKEY } });
  assert.ok(!st.browse && a.fxLeague() && a.fxLeague().id === HOCKEY && a.SPORT.key === 'nhl', 'the hockey league again, in hockey');
  assert.equal(JSON.stringify(st.lineup), hockeyLineup, 'with its lineup');
  // a sandbox saved by the version before (no league named to go back to), on hockey over the site's own basketball league:
  // back to it, team and lineup as they were
  await a.switchLeague(CATS9);
  assert.equal(st.fxTeam, tid);
  a.actions['land-browse']();
  await a.sbSetSport('nhl');
  st.sandbox.back = null;
  await a.actions['league-switch']({ dataset: { id: CATS9 } }); // (from the league menu, as the bar's button did)
  assert.ok(a.fxLeague() && a.fxLeague().id === CATS9 && a.SPORT.key === 'nba', 'the league again');
  assert.ok(st.fxTeam === tid && JSON.stringify(st.lineup) === lineup, 'its team and lineup');
  a.get('ui').tab = 'standings'; // no live box scores in the background
  const live = a.get('live');
  clearTimeout(live.timer); live.timer = null;
});
