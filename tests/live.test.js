const { test, assert, sharedApp, loadApp, readFixture, CATS9, ESPN, onDay, answer } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

// The saved box scores as they are now, and a function that puts them back (for a test that adds ESPN's finals to them)
function saveBox() {
  const BOX = app.get('BOX');
  const keep = { finals: [...BOX.finals], scores: new Map(BOX.scores), byPlayer: new Map([...BOX.byPlayer].map(([id, g]) => [id, [...g]])) };
  return () => {
    BOX.finals.clear(); keep.finals.forEach(x => BOX.finals.add(x));
    BOX.scores.clear(); keep.scores.forEach((v, k) => BOX.scores.set(k, v));
    BOX.byPlayer.clear(); keep.byPlayer.forEach((v, k) => BOX.byPlayer.set(k, v));
    BOX.day.clear(); for (const [id, games] of BOX.byPlayer) BOX.day.set(id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }])));
    delete app.get('gameLogs').cur;
  };
}

test("performances: today's games from ESPN's box scores, read in the browser as they're played", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const live = app.get('live');
  // one ESPN box score as stat lines, ESPN players matched to NBA.com's (the fixture data has no ESPN ids: by name and team)
  const sm = JSON.parse(readFixture('espn/live/summary-401909882.json'));
  const lines = app.espnLines(sm);
  const played = sm.boxscore.players.flatMap(t => t.statistics[0].athletes.filter(a => !a.didNotPlay && +a.stats[0] > 0));
  assert.ok(lines.size >= played.length - 1 && lines.size <= played.length, `${lines.size} of ${played.length} matched`);
  const top = played.reduce((a, b) => (+b.stats[1] > +a.stats[1] ? b : a));
  const raw = app.NBA.players.find(r => app.nameKey(r.name) === app.nameKey(top.athlete.displayName));
  const line = lines.get(raw.id);
  assert.equal(line.pts, +top.stats[1]);
  assert.equal(`${line.fgm}-${line.fga}`, top.stats[2]);
  assert.equal(line.gp1, 1);

  // Wednesday Oct 28, games under way (the saved box scores end on Oct 25)
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  const day = '2026-10-28';
  const urls = [];
  const realFetch = app.fetch;
  app.fetch = url => { urls.push(String(url)); return realFetch(url); };
  try {
    app.ui.tab = 'dashboard';
    await onDay(day, () => app.pollLive());
    assert.equal(live.error, '');
    assert.equal(live.day, day);
    assert.ok(live.timer, 'games on: the next update is scheduled');
    // the box score of every game under way or over; the week's earlier days, missing from the saved box scores, once
    const asked = urls.filter(u => u.includes('/summary?')).map(u => u.split('event=')[1]).sort();
    assert.deepEqual(asked, app.espnGames(sb).filter(g => g.state !== 'pre').map(g => g.id).sort());
    assert.ok(['20261026', '20261027'].every(d => urls.some(u => u.endsWith(`scoreboard?dates=${d}`))), urls.join('\n'));
    // the next update: the scoreboard again, but no box score whose game's score hasn't moved (and was read under a minute ago)
    urls.length = 0;
    live.at = 0;
    await onDay(day, () => app.pollLive());
    assert.ok(urls.some(u => u.endsWith('/scoreboard')) && !urls.some(u => u.includes('/summary?')), urls.join('\n'));
    const g = app.espnGames(sb).find(x => x.state === 'in');
    assert.ok(!app.boxDue(g));
    assert.ok(app.boxDue({ ...g, hs: g.hs + 2 }), 'a basket: read it again');

    await onDay(day, () => {
      assert.equal(app.perfDays().today, day);
      const rows = app.perfRows([day]);
      assert.equal(rows.length, app.liveLines(day).size, "everyone who's played today");
      assert.equal(rows.find(r => r.raw.id === raw.id).tot.pts, line.pts);
      const html = app.topPerformancesCard();
      assert.ok(html.includes('<option value="today" selected>'), 'it opens on today once games have started');
      assert.ok(html.includes('lv-dot') && /lv-dot[^>]*><\/span>Half\b/.test(html) && !html.includes('Halftime') && html.includes('Q4 2:08') && html.includes('updated '), 'the clock of each game still on ("Half", not "Halftime")');
      // a live update keeps the rows in place; anything else sorts them again
      const order = h => [...h.matchAll(/data-action="player-detail" data-nba="(\d+)"/g)].map(m => m[1]);
      const before = order(html);
      const last = app.liveLines(day).get(+before[before.length - 1]);
      const was = { ...last };
      Object.assign(last, { pts: last.pts + 60, reb: last.reb + 20, ast: last.ast + 20 });
      try {
        live.hold = true;
        assert.deepEqual(order(app.topPerformancesCard()), before, 'held in place');
        live.hold = false;
        assert.equal(order(app.topPerformancesCard())[0], before[before.length - 1], 'sorted again');
      } finally { live.hold = false; Object.assign(last, was); }

      // the Dashboard's matchup: both lineups slot by slot, each starter's game and line, and the categories each
      // side leads, counted from the starters' lines
      const L = app.fxLeague();
      // the team whose matchup has the most starters in today's games
      const on = id => { const S = app.fxTeamSide(id); return S.lineup.filter(pid => { const p = S.players.find(x => x.id === pid); return p && app.liveLines(day).has(p.nbaId); }).length; };
      const both = id => on(id) + on(app.fxOpponentFor(day, id).id);
      const tid = L.teams.map(t => t.id).sort((a, b) => both(b) - both(a))[0];
      const wasTeam = app.state.fxTeam;
      app.state.fxTeam = tid;
      try {
        const side = app.fxTeamSide(tid), opp = app.fxTeamSide(app.fxOpponentFor(day, tid).id);
        const starters = S => S.lineup.map(id => S.players.find(p => p.id === id)).filter(Boolean);
        const total = (S, ds) => { const t = {}; for (const p of starters(S)) for (const d of ds) { const l = app.lineOn(p, d); if (l) app.addLine(t, l); } return t; };
        const scores = h => [...h.matchAll(/class="mu-score">([^<]*)</g)].map(m => m[1]);
        const halves = x => [String(x.me + x.ties / 2), String(x.opp + x.ties / 2)]; // a tie counts half to each
        let m = app.dashMatchupCard();
        assert.ok(m.includes('class="on" data-action="dash-range" data-range="today"') && m.includes('>Yesterday<') && m.includes('data-range="week"'), 'today, yesterday, the week; on today');
        // one day: only who plays that day, each side's starters then its bench (always), no slot column
        const playing = list => list.filter(p => app.playsOn(p, day));
        const benchOf = S => S.players.filter(p => !S.lineup.includes(p.id));
        // anyone Out, or who sat out a finished game, goes last
        const sits = p => !app.lineOn(p, day) && (p.status === 'Out' || app.gameFinal(p, day) || (app.liveGame(p, day) || {}).state === 'post');
        const count = (list, out) => playing(list).filter(p => sits(p) === out).length;
        // each side one column with no gaps: starters, then the bench (tagged), then Out / DNP; rows pair them up
        const col = S => [...playing(starters(S)).filter(p => !sits(p)), ...playing(benchOf(S)).filter(p => !sits(p)), ...playing(starters(S)).filter(sits), ...playing(benchOf(S)).filter(sits)];
        assert.equal((m.match(/class="mu-row day"/g) || []).length, Math.max(col(side).length, col(opp).length), 'as many rows as the longer side');
        const left = [...m.matchAll(/<div class="mu-row day"><div class="mu-p([^"]*)"[\s\S]*?data-nba="(\d+)"/g)].map(x => +x[2]);
        const group = id => { const p = col(side).find(x => x.nbaId === id); return (sits(p) ? 2 : 0) + (starters(side).includes(p) ? 0 : 1); };
        assert.deepEqual([...left].sort(), col(side).map(p => p.nbaId).sort(), 'my side: everyone who plays, no gaps');
        // by game: on now, then finished, then still to come (starters before the bench within each: a bench player in a
        // game now is above a starter whose game hasn't begun); anyone Out or sitting, last
        const stageOf = id => { const p = col(side).find(x => x.nbaId === id), g = app.liveGame(p, day); return g && g.state === 'in' ? 0 : app.gameFinal(p, day) || (g && g.state === 'post') ? 1 : 2; };
        const rank = id => (group(id) >= 2 ? 100 + group(id) : stageOf(id) * 2 + group(id));
        assert.deepEqual(left.map(rank), left.map(rank).sort((x, y) => x - y), 'on now, finished, to come (starters first in each); then out');
        const firstBenchLive = left.findIndex(id => group(id) === 1 && stageOf(id) === 0), firstStarterLater = left.findIndex(id => group(id) === 0 && stageOf(id) === 2);
        if (firstBenchLive >= 0 && firstStarterLater >= 0) assert.ok(firstBenchLive < firstStarterLater, 'a bench player playing now above a starter still to play');
        assert.ok(left.some(id => stageOf(id) === 0), 'a game on now in this matchup');
        const benchTagged = S => playing(benchOf(S)).filter(p => p.status !== 'Out').length;
        assert.equal((m.match(/badge bench">Bench</g) || []).length, benchTagged(side) + benchTagged(opp), "bench players tagged (not one who's Out: that says enough)");
        const shown = [...m.matchAll(/data-action="player-detail" data-nba="(\d+)"/g)].map(x => +x[1]);
        assert.ok(shown.length && shown.every(id => app.playsOn(app.playerFromRaw(app.nbaById.get(id)), day)), 'nobody without a game');
        assert.ok(!m.includes('mu-slot') && !m.includes('dash-bench'), 'no slot column, no bench button');
        // beside each score: starter games this period played / on now / to come, and game minutes left
        const games = app.espnGames(sb);
        assert.equal(app.gameMinLeft(games.find(g => g.detail === 'Halftime')), 24);
        assert.equal(+app.gameMinLeft(games.find(g => g.detail === '2:08 - 4th')).toFixed(2), 2.13);
        assert.equal(app.gameMinLeft({ state: 'pre' }), 48);
        const pc = [...m.matchAll(/<b>(\d+)<\/b><span class="(?:pos-good)?">(\d+)<\/span><span class="muted">(\d+)<\/span>/g)].map(x => x.slice(1).map(Number));
        assert.equal(pc.length, 2, 'one for each side');
        const period = app.dashDays().all;
        const scheduled = S => starters(S).reduce((n, p) => n + period.filter(d => app.playsOn(p, d)).length, 0);
        pc.forEach(([played, now, left], i) => assert.ok(played + now + left <= scheduled([side, opp][i]) && now > 0 === pc[i][1] > 0));
        assert.ok(pc.some(x => x[1] > 0), 'someone is on now');
        const sc = app.weekScore(total(side, [day]), total(opp, [day]));
        const week = app.dashDays().week;
        assert.deepEqual([...week], ['2026-10-26', '2026-10-27', day]);
        const wk = app.weekScore(total(side, week), total(opp, week));
        assert.deepEqual(scores(m), halves(wk), 'the big numbers: the period so far');
        assert.ok(m.includes(`title="${app.fmtDay('2026-10-26')} – ${app.fmtDay('2026-11-01')}">This period<`), "the league's whole matchup period, from its schedule");
        assert.ok(!/tied/.test(m), 'ties only as halves');
        assert.equal((m.match(/class="mu-lead"/g) || []).length, sc.me + sc.opp, "each category led today is marked");
        const p = [...starters(side), ...starters(opp)].find(x => app.liveLines(day).has(x.nbaId));
        assert.ok(p, "someone in this matchup is playing today");
        const pl = app.liveLines(day).get(p.nbaId);
        assert.ok(m.includes(`<b>${pl.pts}</b> PTS`), "a starter's line");
        assert.ok(!/<b>0<\/b> |<b>0\/0<\/b> /.test(m), "no bubble for a stat he didn't put up");
        assert.ok(/<b>\d+\/\d+<\/b> FG/.test(m) && !/<b>\d+-\d+<\/b>/.test(m), 'shooting as makes/attempts, "5/12 FG"');
        assert.ok(m.includes('lv-dot'), 'a game still on shows its clock');
        // a live update flashes the bubbles that moved: green for a basket, red for a turnover or a missed free throw
        const pl2 = app.liveLines(day).get(p.nbaId), was2 = { ...pl2 };
        try {
          Object.assign(pl2, { pts: pl2.pts + 2, fgm: pl2.fgm + 1, fga: pl2.fga + 1, to: pl2.to + 1, fta: pl2.fta + 1 });
          live.hold = true;
          const f = app.dashMatchupCard();
          const chip = label => (f.match(new RegExp(`<span class="mu-chip([^"]*)"><b>[^<]*</b> ${label}<`)) || [])[1];
          assert.equal(chip('PTS'), ' flash-good', 'points up');
          assert.equal(chip('FG'), ' flash-good', 'a make');
          assert.equal(chip('TO'), ' flash-bad', 'a turnover');
          assert.equal(chip('FT'), ' flash-bad', 'a missed free throw');
          assert.ok(!chip('REB'), "rebounds didn't move: no flash");
          live.hold = false;
          assert.ok(!app.dashMatchupCard().includes('flash-'), 'only on a live update');
        } finally { live.hold = false; Object.assign(pl2, was2); }
        // Hide game scores: the clock and the opponent, no score
        const g0 = app.espnGames(sb).find(g => g.state === 'in');
        const scoreTxt = `${g0.away} ${g0.as} @ ${g0.home} ${g0.hs}`;
        const asText = h => h.replace(/<[^>]*>/g, ''); // (the team codes are links: the text as it reads)
        assert.ok(asText(m).includes(scoreTxt), 'scores by default');
        app.ui.hideScores = true;
        try {
          const hidden = app.dashMatchupCard();
          assert.ok(!asText(hidden).includes(scoreTxt) && !/[A-Z]{3} \d+ @ [A-Z]{3} \d+/.test(asText(hidden)), 'no score anywhere');
          assert.ok(hidden.includes('lv-dot'), 'still the clock');
        } finally { app.ui.hideScores = false; }
        app.ui.dashRange = 'week';
        m = app.dashMatchupCard();
        assert.equal((m.match(/class="mu-row"/g) || []).length, app.state.slots.length, 'the period: one row per starting slot; the bench hidden');
        app.ui.dashBench = true;
        const bench = Math.max(side.players.length - side.lineup.filter(Boolean).length - side.il.length, opp.players.length - opp.lineup.filter(Boolean).length - opp.il.length);
        assert.ok((app.dashMatchupCard().match(/class="mu-row bench"/g) || []).length >= bench, 'the bench, on request');
        assert.deepEqual(scores(m), halves(wk), 'the period so far');
        assert.equal((m.match(/class="mu-lead"/g) || []).length, wk.me + wk.opp, "each category led this week is marked");
        assert.match(m, /\d G · \d left/);
      } finally { app.state.fxTeam = wasTeam; app.ui.dashBench = false; app.ui.dashRange = null; }
    });
    // last night's games picked: no more updates, on the Dashboard or in Performances (Players)
    app.ui.dashRange = 'day';
    app.scheduleLive();
    assert.equal(live.timer, null);
    app.ui.dashRange = null;
    app.ui.tab = 'players';
    app.ui.perfRange = 'day';
    app.scheduleLive();
    assert.equal(live.timer, null);
  } finally {
    app.ui.perfRange = null; app.ui.dashRange = null; app.ui.tab = 'standings';
    clearTimeout(live.timer);
    live.timer = null;
    live.lines.clear(); live.games = []; live.done.clear(); live.read.clear(); live.at = 0;
    app.fetch = realFetch;
  }
});

test('live box scores: one game ESPN fails on is asked for again, the others still count', async () => {
  const live = app.get('live');
  const realGet = app.getJson;
  const sm = JSON.parse(readFixture('espn/live/summary-401909882.json'));
  await app.useLeague(CATS9);
  await app.loadBoxes();
  const restore = saveBox(); // (a finished game goes in with the saved box scores)
  app.getJson = async url => { if (url.includes('event=bad')) throw new Error('ESPN 500'); return sm; };
  try {
    const failed = await app.readBoxes([{ id: 'bad', d: '2026-10-28', state: 'post' }, { id: 'good', d: '2026-10-28', state: 'post' }]);
    assert.equal(failed, 1);
    assert.ok(live.lines.get('2026-10-28').size > 5, "the game that answered is read");
    assert.ok(live.done.has('good') && !live.done.has('bad'), 'the failed one is tried again next time');
    await assert.rejects(app.readBoxes([{ id: 'bad', d: '2026-10-28', state: 'post' }]), /ESPN 500/, 'all of them failing is an error');
  } finally { app.getJson = realGet; live.lines.clear(); live.done.clear(); restore(); }
});

test("the morning: ESPN's scoreboard still on last night's games, today's tip-offs come from today's own", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const live = app.get('live'), d = '2026-10-28';
  const keep = { games: live.games, day: live.day, lines: live.lines, done: live.done, read: live.read, at: live.at, tried: live.tried, error: live.error, off: app.get('liveFeed').off };
  // ESPN's answer without a date: Tuesday's (its finals saved or not, beside the point here); Wednesday's own: the saved evening, before tip-off
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  for (const e of sb.events) { e.status.type.state = 'pre'; for (const c of e.competitions[0].competitors) c.score = '0'; }
  const urls = [], realFetch = app.fetch;
  const answer = body => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  app.fetch = url => { const u = String(url); urls.push(u); return u.endsWith('/scoreboard') ? answer({ day: { date: '2026-10-27' }, events: [] }) : u.endsWith(`scoreboard?dates=${d.replace(/-/g, '')}`) ? answer(sb) : realFetch(url); };
  const at = async (t, fn) => { const RealDate = app.Date; app.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; try { return await fn(); } finally { app.Date = RealDate; } };
  try {
    Object.assign(live, { games: [], lines: new Map(), done: new Set(), read: new Map(), at: 0, tried: 0, error: '' });
    app.ui.tab = 'dashboard';
    const games = app.espnGames(sb), first = Math.min(...games.map(g => +g.start));
    await at(Date.parse(`${d}T09:00:00-04:00`), () => app.pollLive());
    assert.equal(live.error, '');
    assert.equal(live.games.filter(g => g.d === d).length, games.length, "today's games, from today's scoreboard");
    assert.ok(urls.includes('https://api.leaguelayer.com/espn/basketball/nba/scoreboard?dates=20261028'), 'hours before tip-off: the Worker\'s copy');
    // the Matchup tab: each player's game with its tip-off, not just the opponent
    const g = games[0], raw = app.NBA.players.find(r => r.team === g.home);
    const p = { ...raw, nbaId: raw.id };
    const bubble = await at(Date.parse(`${d}T09:00:00-04:00`), () => app.dashGame(p, d));
    assert.ok(bubble.includes(`vs ${g.away} ${app.fmtTime(g.start)}`), bubble);
    // close to the first tip-off: ESPN itself, fresh
    urls.length = 0;
    live.at = 0; live.tried = 0;
    await at(first - 5 * 60e3, () => app.pollLive());
    assert.ok(urls.includes('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261028'), urls.join('\n'));
    // once ESPN's scoreboard has today's games, nothing more is asked
    urls.length = 0;
    live.at = 0; live.tried = 0;
    app.fetch = url => { const u = String(url); urls.push(u); return u.endsWith('/scoreboard') ? answer({ ...sb, day: { date: d } }) : realFetch(url); };
    await at(Date.parse(`${d}T13:00:00-04:00`), () => app.pollLive());
    assert.ok(!urls.some(u => u.includes('dates=20261028')), urls.join('\n'));
    assert.equal(live.games.length, games.length, 'no game twice');
  } finally {
    app.fetch = realFetch;
    clearTimeout(live.timer); live.timer = null;
    app.get('liveFeed').off = keep.off;
    delete keep.off;
    Object.assign(live, keep);
  }
});

test("a game ESPN has over goes in with the saved box scores that night: Plan Ahead's schedule fills its dot", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const live = app.get('live'), BOX = app.get('BOX'), d = '2026-10-28';
  const keepLive = { games: live.games, day: live.day, lines: live.lines, done: live.done, read: live.read, at: live.at, tried: live.tried, error: live.error };
  const restore = saveBox();
  // the saved evening, IND at PHI over
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  sb.events.find(e => e.id === '401909884').status.type.state = 'post';
  const realFetch = app.fetch;
  app.fetch = url => (String(url).endsWith('/scoreboard') ? Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(sb) }) : realFetch(url));
  try {
    Object.assign(live, { games: [], lines: new Map(), done: new Set(), read: new Map(), at: 0, tried: 0, error: '' });
    app.ui.tab = 'week'; app.ui.weekShift = 0;
    app.get('gameLogs').cur = {};
    await onDay(d, () => app.pollLive());
    assert.equal(live.error, '');
    assert.ok(BOX.finals.has(`${d} PHI`) && BOX.finals.has(`${d} IND`), 'the final is saved');
    assert.ok(!BOX.finals.has(`${d} ATL`), 'a game still on is not');
    assert.ok(!('cur' in app.get('gameLogs')), 'what was built on the saved box scores is built again');
    const [id, line] = [...app.liveLines(d)].find(([pid]) => app.nbaById.get(pid) && app.nbaById.get(pid).team === 'PHI');
    const p = { ...app.nbaById.get(id), nbaId: id };
    assert.equal(app.actualLine(p, d).pts, line.pts);
    const dots = await onDay(d, () => app.dayDots(p, { dates: [d] }, true));
    assert.ok(/class="done/.test(dots), dots);
    // the next update doesn't read it, or save it, again
    const n = BOX.byPlayer.get(id).length;
    live.at = 0; live.tried = 0;
    await onDay(d, () => app.pollLive());
    assert.equal(BOX.byPlayer.get(id).length, n);
  } finally {
    app.fetch = realFetch;
    clearTimeout(live.timer); live.timer = null;
    Object.assign(live, keepLive);
    app.ui.tab = 'dashboard';
    restore();
  }
});

