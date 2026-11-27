const { test, assert, sharedApp, CATS9, ESPN, useTeam, onDay } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('a player out or day-to-day says so in a few letters on the Players table', () => {
  const short = inj => app.injBadge(inj).replace(/<[^>]*>/g, '');
  assert.equal(short({ status: 'Out', label: 'Out' }), 'O');
  assert.equal(short({ status: 'DTD', label: 'Day-To-Day' }), 'D');
  assert.equal(short({ status: 'Out', label: 'Injured Reserve' }), 'IR');
  assert.equal(short({ status: 'Out', label: 'IR' }), 'IR');
  assert.equal(short({ status: 'DTD', label: 'Questionable' }), 'Q');
  assert.equal(short({ status: 'DTD', label: 'Doubtful' }), 'D');
  assert.equal(short({ status: 'Out', label: 'PUP' }), 'PUP');
  assert.match(app.injBadge({ status: 'Out', label: 'Out', note: 'Knee' }, 'by-name'), /class="badge inj bad by-name" title="Out: Knee"/);
  assert.equal(app.injBadge(null), '');
  // a rookie gets an R; a veteran and a football team defense don't
  assert.match(app.rookieBadge({ exp: 0, pos: ['G'] }, 'by-name'), /class="badge rk by-name" title="Rookie">R</);
  assert.equal(app.rookieBadge({ exp: 3, pos: ['G'] }), '');
  assert.equal(app.rookieBadge({ exp: 0, pos: ['DEF'] }), '');
});

test('performances: today, the last game day before it, this period once it has two game days, and the last period all week', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const days = async iso => JSON.parse(JSON.stringify(await onDay(iso, () => app.perfDays())));
  assert.deepEqual(await days('2026-10-21'), { today: '2026-10-21', started: true, day: '2026-10-20', week: ['2026-10-20', '2026-10-21'], last: null, year: ['2026-10-20', '2026-10-21'] }, 'Wednesday: today, last night, the days played so far (no period before opening night)');
  // the period's first game day (here opening night): no This period yet, it would only repeat Today
  assert.equal((await days('2026-10-20')).week, null, 'one game day in: Today says it');
  await onDay('2026-10-20', () => assert.ok(!app.topPerformancesCard().includes('value="week"')));
  // Monday at noon (the same date in any US time zone and UTC): the period before, whole (Last period), to see how it all went
  const first = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  assert.deepEqual(await days('2026-10-26'), { today: '2026-10-26', started: false, day: '2026-10-25', week: null, last: first, year: first }, "Monday before tip-off: last night was last week's");
  // mid-week: both, This period from two game days on and Last period still there
  const finals = app.get('BOX').finals;
  try {
    finals.add('2026-10-26 ZZZ').add('2026-10-27 ZZZ');
    const wed = await days('2026-10-28');
    assert.deepEqual([wed.week, wed.last], [['2026-10-26', '2026-10-27'], first]);
    await onDay('2026-10-28', () => {
      const html = app.topPerformancesCard();
      assert.ok(/value="week" >This period<\/option><option value="last" >Last period<\/option><option value="year"/.test(html), 'This period, then Last period, then This season');
      app.ui.perfRange = 'last';
      try {
        const last = app.topPerformancesCard();
        assert.ok(last.includes('<option value="last" selected>') && last.includes('Tue, Oct 20 – Sun, Oct 25'), 'the whole week before');
        assert.ok(last.includes('data-action="perf-per"'), 'with Totals / Per game, as any period');
      } finally { app.ui.perfRange = null; }
    });
  } finally { finals.delete('2026-10-26 ZZZ'); finals.delete('2026-10-27 ZZZ'); }
  await onDay('2026-10-26', () => {
    const html = app.topPerformancesCard();
    assert.ok(html.includes('value="today"') && html.includes('>Yesterday<') && html.includes('<option value="last" >Last period</option>') && !html.includes('value="week"'), 'Today, Yesterday and Last period');
    assert.ok(html.includes('<option value="day" selected>') && html.includes('Last night'), "before tip-off it opens on last night's games");
    app.ui.perfRange = 'today';
    try {
      assert.ok(app.topPerformancesCard().includes("Loading today's games"), 'today, before ESPN has answered');
    } finally { app.ui.perfRange = null; }
  });
  await onDay('2026-10-21', () => {
    const toggle = app.topPerformancesCard();
    assert.ok(toggle.includes('value="week"') && toggle.includes('<option value="today" selected>'), "all of them, on today once its games have started");
    assert.ok(!toggle.includes('data-action="perf-per"'), 'one day: no Totals / Per game');
  });
});

