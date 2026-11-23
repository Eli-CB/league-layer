const { test, assert, sharedApp, CATS9, ESPN, onDay } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("a past season is graded from its games inside the league's season, inactive players included", async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  await app.loadGameLog('2025-26');
  assert.equal(P.basis, 'arch:2025-26');
  const picks = P.league.draft.picks;
  const matched = picks.filter(p => p[3]).length;
  const inactive = picks.filter(p => p[3] && app.nbaById.get(p[3]).inactive).length;
  assert.equal(matched, picks.length, 'every pick matched, nicknames and players since out of the NBA included');
  // grade it the way the past-season Draft tab does
  app.set('seasonCtx', { basis: P.basis, label: P.label });
  const savedLeague = app.get('NBA').league;
  app.get('NBA').league = P.league;
  try {
    const d = app.draftData();
    assert.ok(d.graded);
    // the league played Oct 21 to Mar 22 (its last week ends Monday morning); the NBA went on to Apr 12
    assert.deepEqual({ ...d.season }, { from: '2025-10-21', to: '2026-03-22' });
    const full = p => (app.archivedStats(p.raw, '2025-26') || {}).gp || 0;
    assert.ok(d.picks.every(p => !p.raw || p.gp <= full(p)), 'never more games than the NBA season');
    assert.ok(d.picks.filter(p => p.raw && p.gp < full(p) - 5).length > 20, "the games after the league's last week don't count");
    assert.ok(d.maxGp < Math.max(...d.picks.map(full)), `at most ${d.maxGp} games in the league's 22 weeks`);
    const played = d.picks.filter(p => p.gp);
    assert.ok(played.length >= picks.length - 10, `${played.length} picks have 2025-26 stats`);
    assert.ok(played.every(p => Number.isFinite(p.val)));
    if (inactive) assert.ok(played.some(p => p.raw && p.raw.inactive), 'a player no longer in the NBA is graded too');
  } finally {
    app.get('NBA').league = savedLeague;
    app.set('seasonCtx', null);
  }
});

test('weekly rosters tell trades from waiver pickups', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league;
  assert.ok(L.weeks && L.weeks.length > 15, 'every week of the season loaded');
  const last = L.weeks.length - 1;
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const how = name => { const it = L.rosters[team.id].find(x => x.name === name); return it && app.arrivalAt(L.weeks, last, it.fid); };
  assert.equal(how('Lauri Markkanen'), 'trade', 'Markkanen came over from mikeysak in week 17');
  assert.equal(how('VJ Edgecombe'), 'trade');
  const kinds = [...L.weeks[last].owner].filter(([, o]) => o.tid === team.id).map(([f]) => app.arrivalAt(L.weeks, last, f));
  assert.ok(kinds.includes('pickup') && kinds.includes('start'));
  // the award counts only pickups
  const G = await app.loadGameLog('2025-26');
  assert.ok(G && G.days.size === 30, 'game log with every team');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let awards;
  try { awards = app.withSeason(() => app.seasonAwards()); } finally { app.get('ui').season = null; }
  const wizard = awards.find(a => a.title === 'Waiver Wire Wizard');
  assert.ok(wizard && !/Markkanen|Edgecombe/.test(wizard.list.map(x => x.note).join(' ')), 'traded players are not pickups');
  // impact counts only the weeks a pickup started for that team, dropped players included
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let impact;
  try { impact = app.withSeason(() => app.pickupImpact(L, G)); } finally { app.get('ui').season = null; }
  const mine = impact[team.id];
  assert.ok(!mine.some(p => /Markkanen|Edgecombe/.test(p.name)));
  const kpj = mine.find(p => p.name === 'Kevin Porter Jr.');
  assert.ok(kpj && kpj.weeks < L.weeks.length && kpj.games > 0, `KPJ counted for ${kpj && kpj.weeks} weeks`);
  const finalIds = new Set(Object.values(L.rosters).flat().map(x => x.nba));
  assert.ok(Object.values(impact).flat().some(p => !finalIds.has(p.nba)), 'a pickup dropped before the end still counts');
});