test("the night a week ends: its last games from ESPN, before the daily job saves them", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const BOX = app.get('BOX'), wk1 = L.periods[0], d = '2026-10-25';
  // Sunday's DET at PHI isn't saved yet
  const keep = { finals: [...BOX.finals], scores: new Map(BOX.scores), byPlayer: new Map([...BOX.byPlayer].map(([id, g]) => [id, [...g]])) };
  BOX.finals.delete(`${d} PHI`); BOX.finals.delete(`${d} DET`);
  for (const [id, games] of BOX.byPlayer) BOX.byPlayer.set(id, games.filter(g => !(g[0] === d && ['PHI', 'DET'].includes(g[3]))));
  // ESPN has it final: its scoreboard that day, made from a saved one (PHI's box score; IND's players aren't in this game)
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  const ev = sb.events.find(e => e.id === '401909884'), det = sb.events.find(e => e.id === '401909883').competitions[0].competitors.find(c => c.team.abbreviation === 'DET');
  const comps = ev.competitions[0].competitors;
  comps[comps.findIndex(c => c.team.abbreviation === 'IND')] = { ...det, homeAway: comps.find(c => c.team.abbreviation === 'IND').homeAway };
  Object.assign(ev, { date: `${d}T23:00Z` });
  ev.status.type.state = 'post';
  const day = { ...sb, day: { date: d }, events: [ev] };
  const urls = [], realFetch = app.fetch;
  app.fetch = url => { urls.push(String(url)); return String(url).endsWith('scoreboard?dates=20261025') ? Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(day) }) : realFetch(url); };
  try {
    app.get('boxFill').at = 0;
    await onDay(d, async () => {
      assert.deepEqual(JSON.parse(JSON.stringify(app.weekDaysToFill(L))), [d], 'the week ends today, and a game of it is missing');
      assert.equal(app.periodOver(wk1), false);
      assert.equal(await app.fillWeekFromEspn(L), 1, 'one game read');
      assert.ok(urls.some(u => u.endsWith('summary?event=401909884')));
      assert.equal(app.periodOver(wk1), true, 'the week is over: its recap can show');
      assert.ok(app.finishedPeriods(L).some(p => p.n === 1));
      const phi = [...BOX.byPlayer].filter(([, g]) => g.some(x => x[0] === d && x[3] === 'PHI'));
      assert.ok(phi.length >= 5, "PHI's players have the game");
      const ind = m => [...m].filter(([, g]) => g.some(x => x[0] === d && x[3] === 'IND')).length;
      assert.equal(ind(BOX.byPlayer), ind(keep.byPlayer), "no one from a team that wasn't in it (IND's own game that day stays as saved)");
      assert.ok(!('cur' in app.get('gameLogs')), 'the game log is built again');
      urls.length = 0;
      assert.equal(await app.fillWeekFromEspn(L), 0, 'nothing left to fill');
      assert.equal(urls.length, 0, 'and nothing asked');
    });
  } finally {
    app.fetch = realFetch;
    BOX.finals.clear(); keep.finals.forEach(x => BOX.finals.add(x));
    BOX.scores.clear(); keep.scores.forEach((v, k) => BOX.scores.set(k, v));
    BOX.byPlayer.clear(); keep.byPlayer.forEach((v, k) => BOX.byPlayer.set(k, v));
    BOX.day.clear(); for (const [id, games] of BOX.byPlayer) BOX.day.set(id, new Map(games.map(([dd, st, margin]) => [dd, { ...st, margin }])));
    delete app.get('gameLogs').cur;
  }
});