test("performances: this week adds up each player's games", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const dates = ['2026-10-23', '2026-10-24', '2026-10-25'];
  const rows = app.perfRows(dates);
  const r = rows.find(x => x.g >= 2);
  const lines = dates.map(d => app.BOX.day.get(r.raw.id).get(d)).filter(Boolean);
  assert.equal(r.g, lines.length);
  assert.equal(r.tot.pts, lines.reduce((t, l) => t + l.pts, 0));
  // categories won against not playing, so the week is just its games added up
  const games = lines.reduce((t, l) => t + Object.values(app.catWins(l)).reduce((a, b) => a + b, 0), 0);
  assert.ok(Math.abs(r.v - games) < 1e-9);
  app.ui.perfRange = 'week';
  try {
    const html = await onDay('2026-10-25', () => app.topPerformancesCard());
    assert.match(html, /<td class="sc pf-gp">\d+<\/td><td class="sc pf-min">\d+<\/td>/, 'rows show games played and minutes, each a column of its own');
    assert.match(html, /title="Games played"[^>]*>GP</);
    assert.doesNotMatch(html, /\d G · |\d+ min/, 'not under the name: it crowded a phone');
    // per game: each player's games over the period, averaged
    app.ui.perfPer = true;
    const per = await onDay('2026-10-25', () => app.topPerformancesCard());
    assert.match(per, / · per game/);
    assert.match(per, /aria-pressed="true">Per game</);
    assert.match(per, /<td class="sc pf-gp">\d+<\/td><td class="sc pf-min">\d+\.\d<\/td>/, 'games played, and minutes a game to one decimal');
  } finally { app.ui.perfRange = null; app.ui.perfPer = false; }
});

test('performances: value is categories won against not playing, every category weighing the same', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const v = line => Object.values(app.catWins(line)).reduce((a, b) => a + b, 0);
  const W = app.winWeights();
  assert.equal(v({}), 0, 'not playing adds nothing');
  // counting stats only add; a steal is worth several points (steals decide a category with far smaller totals)
  const pt = app.catWins({ pts: 1 }).pts, stl = app.catWins({ stl: 1 }).stl;
  assert.ok(pt > 0 && stl / pt > 4 && stl / pt < 20, `a steal is worth ${(stl / pt).toFixed(1)} points`);
  assert.ok(app.catWins({ to: 1 }).to < 0, 'turnovers take away');
  // shooting adds only above the league's average
  assert.ok(Math.abs(app.catWins({ fgm: W.fgPct.p * 10, fga: 10 }).fgPct) < 1e-12, 'average shooting: nothing either way');
  assert.ok(app.catWins({ ftm: 0, fta: 2 }).ftPct < 0 && app.catWins({ ftm: 2, fta: 2 }).ftPct > 0);
  // an ordinary starter's game helps; a brick-and-turnover night with little else hurts
  const ordinary = { min: 32, pts: 18, reb: 6, ast: 4, stl: 1, blk: 1, tpm: 2, to: 2, fgm: 7, fga: 15, ftm: 2, fta: 3 };
  assert.ok(v(ordinary) > 0.1 && v(ordinary) < 0.4, `an ordinary game adds ${v(ordinary).toFixed(2)} categories`);
  assert.ok(v({ min: 30, pts: 2, reb: 7, ast: 6, fgm: 1, fga: 10, ftm: 0, fta: 2, to: 5 }) < 0);
  assert.ok(v({ min: 34, pts: 36, reb: 14, ast: 5, stl: 3, blk: 2, tpm: 4, to: 0, fgm: 14, fga: 25, ftm: 4, fta: 4 }) > 2 * v(ordinary));
});

