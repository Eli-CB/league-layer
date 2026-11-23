const { test, assert, sharedApp, CATS9, ESPN, useTeam, onDay, sleeperWithResults, quiet } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('a finished week: its real result, and the bench swaps that would have changed it', async () => {
  const L = await app.useLeague(CATS9);
  const weeks = await app.loadRosterWeeks(L);
  const G = await app.loadGameLog('cur');
  const fidNba = app.currentFidNba();
  const period = L.periods.find(p => p.n === 1);
  const pair = L.matchups['1'].find(m => m.some(t => app.fxTeamName(t).startsWith('Team Sincere')));
  const me = pair.find(t => app.fxTeamName(t).startsWith('Team Sincere')), them = pair.find(t => t !== me);
  // a game the evening week 1 ends (Monday Oct 26, 7 p.m.) belongs to week 2, as does week 2's lineup
  const w2 = weeks.find(w => w.n === 2);
  const late = [...w2.owner].find(([, o]) => o.tid === me && o.on)[0];
  const day = Math.round((new Date('2026-10-26T12:00:00') - new Date(G.start + 'T12:00:00')) / 864e5);
  const G2 = { ...G, players: new Map(G.players) };
  G2.players.set(fidNba(late), [...(G.players.get(fidNba(late)) || []), [day, 0, ...G.keys.map(k => (k === 'pts' ? 50 : 1))]]);
  const [A, B] = app.benchSwaps({ ...L, fidNba }, G2, weeks, period, [me, them]);
  // the final counts what Season totals counts: week 1 here was a tie
  const tot = app.pastSeasonTotals({ ...L, weeks: [weeks.find(w => w.n === 1)], fidNba }, G);
  assert.equal(A.tot.pts, tot[me].s.pts);
  assert.equal(B.tot.reb, tot[them].s.reb);
  const sc = app.weekScore(A.tot, B.tot);
  assert.equal(sc.me, sc.opp, 'tied');
  // a swap: the bench player's games that week in, the starter's out
  const days = app.periodDays(G, weeks.find(w => w.n === 1));
  const pts = p => (G.players.get(fidNba(p.fid)) || []).filter(r => days.has(r[0])).reduce((t, r) => t + app.gameLine(G, r).pts, 0);
  const w = A.swaps.find(x => pts(x.inP) !== pts(x.outP));
  assert.equal(w.tot.pts, A.tot.pts - pts(w.outP) + pts(w.inP));
  // each player against his averages going in (week 1: no one has 3 games before it, so his season's): his team's games
  // while he started, the ones he missed, and a projection that adds up to the team's
  app.weekVsAverages({ ...L, fidNba }, G2, weeks, period, [A, B]);
  for (const x of A.starters) {
    assert.ok(x.sched >= (x.line.gp1 || 0) && x.missed.length === x.sched - (x.line.gp1 || 0), `${x.p.name}: ${x.line.gp1} of ${x.sched}, missed ${x.missed}`);
    assert.equal(x.avgGames, 0);
  }
  for (const x of [...A.bench, ...B.bench]) assert.equal(x.missed.length, 0, `${x.p.name}: a bench player's missed games cost nothing`);
  const withProj = A.starters.filter(x => x.proj);
  assert.ok(withProj.length && Math.abs(A.proj.tot.pts - withProj.reduce((t, x) => t + x.proj.pts, 0)) < 1e-6);
  assert.equal(A.proj.games, withProj.reduce((t, x) => t + x.sched, 0));
  // the card: for a team with a winning swap, it says so
  useTeam(me);
  const ui = app.get('ui');
  ui.weekShift = -1;
  try {
    app.pastWeekCard(app.weekStart()); // starts loading the week's lineups and box scores
    await new Promise(r => setTimeout(r, 10));
    const html = app.pastWeekCard(app.weekStart());
    assert.ok(!html.includes('How week 1 ended') && html.includes('class="pw-result"') && html.includes('class="alert good"') && html.includes('Would have won'), html.slice(0, 400)); // (no heading: straight to the final)
    // the page shows the week as it was played: nothing to plan, only what was projected going in beside what happened
    const page = app.viewWeek();
    assert.ok(page.includes('Week total') && page.includes('Projected going in') && !/Suggested changes|Pickup ideas|Lineup for|to win the week|Plan next week/i.test(page), 'a finished week, not a projection');
    assert.equal((page.match(/<tr class="bench">/g) || []).length, A.bench.length + B.bench.length, "both teams' benches that week");
    assert.ok(page.includes('Against their averages') && page.includes('class="on" data-action="past-mode" data-mode="week"'), 'Week total first, and who beat his averages');
    ui.pastMode = 'game';
    assert.ok(app.pastWeekCard(app.weekStart()).includes('class="on" data-action="past-mode" data-mode="game"'), 'Per game');
    // sortable by any column, starters and bench apart: points, most first
    ui.pastSort = { key: 'pts', dir: -1 };
    const sorted = app.pastWeekCard(app.weekStart()), body = sorted.slice(sorted.indexOf('<tbody>') + 7, sorted.indexOf('</tbody>'));
    assert.match(sorted, /class="sortable sc sorted" data-action="past-sort" data-key="pts"[^>]*aria-sort="descending"/);
    const ptsAt = 2 + app.lineCats().findIndex(c => c.key === 'pts');
    const shown = body.split('</tr>').filter(r => r.includes('<td')).map(r => +((r.split('<td').slice(1)[ptsAt] || '').replace(/<[^>]*>/g, '').replace(/^[^>]*>/, '')));
    assert.ok(shown.length > 1 && shown.every((v, i) => !i || shown[i - 1] >= v), `starters by points: ${shown}`);
  } finally { ui.weekShift = 0; ui.pastMode = 'week'; ui.pastSort = { key: '#g', dir: -1 }; }
  assert.equal(app.pastWeekCard(app.weekStart()), '', 'not for a week still being played');
});