test("an injury entry goes once he's played since it was written: questionable, then played", async () => {
  await app.loadBoxes();
  const BOX = app.get('BOX');
  const [id, days] = [...BOX.day].find(([, m]) => m.size >= 2);
  const last = [...days.keys()].sort().pop();
  const raw = app.NBA.players.find(r => r.id === id), saved = raw.inj;
  try {
    raw.inj = { status: 'DTD', label: 'Day-To-Day', note: 'questionable for tonight', date: last };
    assert.equal(app.dropPlayedInjuries(), true);
    assert.equal(raw.inj, null, 'played that night: no longer listed');
    raw.inj = { status: 'Out', label: 'Out', note: 'ankle', date: app.addDays(last, 1) };
    assert.equal(app.dropPlayedInjuries(), false);
    assert.equal(raw.inj.status, 'Out', "hurt after his last game: still listed");
    // a game tonight, from ESPN's live lines
    app.get('live').lines.set(app.addDays(last, 2), new Map([[id, { min: 30, pts: 20 }]]));
    assert.equal(app.dropPlayedInjuries(), true);
    assert.equal(raw.inj, null, 'and played tonight');
  } finally {
    raw.inj = saved;
    app.get('live').lines.clear();
  }
});

test("ESPN's injury report read again through the day: new entries in, healed players out, ones it can't place kept", async () => {
  await app.loadBoxes();
  const players = app.NBA.players.filter(r => r.team && !r.inj).slice(0, 7);
  const [a, b, c, d, e, f, g] = players;
  const saved = players.map(r => r.inj);
  const entry = (r, status, date = '2026-10-26') => ({ status, date: `${date}T18:00Z`, shortComment: `${r.name} news`, athlete: { displayName: r.name, team: { abbreviation: r.team, id: '0' }, links: [] } });
  const prevG = g.inj;
  try {
    g.inj = { status: 'Out', label: 'Out', note: 'old', date: '2026-10-20' }; // was on the morning's report, not on ESPN's now
    f.inj = { status: 'DTD', label: 'Day-To-Day', note: 'kept', date: '2026-10-26' }; // ESPN lists him under a name the page can't place
    const feed = { injuries: [{ id: '1', injuries: [entry(a, 'Out'), entry(b, 'Day-To-Day'), entry(c, 'Suspension'), entry(d, 'Out'), entry(e, 'Day-To-Day'),
      { ...entry(f, 'Day-To-Day'), athlete: { displayName: f.name, team: { abbreviation: 'ZZZ', id: '0' }, links: [] } }] }] }; // (on a team the page doesn't know)
    assert.ok(app.applyInjuries(feed) >= 6);
    assert.equal(a.inj.status, 'Out');
    assert.equal(b.inj.status, 'DTD');
    assert.equal(c.inj.status, 'Out', 'suspended counts as Out');
    assert.equal(b.inj.date, '2026-10-26');
    assert.equal(g.inj, null, 'off the report now');
    assert.equal(f.inj.note, 'kept', "one it can't place keeps the morning's entry");
    // empty or nearly empty: not believed
    assert.equal(app.applyInjuries({ injuries: [] }), 0);
    assert.equal(a.inj.status, 'Out');
  } finally { players.forEach((r, i) => { r.inj = saved[i]; }); g.inj = prevG; }
});