test('performances: every range marks each category leader with an emoji', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const day = app.perfDays().day;
  const rows = app.perfRows([day]);
  const cats = app.scoreCats().filter(c => !c.fp);
  const cellsOf = html => Object.fromEntries(html.split('<tbody>')[1].split('</tr>').slice(0, -1).map(tr => [tr.match(/data-nba="(\d+)"/)[1], [...tr.matchAll(/<td class="sc"[^>]*>(.*?)<\/td>/g)].map(m => m[1])]));
  app.ui.perfRange = 'day';
  Object.assign(app.ui, { perfWhose: { me: true, opp: true, other: true, fa: true }, perfSpot: 'all', perfFiltOpen: false });
  try {
    const html = app.topPerformancesCard();
    assert.doesNotMatch(html, /pf-legend/, 'no legend: the emoji say what they mark on hover');
    app.ui.perfSort = { key: 'v', dir: 1 }; // the worst too
    const cells = { ...cellsOf(html), ...cellsOf(app.topPerformancesCard()) };
    app.ui.perfSort = { key: 'fgPct', dir: 1 }; // the worst shooting
    Object.assign(cells, cellsOf(app.topPerformancesCard()));
    app.ui.perfSort = { key: 'v', dir: -1 };
    const emo = (id, i) => ((cells[id] || [])[i] || '').match(/pf-emo[^>]*>([^<]+)</);
    for (const [i, c] of cats.entries()) {
      if (c.pct) continue;
      const val = r => app.lineStat(r.tot, c.key);
      const top = Math.max(...rows.map(val));
      const leaders = rows.filter(r => val(r) === top);
      const want = c.neg ? '\u{1F9C8}' : '\u{1F680}';
      for (const r of leaders) if (leaders.length <= 3 && cells[r.raw.id]) assert.equal((emo(r.raw.id, i) || [])[1], want, `${c.label}: ${r.raw.name} leads with ${top}`);
      const others = Object.keys(cells).filter(id => !leaders.some(r => String(r.raw.id) === id));
      assert.ok(others.every(id => !emo(id, i) || emo(id, i)[1] === '\u{1F525}'), `${c.label}: only the leaders and the second best are marked`);
    }
    const fg = cats.findIndex(c => c.key === 'fgPct');
    const marks = Object.keys(cells).map(id => emo(id, fg)).filter(Boolean).map(m => m[1]);
    assert.ok(marks.includes('\u{1F680}') && marks.includes('\u{1F9CA}'), `FG%: best and worst shooting marked (${marks})`);
    // every other range marks its own leaders too: the season's points leader, per game's among regulars
    app.ui.perfRange = 'year';
    const year = app.perfRows([...app.perfDays().year]);
    const pts = cats.findIndex(c => c.key === 'pts');
    const yLead = year.reduce((x, y) => (app.lineStat(y.tot, 'pts') > app.lineStat(x.tot, 'pts') ? y : x));
    app.ui.perfSort = { key: 'pts', dir: -1 };
    let yc = cellsOf(app.topPerformancesCard());
    assert.equal((((yc[yLead.raw.id] || [])[pts] || '').match(/pf-emo[^>]*>([^<]+)</) || [])[1], '\u{1F680}', `this season: ${yLead.raw.name} leads in points`);
    app.ui.perfRange = 'avg';
    const reg = app.seasonRows().filter(r => r.g >= 3 && r.tot.min >= 15);
    const aLead = reg.reduce((x, y) => (app.lineStat(y.tot, 'pts') > app.lineStat(x.tot, 'pts') ? y : x));
    yc = cellsOf(app.topPerformancesCard());
    assert.equal((((yc[aLead.raw.id] || [])[pts] || '').match(/pf-emo[^>]*>([^<]+)</) || [])[1], '\u{1F680}', `per game: ${aLead.raw.name} leads in points among regulars`);
    assert.match(app.topPerformancesCard(), /title="Most PTS per game"/);
  } finally { app.ui.perfRange = null; Object.assign(app.ui, { perfWhose: { me: true, opp: true, other: true, fa: true }, perfSpot: 'all', perfFiltOpen: false }); app.ui.perfSort = { key: 'v', dir: -1 }; }
});

test('one night can be once-a-season: a goat bumps the rocket and fire down, a poop the butter', () => {
  const row = (id, tot) => ({ raw: { id }, g: 1, tot: { min: 30, ...tot }, z: {}, v: 0 });
  const rows = [row(1, { pts: 61, to: 11 }), row(2, { pts: 44, to: 6 }), row(3, { pts: 40, to: 5 }), row(4, { pts: 30, to: 2 })];
  const get = (b, id, k) => (b.get(`${id}|${k}`) || [])[0];
  let b = app.perfBadges(rows, { range: 'day', day: '2026-10-25', cuts: { pts: { hi: 50 }, to: { hi: 9 } } });
  assert.equal([1, 2, 3].map(id => get(b, id, 'pts')).join(), ['\u{1F410}', '\u{1F680}', '\u{1F525}'].join(), 'goat, then rocket, then fire');
  assert.equal([1, 2].map(id => get(b, id, 'to')).join(), ['\u{1F4A9}', '\u{1F9C8}'].join(), 'poop, then the butter');
  b = app.perfBadges(rows, { range: 'day', day: '2026-10-25', cuts: { pts: { hi: 70 }, to: { hi: 15 } } });
  assert.equal([1, 2].map(id => get(b, id, 'pts')).join(), ['\u{1F680}', '\u{1F525}'].join(), 'nothing once-a-season: as before');
  b = app.perfBadges(rows, { range: 'year', cuts: { pts: { hi: 50 } } });
  assert.equal(get(b, 1, 'pts'), '\u{1F680}', 'a week or the season: no goats');
});