test('Street Clothes counts only games starters missed while starting', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const sat = app.startersMissed(L, G);
  const all = Object.values(sat).flat();
  assert.ok(all.length > 0 && all.every(p => p.games > 0));
  // a team's starters can't miss more games than they had lineup weeks with games
  for (const [tid, ps] of Object.entries(sat)) {
    const total = app.sum(ps.map(p => p.games));
    assert.ok(total < L.weeks.length * 8 * 4, `${app.fxTeamName(tid)}: ${total} games`);
  }
  // nobody counts for a team in weeks he wasn't starting there: recount one player by hand
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const pick = sat[team.id][0];
  const rows = G.players.get(pick.nba) || [];
  let n = 0;
  for (const w of L.weeks) {
    const o = [...w.owner].find(([f, x]) => x.tid === team.id && x.on && L.fidNba(f) === pick.nba);
    if (!o) continue;
    for (const day of app.periodDays(G, w)) {
      const t = app.teamOn(G, rows, day) || (app.nbaById.get(pick.nba) || {}).team;
      if (!rows.some(r => r[0] === day) && G.days.get(t) && G.days.get(t).has(day)) n++;
    }
  }
  assert.equal(pick.games, n, `${pick.name}: ${pick.games} games`);
  assert.ok(all.every(p => p.games <= p.sched && p.weeks >= 1), 'missed out of his team\'s games while starting');
});

test('Old averages the ages of the players each team started', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const ages = app.startersAge(P.league);
  const teams = Object.values(ages);
  assert.equal(teams.length, P.league.teams.length);
  for (const T of teams) {
    assert.ok(T.age > 21 && T.age < 34, `average age ${T.age}`);
    assert.ok(T.n > P.league.weeks.length * 4, `${T.n} starter-weeks with a birth date`);
    // each player's pull on the average: the average with him minus without him
    const old = T.players.reduce((a, b) => (b.moved > a.moved ? b : a));
    assert.ok(old.moved > 0 && old.age > T.age, `${old.name} (${old.age.toFixed(1)}) makes the team older`);
    assert.equal(app.sum(T.players.map(x => x.weeks)), T.n);
  }
});

test('Awards: a team name in Waiver Wire Wizard and Old opens its breakdown', async () => {
  await app.loadSeason('czqgnyozmf2tbr93');
  await app.loadGameLog('2025-26');
  const ui = app.get('ui');
  ui.season = 'czqgnyozmf2tbr93';
  let html;
  try { html = app.withSeason(() => app.viewAwards()); } finally { ui.season = null; }
  const keys = [...html.matchAll(/data-action="award-team" data-key="([^"]+)"/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  assert.ok(keys.some(k => k.startsWith('Waiver Wire Wizard|')) && keys.some(k => k.startsWith('Old|')));
  assert.ok(keys.some(k => k.startsWith('Street Clothes|')));
  const dr = [...app.get('awardDetails').entries()].find(([k]) => k.startsWith('Best draft|'));
  assert.ok(dr, 'Best draft has one');
  assert.ok(/Best picks/.test(dr[1].html) && /Rd \d+, #\d+ · \d+ G/.test(dr[1].html), 'the picks that did most, with round and pick');
  const mg = [...app.get('awardDetails').entries()].find(([k]) => k.startsWith('Best manager|'));
  assert.ok(mg && /Week \d+/.test(mg[1].html) && /would have beaten \d/.test(mg[1].html), 'Best manager: each week, the result and the all-play');
  assert.ok(!keys.some(k => k.startsWith('Even Steven|')), 'not every award has one yet');
  // the newer awards, each with its breakdown
  for (const t of ['Steal of the Draft', 'Bust of the Draft', 'Week of the Year', 'Heartbreak Hotel', 'Benchwarmer Blues', 'Fan Boy']) assert.ok(keys.some(k => k.startsWith(t + '|')), t);
  const detail = t => [...app.get('awardDetails').entries()].find(([k]) => k.startsWith(t + '|'))[1].html;
  assert.match(detail('Steal of the Draft'), /Rd \d+, pick \d+ · ranked \d+(st|nd|rd|th)/);
  assert.match(detail('Week of the Year'), /would have beaten <b>\d+(\.5)? of \d+<\/b> teams/);
  assert.match(detail('Heartbreak Hotel'), /L \d(\.5)?–\d(\.5)? vs /);
  assert.match(detail('Fan Boy'), /%<\/b> of \d+ starts were [A-Z]{3} players/);
  const D = app.get('awardDetails');
  const w = [...D.entries()].find(([k]) => k.startsWith('Waiver Wire Wizard|'))[1];
  assert.match(w.title, /^Waiver Wire Wizard: 1\. /);
  assert.ok(/Helped/.test(w.html) && /data-action="player-detail"/.test(w.html), 'the pickups that helped, each a player link');
  const st = [...D.entries()].find(([k]) => k.startsWith('Street Clothes|'))[1];
  assert.ok((st.html.match(/<li>/g) || []).length <= 10 && /out \d+ of \d+ · \d+ wk/.test(st.html), 'the starters who missed most');
  const u = [...D.entries()].find(([k]) => k.startsWith('Old|'))[1];
  assert.ok((u.html.match(/<li>/g) || []).length <= 10 && /\+\d\.\d\d yrs/.test(u.html), 'up to 10 players and how much each moved the average');
});

test('Best draft credits picks until first dropped, through trades', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let imp, picks;
  try {
    app.withSeason(() => { picks = app.draftData().picks; imp = app.draftImpact(L, G, picks); });
  } finally { app.get('ui').season = null; }
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const daniels = imp[team.id].find(p => p.name === 'Dyson Daniels');
  // traded to mikeysak in week 17: his later games still count for the team that drafted him
  const f = [...L.weeks[0].owner.keys()].find(k => L.fidNba(k) === daniels.nba);
  const lastOnTeam = L.weeks.reduce((k, w, i) => ((w.owner.get(f) || {}).tid === team.id ? i : k), -1);
  const rows = G.players.get(daniels.nba) || [];
  const gamesWhileMine = L.weeks.slice(0, lastOnTeam + 1).reduce((n, w) => n + rows.filter(r => app.periodDays(G, w).has(r[0])).length, 0);
  assert.ok(lastOnTeam < L.weeks.length - 1, 'he was traded away before the end');
  assert.ok(daniels.games > gamesWhileMine, `${daniels.games} games counted, ${gamesWhileMine} before the trade`);
  // every team's picks are all accounted for
  assert.equal(Object.values(imp).flat().length, picks.length);
});