test("the injury report through the day: the Worker's injury watch first (what changed, and when), ESPN's when it can't answer, on a timer while on screen", async () => {
  const a = loadApp();
  await a.ready();
  const players = a.NBA.players.filter(r => r.team && !r.inj).slice(0, 6);
  const entry = (r, status, extra = {}) => ({ status, date: '2026-10-26T18:00Z', shortComment: `${r.name} news`, athlete: { displayName: r.name, team: { abbreviation: r.team, id: '0' }, links: [] }, ...extra });
  const espnReport = { injuries: [{ injuries: players.map(r => entry(r, 'Day-To-Day')) }] };
  let watch = null; // the watch's answer (null: not deployed yet, 404)
  const real = a.fetch, asked = [];
  const answer = body => Promise.resolve(body ? { ok: true, status: 200, text: async () => JSON.stringify(body) } : { ok: false, status: 404 });
  a.fetch = (u, o) => {
    const s = String(u);
    asked.push(s);
    if (s.includes('/injuries/basketball/nba')) return answer(watch);
    if (s.endsWith('/espn/basketball/nba/injuries')) return answer(espnReport);
    return real(u, o);
  };
  const injFeed = a.get('injFeed');
  for (let i = 0; injFeed.busy && i < 200; i++) await new Promise(r => setTimeout(r, 5)); // (the page's own first read, at load)
  Object.assign(injFeed, { at: 0, watchOff: 0 });
  try {
    // the watch not answering: ESPN's report, through the Worker's /espn/
    await a.refreshInjuries();
    assert.deepEqual(asked.slice(0, 2), ['https://api.leaguelayer.com/injuries/basketball/nba', 'https://api.leaguelayer.com/espn/basketball/nba/injuries']);
    const p = players[0];
    assert.equal(p.inj.status, 'DTD');
    assert.equal(p.inj.at, '2026-10-26T18:00Z', "ESPN's time for the entry");
    assert.ok(!('was' in p.inj) && !a.injFresh(p.inj), 'not a change the watch saw');
    assert.match(a.injWhen(p.inj), /^updated /, 'which may be only a newer note');
    assert.ok(injFeed.timer, 'the next read set');
    // read again when due (every 3 minutes on a game day, else 15): the watch not asked again for 10 minutes
    const gameDay = [...a.get('teamDates').values()].some(ds => ds.has(a.todayIso()));
    assert.equal(a.injEvery(), gameDay ? 3 * 60e3 : 15 * 60e3);
    asked.length = 0;
    injFeed.at = 0;
    await a.refreshInjuries();
    assert.ok(!asked.some(u => u.includes('/injuries/basketball/nba')) && asked.length === 1);
    // the watch answering: ruled out 10 minutes ago, Day-To-Day before
    a.setClock('2026-10-26T20:11:00-04:00');
    watch = { v: 1, at: a.Date.now(), injuries: [{ injuries: players.map((r, i) => entry(r, i ? 'Day-To-Day' : 'Out', i ? { since: '2026-10-26T18:00Z' } : { since: '2026-10-27T00:01:00.000Z', was: 'Day-To-Day' })) }] };
    asked.length = 0;
    injFeed.at = 0;
    await a.refreshInjuries();
    assert.deepEqual(asked, ['https://api.leaguelayer.com/injuries/basketball/nba'], 'the watch alone');
    assert.deepEqual([p.inj.status, p.inj.was, p.inj.at], ['Out', 'Day-To-Day', '2026-10-27T00:01:00.000Z']);
    assert.ok(a.injFresh(p.inj));
    assert.match(a.injWhen(p.inj), /^since \d.*\(was Day-To-Day\)$/, 'a time of today, without the day');
    const badge = a.injBadge(p.inj);
    assert.match(badge, /class="badge inj bad fresh"/);
    assert.match(badge, /title="Out since [^"]*\(was Day-To-Day\): /);
    assert.ok(!a.injFresh(players[1].inj) && !/fresh/.test(a.injBadge(players[1].inj)));
    // three hours on: no longer new, still since then
    a.setClock('2026-10-26T23:30:00-04:00');
    assert.ok(!a.injFresh(p.inj) && !/fresh/.test(a.injBadge(p.inj)));
    assert.match(a.injWhen(p.inj), /^since [^(]+$/);
    // hidden: no timer of its own
    a.document.hidden = true;
    await a.refreshInjuries();
    assert.equal(injFeed.timer, null);
  } finally { a.fetch = real; a.document.hidden = false; a.setClock(); clearTimeout(injFeed.timer); players.forEach(r => { r.inj = null; }); }
});

