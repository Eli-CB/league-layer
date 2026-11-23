const { test, assert, sharedApp, readFixture, CATS9, ESPN, useTeam, between, answer } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('weekly recap: every final of a finished week, the standouts, and a message to share', async () => {
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui');
  useTeam(L.teams[0].id);
  ui.tab = 'recap';
  try {
    app.viewRecap(); // starts loading the week's lineups and box scores
    await new Promise(r => setTimeout(r, 20));
    const html = app.viewRecap();
    assert.match(html, /Period 1 recap/);
    const X = app.get('recaps').get(`${L.id}|1`);
    assert.equal(X.games.length, L.matchups['1'].length, 'every matchup');
    // no emoji anywhere in the recap (the owner's ask); each player standout a card with his small round photo, as the
    // other standouts' faces, never the big one (the owner's ask, Nov 2026)
    assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'no emoji on the tab');
    assert.equal((html.match(/class="rx-card rx-player"/g) || []).length, app.recapItems(X).filter(x => x.p).length);
    assert.ok(!html.includes('pc-photo'), 'no big photo on the tab');
    assert.match(html, new RegExp(`class="rx-faces"><span class="hs[^"]*" style="width:44px;height:44px[^"]*" data-photo="${X.mvp.p.nbaId}"`), "the player's round photo, which opens his card");
    // kept short (the owner's ask, Nov 2026): his name with one initial and his fantasy team on one line, a week's games
    // beside the award, no NBA team, positions or minutes, a week's percentages without makes/attempts (a game's keep them)
    const mvpCard = html.slice(html.indexOf('Player of the period'), html.indexOf('</article>', html.indexOf('Player of the period')));
    assert.ok(mvpCard.includes(`${X.mvp.line.gp1} G, per game</span>`) && mvpCard.includes(`>${app.esc(app.shortName(X.mvp.p.name))}</button><span class="rx-team">`), 'short name, team beside it');
    assert.ok(!html.includes('rx-meta') && !mvpCard.includes('class="pt ') && !mvpCard.includes('data-action="sport-team"') && !mvpCard.includes(' MIN') && !/\d\/\d/.test(mvpCard), 'no NBA team, positions, minutes or a week\'s makes/attempts');
    const gameCard = html.slice(html.indexOf('Game of the period'), html.indexOf('</article>', html.indexOf('Game of the period')));
    assert.ok(gameCard.includes(` ${X.game.line.fgm}/${X.game.line.fga}`), "a game's makes/attempts kept");
    // the finals agree with Fantrax's standings (week 1 is the only finished week)
    for (const g of X.games) {
      const ra = L.standings.find(r => r.id === g.a);
      assert.equal(g.margin > 0 ? 'win' : 'tie', ra.w ? 'win' : ra.l ? 'loss' : 'tie', `${app.fxTeamName(g.a)} ${app.scoreLine(g.sc)} ${app.fxTeamName(g.b)}`);
    }
    assert.ok(X.games.every((g, i) => !i || g.margin <= X.games[i - 1].margin), 'biggest margin first');
    // the standouts are starters' numbers, valued as Performances values them
    assert.ok(X.mvp && X.mvp.v > 0 && X.game && X.game.line.gp1 === 1);
    assert.ok(X.game.v >= X.mvp.v / X.mvp.line.gp1, 'the best game beats the best week per game');
    // the brick did the least over the week, the dud had the worst single game
    assert.ok(X.brick && X.dud);
    assert.ok(X.brick.line.gp1 >= 2 && X.brick.v / X.brick.line.gp1 <= X.mvp.v / X.mvp.line.gp1 && X.dud.v <= X.game.v && X.dud.line.gp1 === 1);
    assert.ok(html.includes('Worst period') && html.includes('Worst game'));
    // Street clothes: games missed while starting, never more than his team played
    assert.ok(X.missed.every(x => x.games > 0 && x.games <= x.sched));
    if (X.missed.length) assert.ok(html.includes('Street clothes') && html.includes('while starting'));
    if (X.regret) assert.ok(X.regret.up > 0, 'a bench regret changes a result');
    assert.ok(X.allPlay.w + X.allPlay.l + X.allPlay.t === L.teams.length - 1);
    // the results crown the week's best all-play record and mark the worst, every team tied included
    const recs = Object.values(X.rank.rec), vals = recs.map(a => a.w + a.t / 2);
    assert.deepEqual(Array.from(X.rank.top, String).sort(), recs.filter(a => a.w + a.t / 2 === Math.max(...vals)).map(a => String(a.tid)).sort());
    assert.deepEqual(Array.from(X.rank.bottom, String).sort(), recs.filter(a => a.w + a.t / 2 === Math.min(...vals)).map(a => String(a.tid)).sort());
    assert.ok(X.rank.top.includes(X.allPlay.tid), 'Best period is the crowned one');
    const results = html.split('class="rc-finals"')[1];
    assert.equal((results.match(/class="rc-badge rc-top"[^>]*>Best</g) || []).length, X.rank.top.length);
    assert.equal((results.match(/class="rc-badge rc-bottom"[^>]*>Worst</g) || []).length, X.rank.bottom.length);
    assert.match(results, /title="Best period in the league: \d+-\d+(-\d+)? against every other team"/);
    for (const label of ['Player of the period', 'Game of the period', 'Best period']) assert.ok(html.includes(label), label);
    const words = L.teams.reduce((t, tm) => t.split(app.esc(tm.name)).join(' '), html.replace(/<[^>]+>/g, ' ')); // (not a team's name: "BYE WEEK")
    assert.ok(!/\bweek/i.test(words) && !/\bweek/i.test(app.get('INFO').recap.join(' ')), 'the recap says period, never week (the owner\'s ask)');
    assert.match(html, /would have beaten (every other team|\d+ of \d+ teams)/, 'Best period counts teams beaten, not categories');
    // the message: the standouts only (everyone has the results), each with its full line in the league's categories
    const text = app.recapText(L, X);
    assert.ok(text.startsWith(`${L.name} · Period 1 recap`) && !/\p{Extended_Pictographic}/u.test(text), text.slice(0, 80));
    assert.ok(!X.games.some(g => text.includes(`${app.fxTeamName(g.a)} ${app.scoreLine(g.sc)} ${app.fxTeamName(g.b)}`)), 'no results');
    assert.ok(text.includes('Player of the period: ') && !/<[a-z]/.test(text), 'plain text, no markup');
    for (const c of app.scoreCats()) assert.ok(text.includes(` ${c.pct ? c.label.replace('%', '') : c.label}`), `${c.label} in the lines`);
    assert.ok(text.includes(`${X.game.line.fgm}/${X.game.line.fga} FG`), 'shooting as makes/attempts');
    assert.ok(!/Biggest win|Closest/.test(text + html), 'not the biggest win or the closest');
    assert.ok(!html.includes('inl-p'), 'names without photos, in line with the text');
    assert.ok(app.recapUrl(L, 1).endsWith(`?league=${L.id}&period=1#recap`), app.recapUrl(L, 1));
    // the image: each player standout brings its player, team and stat line (stats kept whole: ' · ' between them)
    const items = app.recapItems(X), mvp = items.find(x => x.label === 'Player of the period');
    assert.ok(mvp.p.nbaId === X.mvp.p.nbaId && mvp.tid === X.mvp.tid && mvp.stats.includes(' · ') && mvp.stats.startsWith(`${X.mvp.line.gp1} G, per game: `));
    assert.ok(items.filter(x => !x.p).every(x => x.text && !x.stats), 'the others are a sentence');
    assert.match(app.recapFileName(L, X), /^[a-z0-9-]+-period-1\.png$/);
    // the Matchup tab doesn't point to it (the Recap tab is one tap away)
    assert.ok(!app.viewDashboard().includes('Week 1 recap'));
  } finally { ui.tab = 'dashboard'; }
  // leagues whose past lineups aren't read say so: ESPN football, Yahoo
  assert.ok(app.hasWeekLineups(L) && app.hasWeekLineups({ source: 'espn' }));
  assert.ok(!app.hasWeekLineups({ source: 'espn', sport: 'nfl' }) && !app.hasWeekLineups({ source: 'yahoo' }));
});