test("a finished week never shows projections, even where its lineups can't be read", async () => {
  const L = await app.useLeague(ESPN);
  useTeam(L.teams[0].id);
  const ui = app.get('ui');
  assert.ok(!app.hasLineupHistory(L));
  ui.weekShift = -1;
  try {
    const page = app.viewWeek();
    assert.ok(page.includes('That week is over') && !/projected|today's|to win the week|class="sb-score"|class="stab"/i.test(page), page.slice(-600));
    assert.ok(/<div class="card"><div class="sb-week solo">.*?<span>Last period<\/span>.*?That week is over/s.test(page), "the week's picker heads the card, to step back out");
  } finally { ui.weekShift = 0; }
  assert.ok(!app.viewWeek().includes('That week is over'), 'only a finished week');
});

test("Matchups steps through the league's matchup weeks and its teams", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.teams[0].id);
  assert.deepEqual([...app.weekShifts()].slice(0, 3), [-1, 0, 1], 'week 1 began Oct 20: no stepping back into the preseason');
  const ui = app.get('ui');
  ui.weekShift = -1;
  try {
    const nav = app.weekPicker();
    assert.equal((nav.match(/<option /g) || []).length, L.periods.length, 'every matchup week');
    assert.ok(nav.includes(`>Week ${L.periods.length} (playoffs)<`), nav);
    assert.ok(nav.includes('>Week 2 (this period)<') && nav.includes('selected>Week 1<'), nav);
    assert.ok(/data-step="-1"[^>]*disabled/.test(nav) && !/data-step="1"[^>]*disabled/.test(nav), 'the first week: only forward');
  } finally { ui.weekShift = 0; }
  // the opponent is picked where their name is on the scoreboard: the week's real one marked
  const pick = app.fxOppPicker(app.weekContext());
  assert.ok(pick.includes('data-change="fx-opp"') && / \(this period\)<\/option>/.test(pick), pick);
});