test('a failing feed is asked less and less often: 30 s, then 1, 2, 4 minutes, 5 at most, and back at once when it answers', () => {
  const app2 = loadApp();
  const fails = app2.get('feedFails');
  const wait = n => { fails.x = n; return app2.feedWait('x', 30e3) / 1e3; };
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(wait), [30, 60, 120, 240, 300, 300]);
  fails.y = 3;
  assert.equal(app2.feedWait('y', 120e3), 300e3, 'Sleeper basketball: 2 minutes, at most 5 too');
  app2.noteLiveOk('x');
  assert.equal(app2.feedWait('x', 30e3), 30e3);
});

test("ESPN not answering the site: after two misses in a row (the site itself answering) its feeds come through the Worker, for a while", async () => {
  const a = loadApp();
  await a.ready();
  a.location.hostname = 'leaguelayer.com';
  const real = a.fetch, asked = [], sent = [], net = { espn: false, site: true };
  a.fetch = (u, o) => {
    const s = String(u);
    asked.push(s);
    if (s.includes('/errors')) { sent.push(JSON.parse(o.body)); return Promise.resolve({}); }
    if (s === 'index.html') return net.site ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline'));
    if (s.includes('site.api.espn.com') && !net.espn) return Promise.resolve({ ok: false, status: 403 });
    return real(u, o);
  };
  const ls = a.localStorage, key = 'league-layer-espn-route';
  ls.removeItem(key);
  try {
    await assert.rejects(a.espnSite('scoreboard'), /403/, 'one miss: an error, as before');
    // (the scoreboard: the injury report is pooled, through the Worker first, on purpose)
    assert.ok(!asked.some(u => u.includes('api.leaguelayer.com/espn/basketball/nba/scoreboard')));
    // the visitor offline: not ESPN's fault, no switch
    net.site = false;
    await assert.rejects(a.espnSite('scoreboard'), /403/);
    assert.ok(!asked.some(u => u.includes('api.leaguelayer.com/espn/basketball/nba/scoreboard')), 'no switch while the site itself is unreachable');
    net.site = true;
    const sb = await a.espnSite('scoreboard');
    assert.ok(sb.events && sb.events.length, 'the second miss in a row: the same scoreboard, through the Worker');
    assert.ok(asked.includes('https://api.leaguelayer.com/espn/basketball/nba/scoreboard'));
    assert.ok(+ls.getItem(key) > a.Date.now() + 5 * 36e5, "remembered for six hours (by the page's clock)");
    assert.equal(sent.length, 1);
    assert.match(sent[0].msg, /^ESPN not answering the site directly \(ESPN answered 403\): its feeds come through the Worker/);
    // from now on, straight to the Worker
    asked.length = 0;
    await a.espnSite('summary?event=401909881');
    assert.deepEqual(asked, ['https://api.leaguelayer.com/espn/basketball/nba/summary?event=401909881']);
    // six hours on, ESPN is tried directly again
    ls.setItem(key, String(a.Date.now() - 1));
    net.espn = true;
    asked.length = 0;
    await a.espnSite('scoreboard');
    assert.deepEqual(asked, ['https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard']);
  } finally { ls.removeItem(key); a.fetch = real; }
});