test('performances: everyone who played in one table, top 100 by the sorted column, ranked by value', async () => {
  await app.loadBoxes();
  const cell = (tr, i) => [...tr.matchAll(/<td class="sc"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]*)</g)][i][1];
  const bodyRows = html => html.split('<tbody>')[1].split('</tr>').slice(0, -1);
  const val = tr => parseFloat(tr.match(/class="num pf-v[^"]*"[^>]*>([^<]+)</)[1].replace('\u2212', '-'));
  for (const id of [CATS9, ESPN]) {
    await app.useLeague(id);
    const all = app.perfRows([app.perfDays().day]);
    let rows = bodyRows(app.topPerformancesCard());
    assert.equal(rows.length, Math.min(100, all.length), `${id}: up to 100 rows`);
    assert.ok(!app.topPerformancesCard().includes('<h3 class="sub">'), 'no separate Best and Worst lists');
    const vals = rows.map(val);
    assert.ok(vals.every((v, i) => !i || v <= vals[i - 1]), `${id}: best first`);
    assert.deepEqual(rows.slice(0, 5).map(tr => +tr.match(/perf-rank">(\d+)/)[1]), [1, 2, 3, 4, 5]);
    assert.ok(rows.every(tr => !/<td class="sc"[^>]*style=/.test(tr)), `${id}: stats aren't colored`);
    const top = rows[0].match(/class="num pf-v" style="([^"]*)"/), low = rows.find(tr => val(tr) < -0.05);
    assert.match(top[1], /--good/, `${id}: the best value is green`);
    if (low) assert.match(low, /class="num pf-v" style="[^"]*--bad/, `${id}: a game that hurt is red`);
    app.ui.perfSort = { key: 'v', dir: 1 };
    try {
      rows = bodyRows(app.topPerformancesCard());
      assert.equal(+rows[0].match(/perf-rank">(\d+)/)[1], all.length, `${id}: sorted the other way, the worst line of all ${all.length} comes first`);
    } finally { app.ui.perfSort = { key: 'v', dir: -1 }; }
  }
  await app.useLeague(CATS9);
  const cats = app.scoreCats().map(c => c.key);
  app.ui.perfSort = { key: 'pts', dir: -1 };
  try {
    const rows = bodyRows(app.topPerformancesCard());
    const pts = rows.map(tr => +cell(tr, cats.indexOf('pts')));
    assert.ok(pts.every((v, i) => !i || v <= pts[i - 1]), `points, most first: ${pts.slice(0, 8)}`);
    const fg = rows.map(tr => tr.match(/<td class="sc"[^>]*title="FG%: ([^"]+)">(?:<span[^>]*>[^<]*<\/span>)?([^<]*)</));
    assert.ok(fg.every(m => m && /^\d+\/\d+$/.test(m[2]) && /%|no attempts/.test(m[1])), 'shooting shows makes/attempts, the percentage on hover');
    assert.ok(rows.map(tr => +tr.match(/perf-rank">(\d+)/)[1]).some((v, i) => v !== i + 1), 'ranks still by value');
  } finally { app.ui.perfSort = { key: 'v', dir: -1 }; }
});

test('performances: filter by my team, the opponent, waivers and other teams', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const day = app.perfDays().day;
  const owned = new Map(Object.entries(L.rosters).flatMap(([tid, r]) => r.filter(x => x.nba).map(x => [x.nba, tid])));
  const spot = new Map(Object.values(L.rosters).flat().filter(x => x.nba).map(x => [x.nba, x.st]));
  // my team: whoever has the most players in that day's games
  const played = app.perfRows([day]);
  const per = {};
  for (const r of played) { const t = owned.get(r.raw.id); if (t) per[t] = (per[t] || 0) + 1; }
  const me = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
  const was = app.state.fxTeam;
  app.state.fxTeam = me;
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  const count = html => +html.match(/· (?:\d+ of )?(\d+) players?</)[1];
  try {
    let html = app.topPerformancesCard();
    assert.ok(html.includes('data-action="perf-filt" aria-expanded="false"') && !html.includes('perf-panel'), 'the filters wait behind one button');
    app.ui.perfFiltOpen = true;
    html = app.topPerformancesCard();
    assert.ok(['me', 'other', 'fa'].every(k => new RegExp(`data-key="${k}"[^>]* aria-pressed="true"`).test(html)) && html.includes('data-spot="all" aria-pressed="true"'), 'everyone by default');
    assert.equal(count(html), played.length);
    app.ui.perfWhose = { me: true, opp: false, other: false, fa: false };
    html = app.topPerformancesCard();
    assert.equal(count(html), per[me]);
    assert.ok(ids(html).every(id => owned.get(id) === me), 'only my players');
    assert.equal((html.match(/<tr class="pf-me">/g) || []).length, ids(html).length, 'my rows are marked');
    assert.ok(!html.includes('>Your team<'), 'no Your team badge');
    assert.match(html, /Filters <b>1<\/b>/, 'the button counts it');
    app.ui.perfWhose = { me: false, opp: false, other: false, fa: true };
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => !owned.has(id)), 'only players not on a roster');
    assert.ok(html.includes('data-spot="active" aria-pressed="false" title="In their team\'s starting lineup" disabled'), 'waivers alone: no lineup to pick');
    app.ui.perfSpot = 'active';
    assert.ok(ids(app.topPerformancesCard()).length, 'Active never hides waivers');
    app.ui.perfWhose = { me: true, opp: false, other: false, fa: true };
    html = app.topPerformancesCard();
    assert.ok(ids(html).some(id => !owned.has(id)) && ids(html).filter(id => owned.has(id)).every(id => owned.get(id) === me && spot.get(id) === 'ACTIVE'), 'my starters and waivers together');
    app.ui.perfSpot = 'all';
    app.ui.perfWhose = { me: false, opp: false, other: true, fa: false };
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => owned.has(id) && owned.get(id) !== me), "other teams' players");
    const opp = app.fxOpponentFor(day, me);
    if (opp && played.some(r => owned.get(r.raw.id) === opp.id)) {
      app.ui.perfWhose = { me: false, opp: true, other: false, fa: false };
      html = app.topPerformancesCard();
      assert.ok(ids(html).length && ids(html).every(id => owned.get(id) === opp.id), "only the opponent's players");
      app.ui.perfWhose = { me: true, opp: true, other: false, fa: false };
      assert.ok(ids(app.topPerformancesCard()).every(id => [me, opp.id].includes(owned.get(id))), 'both sides of my matchup');
      assert.ok(html.includes('<tr class="pf-opp">') && html.includes(`title="Opponent: ${opp.name.replace(/'/g, '&#39;')}"`), "the opponent's rows are marked");
    }
    // Other teams is also a menu of those teams: any number picked, none picked = all of them
    const others = [...new Set(played.map(r => owned.get(r.raw.id)))].filter(t => t && t !== me && !(opp && t === opp.id));
    assert.ok(others.length > 2);
    const pickOther = v => app.actions['perf-other']({ dataset: { val: v } });
    app.ui.perfWhose = { me: false, opp: false, other: false, fa: true };
    app.ui.perfMenu = 'perfOthers';
    html = app.topPerformancesCard();
    assert.match(html, /data-menu="perfOthers"[^>]*aria-expanded="true" aria-pressed="false">Other teams</);
    assert.ok(others.every(t => html.includes(`data-action="perf-other" data-val="${t}" aria-pressed="false"`)) && !html.includes(`data-action="perf-other" data-val="${me}"`), 'the box lists the other teams, not mine');
    pickOther(others[0]);
    assert.equal(app.ui.perfWhose.other, true, 'picking a team shows other teams again, that one only');
    html = app.topPerformancesCard();
    assert.ok(ids(html).some(id => owned.get(id) === others[0]) && ids(html).some(id => !owned.has(id)) && ids(html).every(id => !owned.has(id) || owned.get(id) === others[0]), 'one other team, beside waivers');
    assert.match(html, new RegExp(`aria-pressed="true">${app.esc(app.fxTeamName(others[0])).replace(/[.*+?^$()|[\]\\]/g, '\\$&')}<`), 'the pill names it');
    assert.match(html, /Filters <b>1<\/b>/, 'one filter with Show');
    pickOther(others[1]);
    app.ui.perfWhose = { me: false, opp: false, other: true, fa: false };
    html = app.topPerformancesCard();
    assert.ok(others.slice(0, 2).every(t => ids(html).some(id => owned.get(id) === t)) && ids(html).every(id => others.slice(0, 2).includes(owned.get(id))), 'two of them');
    assert.match(html, /aria-pressed="true">2 teams</);
    assert.doesNotMatch(html, /data-val="none"/, 'no None when nothing else is shown');
    pickOther('none');
    assert.equal(app.ui.perfWhose.other, true, 'never nobody');
    pickOther(others[0]); pickOther(others[1]);
    assert.equal(app.ui.perfOthers.length, 0, 'the last one out: all of them again');
    pickOther(others[2]); pickOther('all');
    assert.equal(app.ui.perfOthers.length, 0);
    app.ui.perfWhose = { me: true, opp: false, other: true, fa: false };
    pickOther(others[0]); pickOther('none');
    assert.ok(!app.ui.perfWhose.other && !app.ui.perfOthers.length, 'None turns them off');
  } finally {
    app.state.fxTeam = was;
    Object.assign(app.ui, { perfWhose: { me: true, opp: true, other: true, fa: true }, perfOthers: [], perfMenu: null, perfSpot: 'all', perfFiltOpen: false });
  }
});