test('the tabs: Matchup is this week, Plan Ahead opens on next week until a week is picked', async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.standings[0].id);
  const ui = app.get('ui');
  const names = Object.fromEntries(app.tabList());
  assert.equal(names.dashboard, 'Matchup');
  assert.equal(names.week, 'Plan Ahead');
  Object.assign(ui, { tab: 'week', weekShift: 0, weekChosen: false });
  app.planAheadWeek();
  assert.equal(ui.weekShift, 1, 'next week');
  app.goWeek(0);
  ui.weekChosen = true;
  app.planAheadWeek();
  assert.equal(ui.weekShift, 0, 'a week picked stays');
  app.savePick('week');
  Object.assign(ui, { tab: 'dashboard', weekShift: 0, weekChosen: false });
  // Matchup's and Players' (i) sit in the page, not on the tab bar
  assert.ok(!app.tabList().some(([, l]) => /info/.test(l)));
});

test("a new period is this period from its first game: before it, Plan Ahead's next period is the one whose lineups are being set", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.standings[0].id);
  const ui = app.get('ui');
  app.savePick('week');
  try {
    // Monday noon: period 2 starts at 7 PM ET (Fantrax's lock, its first tip-off)
    app.setClock('2026-10-26T12:00:00-04:00');
    assert.equal(app.fxPeriodFor(app.weekStartAt(0)).n, 1, 'this period: the one that ended last night');
    assert.equal(app.fxPeriodFor(app.weekStartAt(1)).n, 2, 'next period: the one starting tonight');
    Object.assign(ui, { tab: 'week', weekShift: 0, weekChosen: false, weekAt: null });
    app.planAheadWeek();
    assert.equal(ui.weekShift, 1, 'Plan Ahead opens on it');
    const ctx = app.weekContext();
    assert.equal(ctx.locked, false, 'its lineups still to set');
    assert.match(app.fxOppPicker(ctx), / \(next period\)<\/option>/);
    assert.match(app.weekPicker(), />Week 1 \(this period\)</);
    // the deadline for them: its first tip-off, Fantrax's own time (the notes, on the scoreboard's last line)
    const seven = app.fmtTime(Date.parse('2026-10-26T19:00:00-04:00')); // ("7:00 PM", as the device writes it)
    const notes = s => app.fxWeekNotes(app.weekContext(app.weekStartAt(s)));
    assert.ok(notes(1).includes(`lineups lock <b>today ${seven}</b>`), notes(1));
    assert.ok(notes(1).includes(`title="The period starts at its first game, Mon, Oct 26 at ${seven}, and lineups lock then: set yours on Fantrax before it."`));
    assert.match(app.viewWeek(), /class="muted sb-foot-notes"><span title="The period starts at its first game[^"]*">lineups lock <b>today /);
    app.setClock('2026-10-24T12:00:00-04:00');
    assert.ok(notes(1).includes(`lineups lock <b>Mon ${seven}</b>`), 'days ahead: its weekday');
    assert.ok(notes(2).includes(`lineups lock <b>Mon, Nov 2, ${seven}</b>`), 'a week or more: its date');
    // without Fantrax's time (ESPN's or Yahoo's lock is midnight): 7 PM ET, marked as a guess
    const lock = L.periods[1].lock;
    L.periods[1].lock = '2026-10-26T00:00:00';
    app.setClock('2026-10-26T12:00:00-04:00');
    assert.ok(notes(1).includes(`about Mon, Oct 26 at ${seven} (the exact time shows on game day), and lineups lock then`));
    assert.ok(notes(1).includes(`lineups lock <b>~today ${seven}</b>`));
    L.periods[1].lock = lock;
    // tip-off: period 2 is this period, its lineups locked, and Plan Ahead opens on period 3
    app.setClock('2026-10-26T19:00:00-04:00');
    assert.equal(app.fxPeriodFor(app.weekStartAt(0)).n, 2);
    assert.equal(app.weekContext(app.weekStartAt(0)).locked, true);
    app.planAheadWeek();
    assert.equal(app.fxPeriodFor(app.weekStart()).n, 3);
    // another team picked in place of the real opponent: one line across the top of the scoreboard says so, with the way
    // back, so both sides' scores stay level (it used to stack under the opponent's menu, two or three lines on a phone)
    const real = app.fxOpponentFor(app.weekStart()), other = L.teams.find(t => t.id !== real.id && t.id !== L.standings[0].id);
    assert.doesNotMatch(app.viewWeek(), /sb-hypo/, 'the real opponent: nothing to say');
    app.loadFxTeam(other.id);
    const board = app.viewWeek();
    assert.match(board, /<div class="card scoreboard">\s*<div class="sb-hypo"><span class="badge warn">Hypothetical<\/span><button class="link-btn quiet" data-action="fx-load-opp"[^>]*>Back to [^<]+<\/button><\/div>\s*<div class="sb-main">/);
    assert.ok(board.includes(`>Back to ${app.esc(real.name)}<`));
    app.loadFxTeam(real.id);
  } finally {
    app.setClock(); app.savePick('week');
    Object.assign(ui, { tab: 'dashboard', weekShift: 0, weekChosen: false, weekAt: null });
  }
});

