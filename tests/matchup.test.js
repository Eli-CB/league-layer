const { test, assert, sharedApp, readFixture, CATS9, ESPN, useTeam, between, onDay } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("a points league's shooting is one bubble a pair (10/19 FG, not FGM and FGA apart); category leagues' too", async () => {
  const line = { min: 34, pts: 27, reb: 8, tpm: 3, tpa: 7, fgm: 10, fga: 19, ftm: 4, fta: 5, gp1: 1 };
  const text = html => ` ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const L = await app.useLeague(ESPN); // scores FGM, FGA, FTM, FTA and 3PM (not 3PA)
  const was = L.points;
  try {
    const chips = text(app.lineChips(line));
    for (const s of [' 10/19 FG ', ' 4/5 FT ', ' 3 3PM ']) assert.ok(chips.includes(s), `${s} in${chips}`);
    assert.ok(!/FGM|FGA|FTM|FTA|3PA/.test(chips), chips);
    assert.match(app.fullLine(line, false).join(' · '), /10\/19 FG · 4\/5 FT/, 'the recap and its picture too');
    assert.match(app.fullLine({ ...line, fgm: 20, fga: 38, gp1: 2 }, true).join(' · '), /10\.0\/19\.0 FG/, 'a week: per game');
    // makes with misses are a pair too; a pair's two halves are never shown apart
    const { fga, ...rest } = was;
    L.points = { ...rest, tpa: -0.5, fgmi: -fga };
    const pairs = text(app.lineChips(line));
    for (const s of [' 10/19 FG ', ' 3/7 3PM ']) assert.ok(pairs.includes(s), `${s} in${pairs}`);
    assert.ok(!/miss|3PA|FGA/.test(pairs), pairs);
    // no attempts, no bubble
    assert.ok(!text(app.lineChips({ ...line, ftm: 0, fta: 0 })).includes(' FT '));
  } finally { L.points = was; }
  await app.useLeague(CATS9);
  const cats = text(app.lineChips(line));
  for (const s of [' 10/19 FG ', ' 4/5 FT ']) assert.ok(cats.includes(s), `${s} in${cats}`);
  assert.match(app.fullLine(line, false).join(' · '), /10\/19 FG · 4\/5 FT/);
  assert.match(app.fullLine({ ...line, fgm: 20, fga: 38, gp1: 2 }, true).join(' · '), /10\.0\/19\.0 FG \(\.526\)/);
});

test("the Dashboard's matchup: this matchup's days only", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  useTeam(app.fxLeague().teams[0].id);
  const days = async iso => JSON.parse(JSON.stringify(await onDay(iso, () => app.dashDays())));
  // Monday before tip-off: the period that ended last night is still this one, as on Fantrax until the new one's first
  // game (7 PM ET): its last night is Yesterday, and no Today
  const mon = await days('2026-10-26');
  assert.equal(mon.today, null);
  assert.equal(mon.day, '2026-10-25');
  assert.equal(mon.week.length, 6, 'last period, all of it (Oct 20-25)');
  // from tip-off: last night was last week's matchup, so no Yesterday; it opens on today
  try {
    app.setClock('2026-10-26T19:00:00-04:00');
    const now = JSON.parse(JSON.stringify(app.dashDays()));
    assert.equal(now.today, '2026-10-26');
    assert.equal(now.day, null);
    assert.deepEqual(now.week, ['2026-10-26']);
    const m = app.dashMatchupCard();
    assert.ok(m.includes('class="on" data-action="dash-range" data-range="today"') && !m.includes('data-range="day"'));
  } finally { app.setClock(); }
  // Wednesday: yesterday is Tuesday
  assert.equal((await days('2026-10-28')).day, '2026-10-27');
  // a day without NBA games (Election Day): it opens on yesterday, and Today is still there to say so
  const ui = app.get('ui');
  try {
    await onDay('2026-11-03', () => {
      const m = app.dashMatchupCard();
      assert.ok(m.includes('class="on" data-action="dash-range" data-range="day"') && m.includes('data-range="today"'));
      ui.dashRange = 'today';
      assert.match(app.dashMatchupCard(), /No NBA games today\./);
    });
  } finally { ui.dashRange = null; }
  // the tab's new name
  assert.ok(app.tabList().some(([k, l]) => k === 'players' && l === 'Players'));
});

test("the Matchup card's full-screen button, in place of its (i)", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  useTeam(app.fxLeague().teams[0].id);
  const ui = app.get('ui');
  try {
    await onDay('2026-10-28', () => {
      const m = app.dashMatchupCard();
      assert.ok(m.includes('data-action="dash-full" aria-pressed="false"') && !m.includes('class="info-btn"'));
      assert.ok(!m.includes('mu-card full'));
      assert.ok(!m.includes('mu-ph'), 'round photos off full screen');
      for (const r of ['today', 'day', 'week']) {
        ui.dashRange = r;
        ui.dashFull = true;
        const f = app.dashMatchupCard();
        assert.ok(f.includes('class="card mu-card full"') && f.includes('aria-pressed="true"'), `full screen on ${r}`);
      }
      // full screen: each player's full photo, as on his card; one that wouldn't load is drawn as the round one from then on
      const f = app.dashMatchupCard(), src = (f.match(/class="pc-photo mu-ph"[^>]*>(?:<img class="pc-logo"[^>]*>)?<img class="pc-shot" src="([^"]+)"/) || [])[1];
      assert.ok(src && !/decoding="async"/.test(f.split(src)[1].split('>')[0]), 'his full photo, shown as soon as it is in on a redraw');
      app.get('shotMiss').add(src);
      try {
        const g = app.dashMatchupCard();
        assert.ok(!g.includes(`src="${src}"`) && g.includes('mu-ph no-shot'));
      } finally { app.get('shotMiss').delete(src); }
    });
  } finally { ui.dashRange = null; ui.dashFull = false; }
});

test("the opponent's injured reserve: in the IR row, not on their bench or in their projection", async () => {
  const L = await app.useLeague(CATS9);
  const S = app.get('state'), saved = S.opp;
  try {
    const side = app.fxTeamSide(L.teams[1].id);
    const [a, b] = side.players;
    S.opp = { name: side.name, fxId: L.teams[1].id, players: side.players, starters: side.starters, il: [b.id] };
    const act = app.oppActive().map(p => p.id);
    assert.ok(act.includes(a.id) && !act.includes(b.id), 'their IR player is apart');
    S.opp = { ...S.opp, il: undefined };
    assert.deepEqual([...app.oppIlIds()], side.il, "a side saved before: their league's IR");
  } finally { S.opp = saved; }
  assert.match(app.slotBadge('IL'), />IR</, 'called IR');
});

test("a player's game on the Matchup tab is in a bubble, as on Fantrax: DET 144 @ WAS 140, a final green or red for his team", async () => {
  await app.useLeague(CATS9);
  await app.loadBoxes();
  const box = app.get('BOX'), live = app.get('live'), ui = app.get('ui'), was = live.games;
  // a player with a finished game, for the team he's on now
  const p = app.nbaPlayers().find(x => (box.byPlayer.get(x.nbaId) || []).some(g => g[3] === x.team));
  const d = box.byPlayer.get(p.nbaId).find(g => g[3] === p.team)[0], s = box.scores.get(`${d} ${p.team}`);
  try {
    live.games = [];
    // no "F": a final is tinted for his team's win or loss
    const won = s.home === p.team ? s.hs > s.as : s.as > s.hs;
    assert.equal(app.dashGame(p, d), `<span class="game-pill ${won ? 'gp-w' : 'gp-l'}">${s.away} ${s.as} @ ${s.home} ${s.hs}</span>`);
    box.scores.set(`${d} ${p.team}`, { ...s, hs: s.as, as: s.hs });
    try { assert.match(app.dashGame(p, d), new RegExp(`^<span class="game-pill ${won ? 'gp-l' : 'gp-w'}">`), 'the other result, the other color'); }
    finally { box.scores.set(`${d} ${p.team}`, s); }
    ui.hideScores = true; // no color either: it would give the result away
    assert.equal(app.dashGame(p, d), `<span class="game-pill">${s.home === p.team ? `vs ${s.away}` : `@${s.home}`} · Final</span>`, 'scores hidden: the opponent');
    ui.hideScores = false;
    // on now: the score in one piece, then the clock (on a phone only the clock goes to a second line)
    live.games = [{ d, home: s.home, away: s.away, hs: 88, as: 80, state: 'in', detail: '4:12 - 3rd', period: 3, clock: 252, start: new Date() }];
    assert.match(app.dashGame(p, d), new RegExp(`^<span class="game-pill"><span class="gp-part">${s.away} 80 @ ${s.home} 88</span> <span class="gp-part"><span class="lv-dot"[^>]*></span>Q3 4:12</span></span>$`));
    // before it: where and when
    live.games[0].state = 'pre';
    assert.match(app.dashGame(p, d), /^<span class="game-pill">(vs [A-Z]{2,3}|@[A-Z]{2,3}) \d/);
  } finally { live.games = was; ui.hideScores = false; }
});

test("Matchup: the dot by a game's clock is solid while he's on the floor, light while he's on the bench or between periods", async () => {
  await app.useLeague(CATS9);
  await app.loadBoxes();
  const live = app.get('live'), was = live.games, day = '2026-10-28';
  // ESPN's box score marks the five on the floor of each team `active`
  const sm = JSON.parse(readFixture('espn/live/summary-401909881.json'));
  for (const t of sm.boxscore.players) t.statistics[0].athletes.forEach((a, i) => { a.active = i < 5; });
  const floor = app.espnFloor(sm);
  assert.ok(floor.size >= 8 && floor.size <= 10, `five a team, matched to NBA ids: ${floor.size}`);
  // a game on now: one player on the floor, his teammate on the bench
  const p = app.nbaPlayers().find(x => (app.get('teamDates').get(x.team) || new Set()).has(day));
  const mate = app.nbaPlayers().find(x => x.team === p.team && x.nbaId !== p.nbaId);
  const g = { id: 'floor-test', d: day, home: p.team, away: 'ZZZ', hs: 50, as: 48, state: 'in', clock: 300, detail: '5:00 - 2nd', period: 2, start: new Date() };
  try {
    live.games = [g];
    live.floor.set(g.id, new Set([p.nbaId]));
    await onDay(day, () => {
      assert.equal(app.onFloor(p, day), true);
      assert.equal(app.onFloor(mate, day), false);
      const C = { D: { all: [day] }, dates: [day], range: 'day', today: day, hasOpp: true };
      const on = app.dashCell(C, p, false, true), off = app.dashCell(C, mate, false, true);
      assert.match(on, /<span class="gp-part"><span class="lv-dot" title="On the floor now" aria-label="On the floor now"><\/span>Q2 5:00<\/span>/);
      assert.match(off, /<span class="lv-dot out" title="On the bench now"[^>]*><\/span>Q2 5:00/);
      assert.ok(!/class="mu-p[^"]*live/.test(on + off), 'no green rows');
      // the Players tab too (its rows have the data's player, raw.id, not a row's nbaId): on the floor or on the bench, as on the Matchup
      assert.match(app.liveStatus(app.nbaById.get(p.nbaId), day), /^<span class="lv-dot" title="On the floor now"/);
      assert.match(app.liveStatus(app.nbaById.get(mate.nbaId), day), /^<span class="lv-dot out" title="On the bench now"/);
      // This period's "on now" dot on the Players tab is the same one
      assert.equal(app.liveDot(app.nbaById.get(mate.nbaId), day), '<span class="lv-dot out" title="On the bench now" aria-label="On the bench now"></span>');
      assert.ok(app.liveDot(app.nbaById.get(p.nbaId), day).includes('title="On the floor now"'));
      // between periods (the five who ended one) and after the buzzer: not known
      Object.assign(g, { detail: 'Halftime', clock: 0 });
      assert.equal(app.onFloor(p, day), null);
      assert.match(app.dashCell(C, p, false, true), /<span class="lv-dot out" title="Between periods"[^>]*><\/span>Half</, 'nobody plays at the half: light, and Half');
      Object.assign(g, { detail: '12:00 - 3rd', clock: 720 });
      assert.equal(app.onFloor(p, day), true, 'the third quarter under way');
      g.state = 'post';
      assert.equal(app.onFloor(p, day), null);
      // a game whose box score hasn't been read: not known either
      g.state = 'in';
      live.floor.delete(g.id);
      assert.equal(app.onFloor(p, day), null);
    });
  } finally { live.games = was; live.floor.delete(g.id); }
});