test("live scores: the page reads the Worker's live feed first (one request), ESPN for what it lacks or when it's down", async () => {
  await app.useLeague(CATS9);
  await app.loadBoxes();
  const live = app.get('live'), feedState = app.get('liveFeed'), ui = app.get('ui');
  const day = '2026-10-28';
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  const games = app.espnGames(sb).filter(g => g.state !== 'pre');
  const realFetch = app.fetch, asked = [];
  let feedAt = Date.parse(`${day}T23:00:00Z`), feedUp = true, stale = null;
  const feed = () => ({ v: 1, at: feedAt, scoreboard: sb, boxes: Object.fromEntries(games.map(g => [g.id, { at: g.id === stale ? feedAt - 60e3 : feedAt, final: g.state === 'post', box: JSON.parse(readFixture(`espn/live/summary-${g.id}.json`)) }])) });
  app.fetch = (u, o) => {
    const s = String(u);
    asked.push(s);
    if (s === 'https://api.leaguelayer.com/live/basketball/nba') return Promise.resolve(feedUp ? { ok: true, status: 200, text: async () => JSON.stringify(feed()) } : { ok: false, status: 404 });
    return realFetch(u, o);
  };
  const reset = () => { live.lines.clear(); live.done.clear(); live.read.clear(); live.floor.clear(); live.at = 0; feedState.off = 0; asked.length = 0; };
  const espn = () => asked.filter(u => u.includes('site.api.espn.com'));
  try {
    ui.tab = 'dashboard';
    reset();
    await onDay(day, () => app.pollLive());
    clearTimeout(live.timer);
    assert.equal(live.error, '');
    assert.ok(asked.includes('https://api.leaguelayer.com/live/basketball/nba'));
    assert.deepEqual(espn().filter(u => !u.includes('dates=') && !u.includes('injuries')), [], "today's scoreboard and every box score from the feed: ESPN not asked");
    assert.ok(live.lines.get(day) && live.lines.get(day).size > 20, "everyone who's played, from the feed's box scores");
    // a game whose box score in the feed is a minute old (few people watching): that one from ESPN
    reset();
    stale = games.find(g => g.state === 'in').id;
    await onDay(day, () => app.pollLive());
    clearTimeout(live.timer);
    assert.deepEqual(espn().filter(u => u.includes('summary')), [`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${stale}`]);
    stale = null;
    // the feed not there (the Worker not deployed with it, or down): ESPN directly, as before, and the feed left alone for 10 minutes
    reset();
    feedUp = false;
    await onDay(day, () => app.pollLive());
    clearTimeout(live.timer);
    assert.ok(espn().some(u => u.endsWith('/scoreboard')) && espn().some(u => u.includes('summary')), 'ESPN directly');
    assert.ok(feedState.off > Date.parse(`${day}T12:00:00-04:00`) + 9 * 60e3, 'not asked again for 10 minutes');
    asked.length = 0;
    live.at = 0;
    await onDay(day, () => app.pollLive());
    clearTimeout(live.timer);
    assert.ok(!asked.includes('https://api.leaguelayer.com/live/basketball/nba'), 'meanwhile, ESPN directly without trying it');
  } finally { app.fetch = realFetch; reset(); ui.tab = 'standings'; clearTimeout(live.timer); live.timer = null; }
});