test('a finished week projects exactly what happened', async () => {
  const L = await app.useLeague(CATS9);
  await app.loadBoxes();
  const weeks = await app.loadRosterWeeks(L);
  const w1 = weeks.find(w => w.n === 1), toNba = app.currentFidNba();
  const lineups = { 1: {} };
  for (const [f, o] of w1.owner) if (o.on && toNba(f)) (lineups[1][o.tid] = lineups[1][o.tid] || []).push(toNba(f));
  const p1 = L.periods.find(p => p.n === 1);
  const dates = app.matchDates(p1.start);
  assert.ok(dates.length >= 6 && !dates.includes('2026-10-26'), 'week 1 ends before Monday night');
  // each team's week-1 starters, projected over week 1: every game is final, so nothing is left to chance
  const side = tid => {
    const players = lineups[1][tid].map(id => app.playerFromRaw(app.nbaById.get(id)));
    return app.projectSide(players, dates, new Set(players.map(p => p.id)));
  };
  for (const [a, b] of L.matchups['1']) {
    const cats = app.compareCats(side(a), side(b));
    for (const c of cats) assert.ok([0, 0.5, 1].includes(c.p), `${c.label} is settled (${c.p})`);
    const won = cats.filter(c => c.p === 1).length, lost = cats.filter(c => c.p === 0).length;
    const ra = L.standings.find(r => r.id === a);
    assert.equal(won > lost ? 'win' : won < lost ? 'loss' : 'tie', ra.w ? 'win' : ra.l ? 'loss' : 'tie', `${app.fxTeamName(a)} ${won}-${lost}`);
  }
});