test("Players: the Opponent filter is this matchup's opponent for every range, not the first day shown's", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui'), was = app.state.fxTeam;
  try {
    await onDay('2026-11-03', () => {
      // a team whose opponent now isn't its opening week's
      const me = L.teams.map(t => t.id).find(id => {
        const a = app.fxOpponentFor(app.perfDays().year[0], id), b = app.fxOpponentFor(app.weekStartAt(0), id);
        return a && b && a.id !== b.id;
      });
      assert.ok(me, 'a team with a different opponent than in week 1');
      app.state.fxTeam = me;
      const now = app.fxOpponentFor(app.weekStartAt(0), me);
      for (const r of ['year', 'avg', 'day']) {
        ui.perfRange = r;
        ui.perfFiltOpen = true;
        const html = app.topPerformancesCard();
        ui.perfFiltOpen = false;
        assert.ok(html.includes(`data-key="opp" aria-pressed="true" title="${now.name.replace(/'/g, '&#39;')}">Opponent</button>`), `${r}: ${now.name}`);
      }
    });
  } finally {
    app.state.fxTeam = was; ui.perfRange = null; ui.tab = 'standings'; clearTimeout(app.get('live').timer);
  }
});

test('Players: one table; Per game ranks every NBA player, with search and position', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const ui = app.get('ui');
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  const count = html => +html.match(/· (?:\d+ of )?(\d+) players?</)[1];
  try {
    let html = app.topPerformancesCard();
    assert.ok(html.indexOf('>This period<') < html.indexOf('>This season<'), 'This season after This period, in the menu');
    ui.perfRange = 'year';
    html = app.topPerformancesCard();
    assert.ok(html.includes('data-action="perf-per" data-per="0" aria-pressed="true">Totals<') && html.includes('>Per game<'), 'the season: Totals, or Per game');
    ui.perfPer = true;
    assert.equal(app.topPerformancesCard(), (ui.perfRange = 'avg', ui.perfPer = false, app.topPerformancesCard()), "the season per game is the old Per game");
    ui.perfRange = 'avg';
    html = app.topPerformancesCard();
    const rows = app.seasonRows();
    assert.equal(count(html), rows.length, 'every NBA player with stats');
    assert.ok(rows.length > 300 && rows.every(r => r.per));
    assert.ok(/<td class="sc pf-gp">\d+<\/td><td class="sc pf-min">\d+\.\d<\/td>/.test(html) && html.includes('title="Minutes a game"'), 'games played and minutes a game');
    if (app.state.fxTeam && app.fxOpponentFor(app.todayIso(), app.state.fxTeam)) { ui.perfFiltOpen = true; assert.ok(app.topPerformancesCard().includes('data-key="opp"'), "this week's opponent filter too"); ui.perfFiltOpen = false; }
    assert.ok(/<td class="sc" title="FG%: [\d.]+\/[\d.]+ a game">\.\d{3}<\/td>/.test(html), 'percentages per game');
    // the top row is the best average game
    const best = rows.reduce((x, y) => (y.v > x.v ? y : x));
    assert.equal(ids(html)[0], best.raw.id);
    // search by name, any range
    const name = best.raw.name;
    ui.perfQ = name.split(' ').pop().toLowerCase();
    html = app.topPerformancesCard();
    assert.ok(ids(html).includes(best.raw.id) && ids(html).every(id => app.normName(app.nbaById.get(id).name).includes(app.normName(ui.perfQ))));
    ui.perfQ = '';
    // position
    ui.perfPos = ['C'];
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).pos.includes('C')), 'centers only');
    ui.perfPos = ['C', 'PG'];
    html = app.topPerformancesCard();
    assert.ok(['C', 'PG'].every(x => ids(html).some(id => app.nbaById.get(id).pos.includes(x))) && ids(html).every(id => ['C', 'PG'].some(x => app.nbaById.get(id).pos.includes(x))), 'any number of positions: a player at any of them');
    ui.perfPos = [];
    // NBA team
    ui.perfTeam = ['OKC'];
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).team === 'OKC'), 'one NBA team');
    ui.perfTeam = ['OKC', 'LAC'];
    html = app.topPerformancesCard();
    assert.ok(['OKC', 'LAC'].every(t => ids(html).some(id => app.nbaById.get(id).team === t)) && ids(html).every(id => ['OKC', 'LAC'].includes(app.nbaById.get(id).team)), 'or several');
    ui.perfTeam = [];
    // the top 300 over a season
    assert.equal((app.topPerformancesCard().split('<tbody>')[1].match(/<\/tr>/g) || []).length, Math.min(300, rows.length), 'Per game: the top 300');
    // Show more: 100 more rows each time, until another sort or filter starts the list over
    const shownRows = () => (app.topPerformancesCard().split('<tbody>')[1].match(/<\/tr>/g) || []).length;
    if (rows.length > 300) {
      assert.match(app.topPerformancesCard(), new RegExp(`data-action="perf-more">Show ${Math.min(100, rows.length - 300)} more<`));
      ui.perfMore.n += 100;
      assert.equal(shownRows(), Math.min(400, rows.length));
      ui.perfOnly.rookie = true; app.topPerformancesCard(); ui.perfOnly.rookie = false;
      assert.equal(shownRows(), 300, 'a new filter starts over at 300');
    }
    // position and team are pill-style menus, then Rookies and Injured (in the Filters panel)
    ui.perfFiltOpen = true;
    html = app.topPerformancesCard();
    assert.ok(/<button type="button" class="pill pill-menu" data-action="perf-menu" data-menu="perfPos"[^>]*>All positions</.test(html) && /class="pill pill-menu" data-action="perf-menu" data-menu="perfTeam"[^>]*>All teams</.test(html));
    assert.ok(html.indexOf('data-menu="perfTeam"') < html.indexOf('data-key="rookie"') && html.indexOf('data-key="rookie"') < html.indexOf('data-key="inj"'));
    // each opens a box to pick any number from: a tap puts one in, another takes it out, "All" empties it
    assert.doesNotMatch(html, /pm-pop/, 'shut until asked for');
    app.actions['perf-menu']({ dataset: { menu: 'perfTeam' } });
    const pick = v => app.actions['perf-pick']({ dataset: { menu: 'perfTeam', val: v } });
    pick('OKC'); pick('LAC'); pick('BOS');
    assert.deepEqual([...ui.perfTeam], ['OKC', 'LAC', 'BOS']);
    html = app.topPerformancesCard();
    assert.match(html, /data-menu="perfTeam"[^>]*aria-expanded="true">3 teams</, 'the menu stays open and counts them');
    assert.match(html, /data-val="LAC" aria-pressed="true"/);
    pick('BOS');
    assert.match(app.topPerformancesCard(), /aria-expanded="true">LAC, OKC</, 'two fit by name');
    pick('');
    assert.equal(ui.perfTeam.length, 0);
    app.actions['perf-menu']({ dataset: { menu: 'perfTeam' } });
    assert.equal(ui.perfMenu, null);
    ui.perfOnly.rookie = true;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => !app.nbaById.get(id).exp), 'rookies only');
    ui.perfOnly.rookie = false; ui.perfOnly.inj = true;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).inj), 'injured only');
    ui.perfOnly.inj = false;
    // This season: every game so far, added up
    ui.perfRange = 'year';
    html = app.topPerformancesCard();
    const year = app.perfDays().year;
    assert.ok(year.length >= 5, 'the season so far');
    const tot = app.perfRows([...year]);
    assert.equal(count(html), tot.length);
    const top = tot.reduce((x, y) => (y.v > x.v ? y : x));
    assert.equal(ids(html)[0], top.raw.id, 'the most value over the season on top');
    assert.equal(+html.match(/<td class="sc pf-gp">(\d+)</)[1], top.g, 'his games, in their column');
    // no live updates for averages
    ui.perfRange = 'avg';
    ui.tab = 'players';
    assert.equal(app.liveWanted(), false);
  } finally { ui.perfRange = null; ui.perfQ = ''; ui.perfPos = []; ui.perfTeam = []; ui.perfMenu = null; Object.assign(ui.perfOnly, { rookie: false, inj: false }); ui.perfFiltOpen = false; ui.tab = 'standings'; }
});

