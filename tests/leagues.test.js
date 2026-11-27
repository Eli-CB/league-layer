const { test, assert, sharedApp, loadApp, CATS9, POINTS, DAILY, ESPN, YAHOO, answer, yahooSignedIn, SLEEPER, hockeyApp, footballApp, ESPN_FOOTBALL, checkLeague } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('seasons: an earlier season entered as a league goes under its league, never in the league list', async () => {
  const PAST = 'czqgnyozmf2tbr93'; // 2025-26 of CATS9
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui'), NBA = app.get('NBA');
  const was = JSON.parse(JSON.stringify(state)), site = NBA.siteLeague, tab = ui.tab;
  ui.tab = 'standings'; // no live box scores in the background
  NBA.siteLeague = null; // a visitor with nothing connected yet
  Object.assign(state, { fxTeam: null, fxLeagueId: null, leagueStates: {}, savedLeagues: [], pastSeasons: {}, leagueChosen: false, demo: false });
  try {
    // the past season first: kept, not opened as this season's league
    const wait = await app.connectLeague(PAST);
    assert.equal(wait.label, '2025-26');
    assert.equal(state.savedLeagues.length, 0);
    assert.equal(state.fxLeagueId, null);
    // then this season's league: the past season is under it
    await app.connectLeague(CATS9);
    app.actions['land-team']({ dataset: { id: L.teams[2].id } });
    assert.deepEqual([...state.savedLeagues.map(l => l.id)], [CATS9]);
    assert.deepEqual([...app.seasonsFor(app.fxLeague()).map(x => x.id)], [PAST]);
    // entered again with its league here: opens it
    assert.equal(await app.connectLeague(PAST), null);
    assert.equal(ui.season, PAST);
    ui.season = null;
    // one added as a league before all this moves under its league
    state.pastSeasons = {};
    state.savedLeagues.unshift({ id: PAST, name: L.name, hid: app.fxLeague().historyId, year: 2025 });
    assert.ok(app.foldPastSeasons());
    assert.deepEqual([...state.savedLeagues.map(l => l.id)], [CATS9]);
    assert.deepEqual([...app.seasonsFor(app.fxLeague()).map(x => x.id)], [PAST]);
  } finally {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, was);
    NBA.siteLeague = site;
    ui.season = null; ui.addingLeague = false; ui.tab = tab;
    await app.useLeague(CATS9);
  }
});