test("Matchups: next week shows next week's lineups as set on Fantrax (this week's locked when it started)", async () => {
  const L = await app.useLeague(CATS9);
  assert.equal(L.rosterPeriod, 2);
  assert.equal(L.nextRosters && L.nextRosters.period, 3, "weekly lineups: next week's asked for too");
  const ui = app.get('ui'), st = app.get('state'), was = { team: st.fxTeam, shift: ui.weekShift, lineup: st.lineup, players: st.players, il: st.il, opp: st.opp };
  // a team that changed its starters for next week
  const starters = (tid, n) => app.fxTeamSide(tid, n).starters.join();
  // a side's lineup as NBA ids (player ids are made fresh each time)
  const nba = S => [...S.lineup].map(id => (S.players.find(p => p.id === id) || {}).nbaId);
  const nbaOn = (S, ids) => [...ids].map(id => (S.players.find(p => p.id === id) || {}).nbaId).sort();
  const shown = week => app.withViewedTeam(() => { const s = app.get('state'); return { lineup: nba(s), opp: nbaOn(s.opp, s.opp.starters || []) }; }, week);
  const tid = L.teams.map(t => t.id).find(id => starters(id) !== starters(id, 3));
  assert.ok(tid, 'someone set a different lineup');
  try {
    app.adoptTeam(tid);
    ui.weekShift = 0;
    assert.equal(app.nextRosterPeriod(), null);
    assert.deepEqual([...shown(true).lineup], nba(app.fxTeamSide(tid)), 'this week: as locked');
    ui.weekShift = 1;
    assert.equal(app.nextRosterPeriod(), 3);
    assert.notDeepEqual(nba(app.fxTeamSide(tid, 3)), nba(app.fxTeamSide(tid)));
    assert.deepEqual([...shown(true).lineup], nba(app.fxTeamSide(tid, 3)), "next week: next week's lineup");
    const opp = app.fxOpponentFor(app.weekStart(), tid);
    if (opp) { app.loadFxTeam(opp.id); const O = app.fxTeamSide(opp.id, 3); assert.deepEqual([...shown(true).opp], nbaOn(O, O.starters), "and the opponent's"); }
    assert.deepEqual([...shown(false).lineup], nba(app.fxTeamSide(tid)), 'other tabs: this week');
    assert.deepEqual(nba(app.get('state')), nba(app.fxTeamSide(tid)), 'the saved lineup is left alone');
    assert.ok(!app.viewWeek().includes('rosters as of week'), "next week's lineups, not an old week's");
  } finally {
    Object.assign(st, { fxTeam: was.team, lineup: was.lineup, players: was.players, il: was.il, opp: was.opp }); ui.weekShift = was.shift;
    ui.tab = 'standings'; clearTimeout(app.get('live').timer); // the redraw started live scores
  }
});

test('Matchups steps through every week of the league, a two-week matchup once', async () => {
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui');
  const shifts = app.weekShifts();
  const periods = shifts.map(s => app.fxPeriodFor(app.weekStartAt(s)).n);
  assert.deepEqual([...periods], L.periods.map(p => p.n), 'each matchup week, in order, once');
  assert.ok(shifts.includes(0));
  // stepping past a two-week matchup takes one click
  const long = L.periods.find(p => (Date.parse(p.end) - Date.parse(p.start)) / 864e5 > 7);
  if (long) {
    const at = shifts[periods.indexOf(long.n)], tab = ui.tab;
    ui.weekShift = at;
    ui.tab = 'week'; // (no live box scores in the background)
    try {
      app.actions['week-shift']({ dataset: { step: '1' } });
      assert.equal(app.fxPeriodFor(app.weekStartAt(ui.weekShift)).n, long.n + 1);
    } finally { ui.weekShift = 0; ui.tab = tab; }
  }
});

test("Plan Ahead: each player's positions in their lineup-spot colors, as its lineup spots and the Matchup tab's", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.teams[0].id);
  const html = app.viewWeek();
  // the board: a PG's position as the PG spot is colored
  const pg = app.SPORT.slotColors.PG;
  assert.ok(html.includes(`<span class="bmeta-info"><span class="pt pt-PG pc pc-${pg}">PG</span>`) || new RegExp(`<span class="bmeta-info">(<span class="pt pt-[A-Z]+ pc pc-[a-z0-9-]+">[A-Z]+</span>,?)+</span>`).test(html), 'positions colored on the board');
  assert.ok(!/<span class="bmeta-info"><span class="pt pt-[A-Z]+">/.test(html), 'none left plain');
  assert.match(html, new RegExp(`class="slot-label slot-PG pc pc-${pg}"`), 'the same color as the PG spot');
});