test('performances: Active and Bench filters, and an Active badge', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  useTeam(L.teams[0].id);
  const spot = new Map(Object.values(L.rosters).flat().filter(x => x.nba).map(x => [x.nba, x.st]));
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  try {
    let html = app.topPerformancesCard();
    app.ui.perfFiltOpen = true;
    assert.ok(app.topPerformancesCard().includes('data-spot="all" aria-pressed="true"') && app.topPerformancesCard().includes('data-spot="active" aria-pressed="false"'), 'All by default');
    app.ui.perfFiltOpen = false;
    const rowsOf = h => h.split('<tbody>')[1].split('</tr>').slice(0, -1);
    const stOf = tr => spot.get(+tr.match(/data-nba="(\d+)"/)[1]);
    assert.ok(rowsOf(html).every(tr => tr.includes('lu-ico active') === (stOf(tr) === 'ACTIVE')), 'Active mark on exactly the active players');
    assert.ok(rowsOf(html).every(tr => tr.includes('lu-ico bench') === (!!stOf(tr) && stOf(tr) !== 'ACTIVE' && stOf(tr) !== 'INJURED_RESERVE')), 'Bench mark on the rest of the rostered players');
    // every rostered player names his fantasy team: yours in orange (mine), the opponent's in bold (opp)
    const me = app.get('state').fxTeam;
    assert.ok(rowsOf(html).filter(tr => tr.startsWith('<tr class="pf-me"') || tr.includes('<tr class="pf-me">')).every(tr => tr.includes('class="perf-owner mine"')), 'your team in orange');
    assert.ok(rowsOf(html).filter(tr => tr.includes('class="pf-opp"')).every(tr => tr.includes('class="perf-owner opp"')), 'the opponent in bold');
    assert.ok(me && html.includes('class="perf-owner mine"'));
    // IR: a red dot and the fantasy team's name
    const owners = new Map(Object.entries(L.rosters).flatMap(([tid, r]) => r.filter(x => x.nba).map(x => [x.nba, tid])));
    app.ui.perfRange = 'avg';
    const avg = rowsOf(app.topPerformancesCard()).filter(tr => stOf(tr) === 'INJURED_RESERVE');
    app.ui.perfRange = null;
    assert.ok(avg.length, 'IR players in Per game');
    for (const tr of avg) {
      const tid = owners.get(+tr.match(/data-nba="(\d+)"/)[1]);
      assert.ok(tr.includes('<span class="lu-ico ir" role="img" aria-label="On injured reserve" title="On injured reserve"></span>') && !tr.includes('>IR</span>'), 'red IR dot, no badge');
      // (its whole name as the tip: a long one is cut short with "…" on a computer)
      assert.ok(/<span class="perf-owner( mine| opp)?" title="[^"]+">/.test(tr) && tr.includes(` title="${app.esc(app.fxTeamName(tid))}">${app.teamLink(tid)}</span>`) && tr.includes(`data-action="team-card" data-team="${tid}"`), `${app.fxTeamName(tid)}'s IR player shows the team, a link to its card`);
    }
    app.ui.perfSpot = 'active';
    html = app.topPerformancesCard();
    assert.ok(ids(html).some(id => spot.has(id)) && ids(html).every(id => !spot.has(id) || spot.get(id) === 'ACTIVE'), 'Active: rostered players only if starting; waivers stay');
    app.ui.perfWhose = { me: true, opp: true, other: true, fa: false };
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => spot.has(id) && spot.get(id) === 'ACTIVE'), 'Active without waivers: starters only');
    app.ui.perfSpot = 'bench';
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => spot.has(id) && spot.get(id) !== 'ACTIVE'), 'Bench: bench and IR players only');
  } finally {
    Object.assign(app.ui, { perfWhose: { me: true, opp: true, other: true, fa: true }, perfSpot: 'all', perfFiltOpen: false });
  }
});