test('the demo: every tab filled in as a team, and leaving it keeps nothing', async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const st = a.get('state'), ui = a.get('ui');
  ui.tab = 'standings';
  assert.ok(a.needsLanding());
  assert.match(a.viewLanding(), /Explore a basketball demo league/);
  // its rows, in order: the cards' button opens a player's card in the demo, the three cards take turns (a CSS loop: no
  // timer) and a tap on a name picks one and stops them, the Recap's picture has the Draft Recap's beside it, Trends
  // only in the grid at the foot, and the pictures' photos are only pictures (no tap to a card, as on the tabs)
  const land = a.viewLanding();
  assert.deepEqual([...land.matchAll(/class="lsh-tab">[^]*?<\/svg>([^<]+)<\/p>/g)].map(m => m[1]), ['Matchup', 'Plan Ahead', 'Cards', 'Draft', 'Recap']);
  assert.match(land, /class="pvx-deck"[^>]*>[^]*?pv-pcard[^]*?pv-tcard[^]*?Playoff Games[^]*?pv-fcard/);
  // the team cards as the real ones: the Players tab link first, then their sections (no players table)
  const deck = land.split('class="pvx-deck"')[1];
  assert.match(deck, /pv-tcard[^]*?See OKC on the Players tab[^]*?Games ahead[^]*?Who's out[^]*?Free agents[^]*?pv-fcard[^]*?See your team on the Players tab[^]*?Best players[^]*?Season so far[^]*?By category[^]*?How it was built/);
  assert.doesNotMatch(deck, /Fantasy team<\/th>/);
  assert.equal([...land.matchAll(/data-action="land-card" data-i="(\d)"/g)].map(m => m[1]).join(), '0,1,2');
  assert.ok(!/class="pvx" data-pick/.test(land));
  a.actions['land-card']({ dataset: { i: '2' }, closest: () => null });
  assert.match(a.viewLanding(), /class="pvx" data-pick="2"[^]*?class="on" data-action="land-card" data-i="2" aria-pressed="true"/);
  ui.landCard = undefined;
  assert.match(land, /class="pv-pics"[^]*?Period 6 recap[^]*?Draft Recap/);
  assert.match(land, /data-tab="players" data-player="1628983"/);
  assert.equal(land.match(/Trends/g).length, 1, 'Trends once, in the grid');
  assert.match(land, /Free · No sign-up/);
  assert.ok(!/Win odds|lp-card/.test(land), 'no picture in the hero');
  assert.match(land, /class="lf-grid">[^]*?<h3>Trends<\/h3>/);
  assert.ok(!/data-photo/.test(land));
  await a.actions['land-demo']();
  clearTimeout(a.get('live').timer);
  assert.ok(st.demo && st.fxTeam && st.players.length > 0, 'a team, not an empty league');
  assert.ok(!a.needsLanding());
  assert.ok(a.fxOpponentFor(a.weekStart(), st.fxTeam), 'with a matchup this week');
  assert.ok(st.opp.players.length > 0);
  assert.equal((st.savedLeagues || []).length, 0, "it isn't one of the visitor's leagues");
  for (const make of [() => a.viewDashboard(), () => a.viewStandings(), () => a.withViewedTeam(a.viewWeek, true), () => a.viewTrade()]) {
    const html = make();
    clearTimeout(a.get('live').timer);
    assert.ok(!/Pick your team|No players yet|Your roster is empty/.test(html));
  }
  assert.match(a.demoNote(), /Demo league[\s\S]*data-action="demo-exit"/);
  assert.ok(a.demoNote().includes(a.fxTeamName(st.fxTeam)));
  // connecting that same league for real still asks whose team is yours
  const borrowed = st.fxTeam;
  await a.switchLeague(a.get('NBA').siteLeague.id);
  assert.ok(!st.demo && !st.fxTeam, `kept ${borrowed}?`);
  // and the way out (in again from a row of the landing page: its own tab)
  await a.actions['land-demo']({ dataset: { tab: 'draft' } });
  assert.ok(st.demo && st.fxTeam);
  assert.equal(a.location.hash, '#draft');
  a.actions['demo-exit']();
  clearTimeout(a.get('live').timer);
  assert.ok(!st.demo && !st.fxTeam && st.players.length === 0);
  assert.ok(a.needsLanding());
});