test('a past season\'s weekly totals replay its final standings', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const rec = {};
  app.get('ui').season = 'czqgnyozmf2tbr93';
  try {
    app.withSeason(() => {
      const cats = app.scoreCats();
      const val = (T, c) => (!T ? 0 : c.pct ? (T.s[c.att] ? T.s[c.made] / T.s[c.att] : 0) : T.s[c.key] || 0);
      for (const w of L.weeks.filter(x => x.n < L.playoffPeriod)) {
        const one = app.pastSeasonTotals({ ...L, weeks: [w] }, G);
        for (const [a, b] of L.matchups[String(w.n)] || []) {
          let wa = 0, wb = 0;
          for (const c of cats) { const x = val(one[a], c), y = val(one[b], c); if (Math.abs(x - y) < 1e-9) continue; if (c.neg ? x < y : x > y) wa++; else wb++; }
          for (const [t, r] of [[a, Math.sign(wa - wb)], [b, Math.sign(wb - wa)]]) { rec[t] = rec[t] || { w: 0, l: 0, t: 0 }; rec[t][r > 0 ? 'w' : r < 0 ? 'l' : 't']++; }
        }
      }
    });
  } finally { app.get('ui').season = null; }
  const exact = L.standings.filter(s => rec[s.id] && rec[s.id].w === s.w && rec[s.id].l === s.l && rec[s.id].t === s.t).length;
  // 89 of 90 regular-season matchups agree with Fantrax (one week 17 matchup was decided by 4 points)
  assert.ok(exact >= 8, `${exact} of ${L.standings.length} records match Fantrax exactly`);
});

test('past Rosters list only starters, with games and misses that match the awards', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const sat = app.startersMissed(L, G);
  for (const t of L.teams) {
    const st = [...app.activeStints(L, G, t.id).values()];
    assert.ok(st.length >= 8 && st.every(p => p.weeks > 0));
    assert.equal(app.sum(st.map(p => p.missed)), app.sum((sat[t.id] || []).map(p => p.games)), `${t.name}: missed games agree with Street Clothes`);
  }
});