test("Plan Ahead's schedule dots of a period longer than a week come a row a week, so a phone's column still holds them", async () => {
  const L = await app.useLeague(CATS9);
  const days = n => app.periodDates(L.periods.find(q => q.n === n));
  const p = app.nbaPlayers().find(x => x.team && app.get('teamDates').get(x.team));
  assert.equal(days(7).length, 14, 'the NBA Cup period, Nov 30 - Dec 13');
  const long = app.dayDots(p, { dates: days(7) }, true);
  assert.match(long, /^<span class="dots wk">/);
  assert.equal(long.match(/<i /g).length, 14, 'still a dot a day');
  assert.match(app.dayDots(p, { dates: days(6) }, true), /^<span class="dots">/, 'a week: one line');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8'), /\.dots\.wk \{[^}]*grid-template-columns: repeat\(7, /);
});

test("Plan Ahead's schedule bubbles carry each day's opponent, shown on a desktop's Lineups card with the days over them (the owner's pick, Nov 23, 2026), a link to his team's card", async () => {
  const L = await app.useLeague(CATS9);
  const days = n => app.periodDates(L.periods.find(q => q.n === n));
  const p = app.nbaPlayers().find(x => x.team && app.get('teamDates').get(x.team) && app.gamesIn(x, days(6)) >= 2);
  assert.doesNotMatch(app.dayDots(p, { dates: days(6) }, true), /class="vs"|days/, 'a data file without opponents: the dots as they were');
  const teams = app.NBA.teams;
  for (const v of Object.values(teams)) v.vs = (v.dates || []).map((d, i) => (i % 2 ? '@' : '') + 'BOS');
  app.useData(app.NBA);
  try {
    const html = app.dayDots(p, { dates: days(6) }, true), first = teams[p.team].dates.indexOf(days(6).find(d => app.playsOn(p, d)));
    assert.match(html, /^<span class="dots days">/);
    const link = '<button type="button" class="link-btn tm-link" data-action="sport-team" data-team="BOS" title="Boston Celtics">';
    assert.ok(html.includes(`<span class="vs">${link}${first % 2 ? '<span class="at">@</span>' : ''}BOS</button></span>`), "the day's opponent, @ when away, opening his team's card");
    // a game still to come: a grey outline, not green till it's played (the owner's ask: the team says there's a game)
    const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8');
    assert.match(css, /\.board \.dots\.days i\.up, \.board \.dots\.days i\.up\.b2b \{ box-shadow: inset 0 0 0 1px color-mix\(in srgb, var\(--muted\)/);
    assert.equal(html.match(/class="vs"/g).length, app.gamesIn(p, days(6)), 'one a game, none on a day off');
    assert.doesNotMatch(app.dayDots(p, { dates: days(7) }, true), /class="vs"|days/, 'a two-week period: dots only');
    assert.match(app.boardHead('Team', { dates: days(6) }), /<span class="dhead" aria-hidden="true">(<i>\w+<\/i>){7}<\/span>/, 'the days over them');
    assert.equal(app.boardHead('Team', { dates: days(6) }, false), 'Team', 'nothing over an empty column');
  } finally {
    for (const v of Object.values(teams)) delete v.vs;
    app.useData(app.NBA);
  }
});

test("Plan Ahead's schedule bubble of a game on now flashes green while he's in it; your own team's name is orange wherever it's drawn", async () => {
  const L = await app.useLeague(CATS9);
  await app.loadBoxes();
  const live = app.get('live'), was = live.games, wasLines = live.lines.get('2026-10-28');
  const p = app.nbaPlayers().find(x => x.team && x.status !== 'Out' && app.get('teamDates').get(x.team) && app.get('teamDates').get(x.team).has('2026-10-28'));
  const dots = () => onDay('2026-10-28', () => app.dayDots(p, { dates: ['2026-10-27', '2026-10-28', '2026-10-29'] }, true));
  try {
    live.games = [{ id: 'x', d: '2026-10-28', home: p.team, away: 'ZZZ', state: 'in', detail: '4:12 - 3rd', start: 0 }];
    live.lines.delete('2026-10-28');
    assert.match(await dots(), /<i class="live wait" data-tip="Game on now: 4:12 - 3rd&lt;div class=&quot;tip-dim&quot;&gt;He hasn&#39;t played yet/, "his team's game on, he hasn't played yet: a flashing green ring");
    live.lines.set('2026-10-28', new Map([[p.nbaId, { min: 14, pts: 6 }]]));
    assert.match(await dots(), /<i class="live" data-tip="Playing now: 4:12 - 3rd"><\/i>/, 'in the box score: flashing green');
    live.lines.delete('2026-10-28');
    const wasStatus = p.status;
    p.status = 'Out';
    assert.match(await dots(), /<i class="out" data-tip="Game on now: 4:12 - 3rd&lt;div class=&quot;tip-dim&quot;&gt;He&#39;s listed Out/, "listed Out: the red ring of a game he'll miss");
    p.status = wasStatus;
    live.games = [];
    assert.doesNotMatch(await onDay('2026-10-28', () => app.dayDots(p, { dates: ['2026-10-28'] }, true)), /class="live/, 'not once ESPN has nothing on');
  } finally {
    live.games = was;
    if (wasLines) live.lines.set('2026-10-28', wasLines); else live.lines.delete('2026-10-28');
  }
  const me = L.teams[0].id, other = L.teams[1].id;
  useTeam(me);
  assert.match(app.teamLink(me), /class="link-btn team-link mine"/, 'yours: orange');
  assert.doesNotMatch(app.teamLink(other), /mine/, "anyone else's: as it was");
});

test("Plan Ahead in a points league: each shooting pair is one column, 8.2/17.1 FG, never FGM and FGA apart", async () => {
  const text = html => ` ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const heads = html => [...html.matchAll(/<table class="stab[^"]*">\s*<thead>([\s\S]*?)<\/thead>/g)].map(m => text(m[1]));
  const apart = /FGM|FGA|FTM|FTA|3PA/;
  const L = await app.useLeague(ESPN); // scores FGM, FGA, FTM, FTA and 3PM (not 3PA)
  useTeam(L.teams[0].id);
  const ui = app.get('ui'), was = ui.boardMode;
  try {
    for (const mode of ['game', 'week']) {
      ui.boardMode = mode;
      const html = app.viewWeek(), h = heads(html);
      assert.ok(h.length && h.every(t => t.includes(' FG ') && t.includes(' FT ') && t.includes(' 3PM ') && !apart.test(t)), `${mode}: ${h.join(' | ')}`);
      assert.match(html, /title="FG: \d+\.\d\/\d+\.\d (per game|over \d+ games?) · [+−]?\d+\.\d FP">\d+(\.\d)?\/\d+(\.\d)?<\/td>/, `${mode}: makes/attempts in one cell`);
      if (html.includes('<tfoot>')) assert.match(html, /title="FG: \d+\.\d\/\d+\.\d · \d+% to win">\d+\/\d+<\/td>/, `${mode}: the projected week too`);
    }
  } finally { ui.boardMode = was; }
  // a finished week's tables (Sleeper's, its scoring given both halves of each pair)
  await sleeperWithResults('999000000000000005', 1, async S => {
    const pts = S.points;
    S.points = { ...pts, fgm: 1, fga: -1, ftm: 1, ftmi: -1, tpm: 1, tpa: -0.5 };
    try {
      useTeam(S.teams[0].id);
      ui.tab = 'week';
      await onDay('2026-11-03', async () => { app.pastWeekCard('2026-10-20'); await new Promise(r => setTimeout(r, 30)); });
      const card = await onDay('2026-11-03', () => app.pastWeekCard('2026-10-20'));
      const h = heads(card);
      assert.ok(h.length === 2 && h.every(t => t.includes(' FG ') && t.includes(' FT ') && t.includes(' 3PM ') && !apart.test(t) && !/miss/.test(t)), h.join(' | '));
      assert.match(card, /<td class="sc">\d+\/\d+<\/td>/, 'makes/attempts in one cell');
    } finally { S.points = pts; }
  });
});