test("the way home from the demo and the sandbox: the league menu's Home page, and Back to the home page's address", async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const st = a.get('state'), ui = a.get('ui'), quietLive = () => clearTimeout(a.get('live').timer);
  ui.tab = 'standings';
  const menu = new (a.document.createElement().constructor)(), find = a.document.querySelector;
  const menuHtml = () => { a.document.querySelector = sel => (sel === '#leagueMenu' ? menu : find(sel)); try { a.leagueMenu(); } finally { a.document.querySelector = find; } return menu.innerHTML; };
  const back = hash => { a.location.hash = hash; a.route(); quietLive(); }; // (the browser's Back: the address changes, then route)
  // the demo: Home page in its menu; Back to a tab stays in it, Back to the home page's address (no tab) leaves it, keeping nothing
  await a.actions['land-demo']();
  quietLive();
  assert.ok(st.demo && !a.needsLanding());
  assert.match(menuHtml(), /class="lm-foot"><button type="button" class="lm-item" data-action="go-home">[^]*Home page</);
  assert.equal(a.document.title, a.fxLeague().name, "the tab: the league's name alone");
  back('#players');
  assert.ok(st.demo && ui.tab === 'players');
  back('');
  assert.ok(!st.demo && !st.fxTeam && st.players.length === 0 && a.needsLanding(), 'the home page');
  assert.match(menuHtml(), /lm-brand/);
  assert.equal(a.document.title, a.SITE_TITLE, "the tab: the site's own title again");
  // the sandbox on hockey: Home page, back on basketball (the home page's demo and pictures are), hockey's team kept for next time
  a.actions['land-browse']();
  await a.sbSetSport('nhl');
  const puck = a.sortDesc(a.nbaPlayers().filter(p => p.gp), p => p.val)[0];
  a.actions['sb-add']({ dataset: { id: String(puck.nbaId) } });
  assert.match(menuHtml(), /data-action="go-home"/);
  assert.equal(a.document.title, a.SITE_TITLE, 'the sandbox: no league, the site');
  await a.actions['go-home']();
  quietLive();
  assert.ok(!st.browse && a.needsLanding() && a.SPORT.key === 'nba');
  assert.match(a.viewLanding(), /data-action="land-demo"/);
  assert.equal(st.sandbox.sport, 'nhl');
  assert.deepEqual([...st.sandbox.nhl.roster], [puck.nbaId]);
  // Back only where the home page was this visit: a sandbox already open when the page loaded keeps its own tabs
  a.actions['land-browse'](); // (on hockey again, its sport last time: loaded first)
  for (let i = 0; i < 100 && !st.browse; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(st.browse && a.SPORT.key === 'nhl');
  ui.fromHome = false;
  back('');
  assert.ok(st.browse && !a.needsLanding() && ui.tab === 'team');
  // with a league of your own, the menu lists it to go back to: no Home page, and Back doesn't leave
  st.savedLeagues = [{ id: CATS9, name: 'Mine' }];
  ui.fromHome = true;
  assert.ok(!/go-home/.test(menuHtml()));
  back('');
  assert.ok(st.browse && !a.needsLanding());
});

test("the demo's teams go by made-up names, and connecting the league for real brings its own back", async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const st = a.get('state'), ui = a.get('ui');
  ui.tab = 'standings';
  const real = a.get('NBA').league.teams.map(t => t.name);
  await a.actions['land-demo']();
  clearTimeout(a.get('live').timer);
  const L = a.fxLeague(), site = L.id;
  assert.equal(new Set(L.teams.map(t => t.name)).size, L.teams.length, 'each its own');
  assert.equal(L.name, 'Demo League');
  assert.equal(a.recapFileName(L, { period: { n: 1 } }).startsWith('demo-league'), true);
  assert.ok(!L.teams.some(t => real.includes(t.name)));
  assert.ok(!(L.standings || []).some(s => real.includes(s.name)));
  assert.ok(!real.includes(st.teamName) && !real.includes(st.opp.name), 'your team and your opponent too');
  const pages = [a.viewDashboard(), a.viewStandings(), a.withViewedTeam(a.viewWeek, true), a.viewTrade(), a.demoNote()].join(' ');
  clearTimeout(a.get('live').timer);
  for (const name of real) assert.ok(!pages.includes(a.esc(name)), `${name} on a page`);
  // leaving, then connecting the same league
  a.actions['demo-exit']();
  clearTimeout(a.get('live').timer);
  await a.switchLeague(site);
  assert.deepEqual([...a.fxLeague().teams.map(t => t.name)], real);
  assert.equal(a.fxLeague().name, 'Keepers and Creepers');
  // more teams than names still gets a name each
  const big = { teams: Array.from({ length: 20 }, (x, i) => ({ id: `t${i}`, name: 'x' })) };
  a.demoNames(big);
  assert.equal(new Set(big.teams.map(t => t.name)).size, 20);
  assert.equal(big.teams[19].name, 'Team 20');
});