test("ESPN failing again and again reaches the error log, a visitor's own connection doesn't", async () => {
  const setup = async ({ own = true, online = true } = {}) => {
    const a = loadApp();
    await a.ready();
    a.location.hostname = 'leaguelayer.com';
    a.navigator.onLine = online;
    const real = a.fetch, sent = [], net = { espn: false };
    a.fetch = (u, o) => {
      const s = String(u);
      if (s.includes('/errors')) { sent.push(JSON.parse(o.body)); return Promise.resolve({}); }
      if (s === 'index.html') return own ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline'));
      // ESPN down for everyone: the Worker's way to it too
      if ((s.includes('site.api.espn.com') || s.includes('api.leaguelayer.com/espn/')) && !net.espn) return Promise.resolve({ ok: false, status: 403 });
      return real(u, o);
    };
    a.get('ui').tab = 'dashboard';
    const poll = async n => { for (let i = 0; i < n; i++) await a.pollLive(); clearTimeout(a.get('live').timer); };
    return { a, sent, net, poll };
  };
  const { sent, poll } = await setup();
  await poll(2);
  assert.equal(sent.length, 0, 'a blip says nothing');
  await poll(1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, 'ESPN live scores failing (NBA): ESPN answered 403');
  await poll(4);
  assert.equal(sent.length, 1, 'once a visit');
  // recovering starts the count again
  const b = await setup();
  await b.poll(2);
  b.net.espn = true;
  await b.poll(1);
  assert.equal(b.a.get('live').error, '');
  b.net.espn = false;
  await b.poll(2);
  assert.equal(b.sent.length, 0);
  // the visitor's own connection isn't ESPN's problem
  const off = await setup({ own: false });
  await off.poll(3);
  assert.equal(off.sent.length, 0, 'this site is out of reach too');
  const plane = await setup({ online: false });
  await plane.poll(3);
  assert.equal(plane.sent.length, 0, 'offline');
});