test("a points league's shooting pairs are one column on the Players tab, the team card and Trades too; DD and TD to one decimal", async () => {
  const text = html => ` ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const head = (html, cls) => text((html.match(new RegExp(`<table class="${cls}">\\s*<thead>([\\s\\S]*?)</thead>`)) || [])[1] || '');
  const together = t => t.includes(' FG ') && t.includes(' FT ') && !/FGM|FGA|FTM|FTA/.test(t);
  const L = await app.useLeague(ESPN); // scores FGM, FGA, FTM, FTA and 3PM
  const was = L.points, ui = app.get('ui'), range = ui.perfRange;
  L.points = { ...was, dd: 1, td: 2 };
  const [t1, t2] = app.fxPickable().map(t => t.id);
  useTeam(t1);
  try {
    // the Players tab, over the season: one "FG" column of makes/attempts, sorted by the points they score
    ui.perfRange = 'year';
    const perf = app.topPerformancesCard(), ph = head(perf, 'perf-table pl-table');
    assert.ok(together(ph), ph);
    assert.match(perf, /<td class="sc" title="FG: [+−]?\d+\.\d FP[^"]*">(<span[^>]*>[^<]*<\/span>)?\d+\/\d+<\/td>/, 'makes/attempts in one cell');
    // a team's card: By category
    const tc = app.teamCardHtml(t2);
    const cs = (tc.match(/<table class="cs-table">[\s\S]*?<\/table>/) || [''])[0];
    assert.ok(cs.includes('<b>FG</b>') && cs.includes('<b>FT</b>') && !/<b>(FGM|FGA|FTM|FTA)<\/b>/.test(cs), 'By category: one FG row');
    assert.match(cs, /<td class="num"><b>\d+\.\d\/\d+\.\d<\/b><span class="cs-avg">avg \d+\.\d\/\d+\.\d<\/span>/);
    // Trades: the deal's rows, the table, each player's line
    const mine = app.fxTeamSide(t1).players.filter(p => p.nbaId), theirs = app.fxTeamSide(t2).players.filter(p => p.nbaId);
    const T = { from: t1, to: t2, give: [String(mine[0].nbaId)], get: theirs.slice(0, 2).map(p => String(p.nbaId)) };
    const M = app.tradeModel(T), fg = M.rows.find(r => r.key === 'fgm');
    assert.ok(fg && fg.shot && /^\d+\.\d\/\d+\.\d$/.test(fg.sa) && / FP$/.test(fg.va), JSON.stringify(fg));
    assert.deepEqual([...M.rows.filter(r => r.shot).map(r => r.key)], ['fgm', 'ftm']);
    assert.ok(!M.rows.some(r => ['fga', 'fta'].includes(r.key)), 'no attempts row of their own');
    const card = app.tradeCard(T, app.tradeForYou(mine.slice(0, 1), theirs.slice(0, 2))), th = head(card, 'tp-table');
    assert.ok(together(th), th);
    assert.match(app.dealLine(M.A.players[0]).join(' · '), / · \d+\.\d\/\d+\.\d FG · \d+\.\d\/\d+\.\d FT · /);
    // DD and TD: one decimal where they're averages, whole in a game's line
    assert.equal(app.catDef('dd').dec, 1);
    ui.perfPer = true;
    const per = app.topPerformancesCard(), cols = head(per, 'perf-table pl-table').trim().split(' ').filter(c => c !== 'GP' && c !== 'MIN'); // (their cells are pf-gp, pf-min)
    const dd = [...per.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1, 4).map(m => [...m[1].matchAll(/<td class="sc"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]*)<\/td>/g)].map(x => x[1])[cols.indexOf('DD') - 1]);
    assert.ok(dd.length && dd.every(v => /^\d+\.\d$/.test(v)), `DD a game to one decimal: ${dd}`);
    assert.ok(text(app.lineChips({ min: 30, pts: 20, reb: 11, fgm: 8, fga: 15, dd: 1, gp1: 1 })).includes(' 1 DD '), 'a game: "1 DD", not "1.00"');
  } finally { L.points = was; ui.perfRange = range; ui.perfPer = false; }
});