test('past Rosters mark keepers', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const st = [...app.activeStints(L, G, team.id).values()];
  assert.deepEqual(st.filter(p => p.how === 'keeper').map(p => p.name).sort(), ['Karl-Anthony Towns', 'Shai Gilgeous-Alexander']);
  assert.ok(st.some(p => p.how === 'start') && st.some(p => p.how === 'pickup') && st.some(p => p.how === 'trade'));
});

test('Best manager compares actual wins with an all-play record', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let ap, awards;
  try { app.withSeason(() => { ap = app.allPlayRecords(L, G, false); awards = app.seasonAwards(); }); } finally { app.get('ui').season = null; }
  const teams = Object.values(ap);
  const weeks = teams[0].weeks;
  assert.equal(weeks, L.weeks.filter(w => w.n < L.playoffPeriod).length, 'every regular-season week');
  // each pairing splits one win, so a week's expected wins add up to half the teams
  assert.ok(Math.abs(app.sum(teams.map(t => t.exp)) - weeks * teams.length / 2) < 1e-6);
  for (const t of teams) assert.ok(t.pct >= 0 && t.pct <= 1);
  const bm = awards.find(a => a.title === 'Best manager');
  assert.match(bm.list[0].note, /all-play \d+%/);
});

test('the newer awards add up: Steal and Bust are each pick against its rank, Fan Boy shares, close losses', async () => {
  await app.useLeague(CATS9);
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const G = await app.loadGameLog('2025-26');
  const ui = app.get('ui');
  ui.season = 'czqgnyozmf2tbr93';
  let aw, steals, fans, bench;
  try { app.withSeason(() => { aw = app.seasonAwards(); steals = app.draftSteals(); fans = app.startsByNbaTeam(P.league, G); bench = app.benchValue(P.league, G); }); } finally { ui.season = null; }
  const award = t => aw.find(a => a.title === t);
  const all = Object.values(steals).flat();
  const best = all.reduce((a, b) => (b.gain > a.gain ? b : a)), worst = all.reduce((a, b) => (b.gain < a.gain ? b : a));
  assert.equal(award('Steal of the Draft').list[0].T.steal.gain, best.gain);
  assert.equal(award('Bust of the Draft').list[0].T.bust.gain, worst.gain);
  assert.ok(all.every(p => p.gain === p.pick - p.rank));
  for (const F of Object.values(fans)) {
    assert.equal(app.sum(F.teams.map(x => x.n)), F.n, 'every start counted once');
    assert.ok(F.teams.every((x, i) => !i || x.n <= F.teams[i - 1].n), 'biggest share first');
  }
  assert.ok(Object.values(bench).flat().every(p => p.games > 0 && p.weeks > 0));
  const heart = award('Heartbreak Hotel').list[0].T;
  assert.ok(heart.heart.every(x => x.wb - x.wa > 0 && x.wb - x.wa <= 1), 'losses by one category');
  const week = award('Week of the Year').list[0].T.bestWeek;
  assert.ok(week.beat <= week.of && week.cats.length === app.scoreCats().length);
});

test("a week is over once its last game day's box scores are in, before Fantrax ends it Monday evening", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const wk1 = L.periods[0]; // Oct 20-25, ends on Fantrax Monday Oct 26 at 6:59 PM
  // Sunday night: over once every one of its games is final (ESPN's finals are put in with the saved ones that night)
  const sunday = [...app.get('BOX').finals].filter(x => x.startsWith('2026-10-25 '));
  assert.ok(sunday.length);
  app.get('BOX').finals.delete(sunday[0]);
  assert.equal(await onDay('2026-10-25', () => app.periodOver(wk1)), false, 'Sunday: a game still to finish');
  app.get('BOX').finals.add(sunday[0]);
  assert.equal(await onDay('2026-10-25', () => app.periodOver(wk1)), true, 'Sunday night: every game final');
  assert.equal(await onDay('2026-10-26', () => app.periodOver(wk1)), true, "Monday noon: Sunday's games are in");
  assert.ok(await onDay('2026-10-26', () => app.finishedPeriods(L).some(p => p.n === 1)), 'its recap is ready');
  assert.equal(await onDay('2026-10-26', () => app.periodOver(L.periods[1])), false, 'week 2 just starting');
});