test("a league the site can't read says why: a link's sport, a bare ESPN hockey ID, ESPN football by categories, Yahoo before it opens", async () => {
  const a = loadApp();
  await a.ready();
  const realFetch = a.fetch, calls = [];
  const answer = (status, body) => Promise.resolve({ ok: status === 200, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  // a link says its sport: told before anything's asked
  a.fetch = (url, init) => { calls.push(String(url)); return realFetch(url, init); };
  try {
    await assert.rejects(a.connectLeague('https://fantasy.espn.com/baseball/league?leagueId=12345678'), { message: "That's an ESPN baseball league. On ESPN, League Layer covers basketball and football leagues." });
    await assert.rejects(a.connectLeague('https://basketball.fantasysports.yahoo.com/nba/777'), { message: a.get('YAHOO_CLOSED') });
    await assert.rejects(a.connectLeague('https://hockey.fantasysports.yahoo.com/hockey/12345'), { message: a.get('YAHOO_CLOSED') });
    assert.deepEqual(calls.filter(u => /fantasy\.espn\.com|yahoo/.test(u)), [], 'no league asked for');
    a.localStorage.setItem('league-layer-yahoo-beta', '1');
    await assert.rejects(a.connectLeague('https://hockey.fantasysports.yahoo.com/hockey/12345'), { message: "That's a Yahoo hockey league. On Yahoo, League Layer covers basketball leagues; hockey works with Fantrax leagues." });
    a.localStorage.removeItem('league-layer-yahoo-beta');
  } finally { a.fetch = realFetch; }
  // a bare ID ESPN knows as hockey (private too: ESPN still says it's there), not as basketball or football
  for (const status of [200, 401]) {
    a.fetch = (url, init) => (String(url).includes('/games/fhl/') ? answer(status, {}) : realFetch(url, init));
    try {
      await assert.rejects(a.connectLeague('55555555'), { message: "That's an ESPN hockey league. On ESPN, League Layer covers basketball and football leagues; hockey works with Fantrax leagues." });
    } finally { a.fetch = realFetch; }
  }
  await assert.rejects(a.connectLeague('55555555'), /ESPN didn't find that league \(League not found\)/, 'in no sport: not found');
  // ESPN football scored by categories: found, and said so
  a.fetch = async (url, init) => {
    const r = await realFetch(url, init);
    if (!String(url).includes(`/games/ffl/`) || !String(url).includes(`/leagues/${ESPN_FOOTBALL}?`) || !r.ok) return r;
    const j = JSON.parse(await r.text());
    j.settings.scoringSettings.scoringType = 'H2H_CATEGORY';
    return answer(200, j);
  };
  try {
    await assert.rejects(a.connectLeague(ESPN_FOOTBALL), { message: "That's an ESPN football league scored by categories. ESPN football works with points leagues for now." });
  } finally { a.fetch = realFetch; }
  assert.equal(a.get('SPORT').key, 'nba', 'the sport as it was');
});

test('every site loads into the same league', async () => {
  yahooSignedIn();
  for (const [label, id] of [['Fantrax categories', CATS9], ['Fantrax points', POINTS], ['Fantrax daily', DAILY], ['ESPN', ESPN], ['Sleeper', SLEEPER], ['Yahoo', YAHOO]]) {
    checkLeague(await app.useLeague(id), label);
  }
  app.localStorage.removeItem('league-layer-yahoo');
  checkLeague((await hockeyApp()).fxLeague(), 'hockey');
  checkLeague((await footballApp()).fxLeague(), 'football');
});

test("the league is read again from its site 10-20 minutes before a period's first game and 2-6 after, each page at its own moment", async () => {
  const L = await app.useLeague(CATS9);
  const S = app.get('state'), ui = app.get('ui'), KEY = 'league-layer-fantrax-v2';
  const keep = { fxTeam: S.fxTeam, fxLeagueId: S.fxLeagueId, demo: S.demo, browse: S.browse }, kept = app.localStorage.getItem(KEY);
  const tip = Date.parse('2026-11-02T19:00:00-05:00'); // week 3 starts on Fantrax at its first tip-off
  const readAt = t => { const all = JSON.parse(app.localStorage.getItem(KEY) || '{}'); all[CATS9] = { at: t, res: null }; app.localStorage.setItem(KEY, JSON.stringify(all)); };
  const asked = [], realFetch = app.fetch;
  app.fetch = url => { if (String(url).includes('getLeagueInfo')) asked.push(String(url)); return realFetch(url); };
  try {
    Object.assign(S, { fxTeam: L.teams[0].id, fxLeagueId: CATS9 });
    app.setClock('2026-11-02T12:00:00-05:00');
    const R = app.get('autoReload'), drawn = [...R.spread];
    assert.ok(drawn.every(x => x >= 0 && x < 1), 'each page draws its own moments');
    // the windows' ends, then the middle (6:45 and 7:04 PM)
    R.spread = [0, 0];
    assert.ok(app.autoReloadMarks(L).includes(tip - 20 * 60e3) && app.autoReloadMarks(L).includes(tip + 2 * 60e3));
    R.spread = [1, 1];
    assert.ok(app.autoReloadMarks(L).includes(tip - 10 * 60e3) && app.autoReloadMarks(L).includes(tip + 6 * 60e3));
    R.spread = [0.5, 0.5];
    const marks = app.autoReloadMarks(L);
    assert.ok(marks.includes(tip - 15 * 60e3) && marks.includes(tip + 4 * 60e3), 'week 3: 6:45 and 7:04 PM');
    readAt(Date.parse('2026-11-02T09:00:00-05:00'));
    assert.equal(app.autoReloadDue(), null, 'noon: nothing yet');
    app.setClock('2026-11-02T18:50:00-05:00');
    assert.equal(app.autoReloadDue(), tip - 15 * 60e3, 'ten minutes before, read this morning: read it again');
    for (const k of ['demo', 'browse']) { S[k] = true; assert.equal(app.autoReloadDue(), null, `not in ${k}`); S[k] = keep[k]; }
    ui.season = 'czqgnyozmf2tbr93';
    assert.equal(app.autoReloadDue(), null, 'not in a past season');
    ui.season = null;
    await app.checkAutoReload();
    assert.equal(asked.length, 1, 'read once');
    assert.equal(app.autoReloadDue(), null, 'and not again before the game');
    app.setClock('2026-11-02T19:05:00-05:00');
    assert.equal(app.autoReloadDue(), tip + 4 * 60e3, 'after tip-off: the new period and its locked lineups');
    await app.checkAutoReload();
    assert.equal(asked.length, 2);
    app.setClock('2026-11-02T23:00:00-05:00');
    await app.checkAutoReload();
    assert.equal(asked.length, 2, 'twice a period at most');
    // read since (↻ Reload): nothing due
    app.get('autoReload').done.clear();
    readAt(Date.parse('2026-11-02T19:10:00-05:00'));
    assert.equal(app.autoReloadDue(), null);
    // ↻ Reload: not again within 2 minutes of the league's last read (the menu says so), then as before
    app.setClock('2026-11-02T19:11:00-05:00');
    assert.ok(app.reloadWait() > 0);
    asked.length = 0;
    await app.actions['league-reload']({ textContent: '' });
    assert.equal(asked.length, 0, 'read a minute ago: not asked again');
    app.setClock('2026-11-02T19:12:30-05:00');
    assert.ok(app.reloadWait() <= 0);
    await app.actions['league-reload']({ textContent: '' });
    assert.equal(asked.length, 1, 'two minutes on: reloaded');
  } finally {
    app.fetch = realFetch;
    app.setClock();
    clearTimeout(app.get('autoReload').timer);
    app.get('autoReload').done.clear();
    app.get('autoReload').spread = [Math.random(), Math.random()];
    Object.assign(S, keep);
    if (kept == null) app.localStorage.removeItem(KEY); else app.localStorage.setItem(KEY, kept);
  }
});

test("READ_PACE, one row a site: opening after half an hour, coming back after a few minutes, each game day in a daily league; nothing new redraws nothing", async () => {
  const app = await sharedApp();
  const S = app.get('state'), ui = app.get('ui'), P = app.get('READ_PACE'), KEY = 'league-layer-fantrax-v2';
  const keep = { fxTeam: S.fxTeam, fxLeagueId: S.fxLeagueId, demo: S.demo, browse: S.browse }, kept = app.localStorage.getItem(KEY), pace = JSON.stringify(P);
  const setAt = (id, t) => { const all = JSON.parse(app.localStorage.getItem(KEY)); all[id].at = t; app.localStorage.setItem(KEY, JSON.stringify(all)); };
  try {
    // opening: a copy over 30 minutes old is read again behind the page; raised, it isn't
    const W = await app.useLeague(POINTS);
    await app.getLeague(POINTS, true);
    Object.assign(S, { fxTeam: W.teams[0].id, fxLeagueId: POINTS, demo: false, browse: false });
    const now = app.Date.now();
    setAt(POINTS, now - 29 * 60e3);
    assert.equal(app.leagueStale(POINTS), false, '29 minutes: kept');
    setAt(POINTS, now - 31 * 60e3);
    assert.equal(app.leagueStale(POINTS), true, '31 minutes: read again');
    P.fantrax.open = 360;
    assert.equal(app.leagueStale(POINTS), false, 'turned down to six hours: kept');
    assert.equal(app.readPace(ESPN).open, 30, "(ESPN's row is its own)");

    // coming back after a minute or more away, a copy over 5 minutes old (never within RELOAD_COOL)
    setAt(POINTS, now - 6 * 60e3);
    assert.equal(app.backReadDue(30e3), false, 'a glance at another tab: no');
    assert.equal(app.backReadDue(90e3), true, 'back from Fantrax: read again');
    setAt(POINTS, now - 4 * 60e3);
    assert.equal(app.backReadDue(90e3), false, 'read 4 minutes ago: no');
    setAt(POINTS, now - 6 * 60e3);
    P.fantrax.back = 0;
    assert.equal(app.backReadDue(90e3), false, 'turned off');
    P.fantrax.back = 5;
    S.demo = true; assert.equal(app.backReadDue(90e3), false, 'not in the demo'); S.demo = false;

    // read with nothing new on Fantrax: the page isn't drawn again
    let draws = 0;
    const realRender = app.get('render');
    app.set('render', () => { draws++; });
    try {
      await app.checkAutoReload(90e3);
      assert.equal(app.readLeagueCache()[POINTS].at, app.Date.now(), 'read (and kept from now)');
      assert.equal(draws, 0, 'nothing new: nothing redrawn');
    } finally { app.set('render', realRender); }

    // a weekly league: around each period's first game only; a daily one around each game day's too
    P.fantrax.start = false;
    assert.equal(app.autoReloadMarks(W).length, 0, 'start off: no marks in a weekly league');
    P.fantrax.start = true;
    const D = await app.useLeague(DAILY);
    S.fxLeagueId = DAILY;
    const marks = app.autoReloadMarks(D);
    P.fantrax.daily = false;
    const noDays = app.autoReloadMarks(D);
    P.fantrax.daily = true;
    assert.ok(marks.length > noDays.length, `game days add marks (${marks.length} with, ${noDays.length} without)`);
    const tonight = app.dayFirstGame(D, app.todayIso());
    assert.ok(tonight && marks.some(m => m < tonight && m >= tonight - 20 * 60e3) && marks.some(m => m > tonight && m <= tonight + 6 * 60e3), "tonight's first game: before and after");
  } finally {
    Object.assign(P, JSON.parse(pace));
    Object.assign(S, keep);
    app.get('autoReload').done.clear();
    if (kept == null) app.localStorage.removeItem(KEY); else app.localStorage.setItem(KEY, kept);
  }
});

test("the time a league was read shows at the top only once it's over 6 hours old: amber, a tap reads it again", async () => {
  const app = await sharedApp();
  const S = app.get('state'), KEY = 'league-layer-fantrax-v2';
  const keep = { fxTeam: S.fxTeam, fxLeagueId: S.fxLeagueId, demo: S.demo, browse: S.browse }, kept = app.localStorage.getItem(KEY);
  const setAt = t => { const all = JSON.parse(app.localStorage.getItem(KEY)); all[POINTS].at = t; app.localStorage.setItem(KEY, JSON.stringify(all)); };
  try {
    const L = await app.useLeague(POINTS);
    await app.getLeague(POINTS, true);
    Object.assign(S, { fxTeam: L.teams[0].id, fxLeagueId: POINTS, demo: false, browse: false });
    const now = app.Date.now();
    setAt(now - 5 * 36e5);
    assert.equal(app.readStamp(), '', 'five hours: nothing at the top (the reads keep it fresh; ↻ Reload is in the gear menu)');
    setAt(now - 7 * 36e5);
    const stamp = app.readStamp();
    assert.match(stamp, /class="read-stamp old"[^>]*data-action="league-reload"/);
    assert.match(stamp, /Rosters from Fantrax · /);
    S.demo = true;
    assert.equal(app.readStamp(), '', 'not in the demo');
  } finally {
    Object.assign(S, keep);
    if (kept == null) app.localStorage.removeItem(KEY); else app.localStorage.setItem(KEY, kept);
  }
});

test('a league kept past its open minutes (READ_PACE) is drawn at once and read again from its site behind the page (opening it, or picking it)', async () => {
  // yesterday's visit: two leagues connected, a team picked in each
  const a = loadApp();
  await a.ready();
  for (const id of [DAILY, POINTS]) { await a.switchLeague(id); a.adoptTeam(a.fxLeague().teams[0].id); a.commit(); }
  const stop = x => { x.get('ui').tab = 'standings'; const live = x.get('live'); clearTimeout(live.timer); live.timer = null; }; // (no live scores to keep asking for)
  stop(a);
  const KEY = 'league-layer-fantrax-v2', saved = {};
  for (let i = 0; i < a.localStorage.length; i++) { const k = a.localStorage.key(i); saved[k] = a.localStorage.getItem(k); }
  const all = JSON.parse(saved[KEY]);
  for (const id of [DAILY, POINTS]) { all[id].at = a.Date.now() - 7 * 36e5; all[id].res.league.name = 'As kept'; }
  saved[KEY] = JSON.stringify(all);
  // the first visit of the day: Fantrax answers only when let through (or not at all)
  for (const fails of [false, true]) {
    const b = loadApp(saved), real = b.fetch, held = [], toasts = [];
    const answer = (u, i) => (fails ? Promise.resolve({ ok: false, status: 404 }) : real(u, i));
    b.fetch = (u, i) => (String(u).includes('fantrax.com') ? new Promise(r => held.push(() => r(answer(u, i)))) : real(u, i));
    b.toast = m => toasts.push(m);
    try {
      assert.equal(await Promise.race([b.ready(), new Promise(r => setTimeout(r, 2000, 'waited'))]), true, "the page doesn't wait for Fantrax...");
      assert.equal(b.fxLeague().name, 'As kept', "...it's drawn from the device's copy");
      assert.equal(held.length, 1, 'and Fantrax is asked behind it');
      const team = b.get('state').fxTeam;
      b.fetch = (u, i) => (String(u).includes('fantrax.com') ? answer(u, i) : real(u, i));
      held.splice(0).forEach(f => f());
      assert.equal(await b.get('leagueBehind'), !fails);
      if (!fails) {
        assert.ok(b.fxLeague().id === POINTS && b.fxLeague().name !== 'As kept' && b.get('state').fxTeam === team, 'then the league as Fantrax has it now, the same team');
        assert.equal(b.readLeagueCache()[POINTS].at, b.Date.now(), 'kept again from now');
        assert.deepEqual(toasts, []);
        // the other league, picked in the league menu: on screen at once too, then read again
        b.fetch = (u, i) => (String(u).includes('fantrax.com') ? new Promise(r => held.push(() => r(real(u, i)))) : real(u, i));
        await b.switchLeague(DAILY);
        assert.equal(b.fxLeague().name, 'As kept');
        b.fetch = real;
        held.splice(0).forEach(f => f());
        assert.ok(await b.get('leagueBehind'));
        assert.ok(b.fxLeague().id === DAILY && b.fxLeague().name !== 'As kept');
      } else {
        assert.equal(b.fxLeague().name, 'As kept', "Fantrax not answering: the kept copy stays...");
        assert.deepEqual(toasts, ["Couldn't reach Fantrax just now. Showing your league from 7 hr ago."], '...and says how old it is');
      }
    } finally { stop(b); }
  }
});