test("ESPN recap: a finished week from each of its days' lineups, asked for once and kept on the device", async () => {
  const L = await app.useLeague(ESPN);
  const ui = app.get('ui');
  // the fixtures' box scores end Oct 25, before this league's first week: its first matchup moved onto those days
  const n = L.periods[0].n, saved = L.periods[0];
  L.periods[0] = { n, start: '2026-10-20', end: '2026-10-25', lock: '2026-10-20T00:00:00', endAt: '2026-10-25T23:59:00' };
  const league = JSON.parse(readFixture(`espn/${ESPN}/league.json`));
  const asked = [];
  const realFetch = app.fetch;
  // ESPN's answer for a past day: the league's rosters as they stood (here: the same every day)
  app.fetch = (url, init) => {
    const day = String(url).match(/view=mRoster&scoringPeriodId=(\d+)$/);
    if (!day) return realFetch(url, init);
    asked.push(+day[1]);
    const body = JSON.stringify({ scoringPeriodId: +day[1], teams: league.teams.map(t => ({ id: t.id, roster: t.roster })) });
    return Promise.resolve({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
  };
  const players = app.NBA.players.map(r => [r, r.fx, r.pos]);
  app.applyFantraxLeague(await app.getLeague(ESPN, true)); // the players under their ESPN ids, as on the page
  L.periods[0] = app.fxLeague().periods[0] = { ...L.periods[0] };
  useTeam(L.teams[0].id);
  ui.tab = 'recap';
  try {
    assert.match(app.viewRecap(), /Loading the period's lineups from ESPN/);
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewRecap();
    assert.match(html, new RegExp(`Period ${n} recap`));
    assert.deepEqual(asked.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6], 'one request a day, ESPN numbering days from opening night');
    const X = app.get('recaps').get(`${L.id}|${n}`);
    assert.equal(X.games.length, L.matchups[n].length, 'every matchup');
    assert.ok(X.games.every(g => g.sc.me > 0 && g.sc.opp > 0 && g.sc.me >= g.sc.opp), 'scored from the box scores, winner first');
    assert.ok(X.mvp && X.game && X.mvp.line.gp1 >= 1);
    // a starter is anyone in a lineup slot: the bench and IR don't count
    const days = await app.espnWeekLineups(L, L.periods[0]);
    const t = league.teams[0], on = t.roster.entries.filter(e => ![12, 13].includes(e.lineupSlotId)).map(e => String(e.playerId)).sort();
    assert.deepEqual([...days[0].owner].filter(([, o]) => o.tid === String(t.id) && o.on).map(([f]) => f).sort(), on);
    assert.equal(days.length, 6);
    // finished days are kept: a later visit asks ESPN for nothing
    app.changed('league', L.id);
    app.get('recaps').clear();
    app.viewRecap();
    await new Promise(r => setTimeout(r, 30));
    assert.match(app.viewRecap(), new RegExp(`Period ${n} recap`));
    assert.equal(asked.length, 6);
    // only the week's days are read
    assert.ok(app.hasWeekLineups(L) && !app.hasLineupHistory(L), 'Awards and Season totals stay off: they need every day');
  } finally {
    app.fetch = realFetch; L.periods[0] = saved; ui.tab = 'dashboard';
    for (const [r, fx, pos] of players) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
    app.localStorage.removeItem('league-layer-espn-days-v1');
    app.changed('league', L.id);
    await app.useLeague(CATS9);
  }
});

test('a shared recap link: connects the league, asks for the team, then shows the recap', async () => {
  // &period= (a link shared before Nov 20, 2026 says &week=)
  for (const key of ['period', 'week']) {
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui');
  const was = { ...state }, loc = { search: app.location.search, hash: app.location.hash };
  app.history = { replaceState() { app.location.search = ''; } };
  Object.assign(state, { fxTeam: null, fxLeagueId: null, leagueStates: {}, savedLeagues: [], leagueChosen: false, demo: false });
  app.location.search = `?league=${L.id}&${key}=1`;
  app.location.hash = '#recap';
  app.route(); // as the page does on load, before the link is read
  try {
    await app.openSharedLink();
    assert.equal(app.location.search, '', 'the link is tidied away');
    assert.equal(ui.recapWeek, 1);
    assert.equal(app.currentLeagueId(), L.id);
    assert.ok(app.needsLanding(), 'pick your team first');
    assert.match(app.viewLanding(), /the period 1 recap a league mate shared/);
    app.actions['land-team']({ dataset: { id: L.teams[2].id } });
    assert.equal(state.fxTeam, L.teams[2].id);
    assert.equal(ui.tab, 'recap', 'then the recap');
    assert.equal(ui.afterPick, null);
  } finally {
    Object.assign(state, was);
    Object.assign(app.location, loc);
    ui.recapWeek = null; ui.tab = 'dashboard';
    const live = app.get('live'); clearTimeout(live.timer); live.timer = null;
    await app.useLeague(CATS9);
  }
  }
});
