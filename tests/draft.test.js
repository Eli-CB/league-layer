const { test, assert, sharedApp, CATS9, POINTS, ESPN, between, onDay, SLEEPER } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('draft grades per game and by season totals', async () => {
  await app.useLeague(CATS9);
  const ui = app.get('ui');
  for (const mode of ['game', 'total']) {
    ui.draftMode = mode;
    const d = app.draftData();
    const ranks = d.picks.map(p => p.rank).sort((x, y) => x - y);
    assert.deepEqual(ranks, d.picks.map((_, i) => i + 1), `${mode}: every pick gets one rank`);
    for (const p of d.picks) assert.equal(p.gain, p.pick - p.rank);
  }
  ui.draftMode = 'game';
});

test("a past season grades its keepers: the better one by the season before's value", async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  await app.loadGameLog('2025-26');
  const L = P.league;
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const names = L.draft.keepers[team.id].map(id => app.nbaById.get(id).name).sort();
  assert.deepEqual(names, ['Karl-Anthony Towns', 'Shai Gilgeous-Alexander']);
  assert.ok(Object.values(L.draft.keepers).every(k => k.length === 2), 'two keepers per team');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let d;
  try { app.withSeason(() => { d = app.draftData(); }); } finally { app.get('ui').season = null; }
  const ks = d.keepers[team.id];
  const by = Object.fromEntries(ks.map(k => [k.name, k]));
  // today's ADP says nothing about a 2025 draft: 2024-25's value per game picks the better keeper
  assert.equal(by['Shai Gilgeous-Alexander'].slot, 5, 'the 2024-25 MVP is the #5 pick');
  assert.equal(by['Karl-Anthony Towns'].slot, 15);
  assert.ok(ks.every(k => !k.past && Number.isFinite(k.gain) && k.like >= 1), 'graded against where each finished among the picks');
  assert.equal(by['Shai Gilgeous-Alexander'].gain, 5 - by['Shai Gilgeous-Alexander'].like);
  assert.ok(!d.picks.some(p => names.includes(p.name)), 'keepers are not draft picks');
  // Team drafts: a team's name opens its keepers and every pick, in draft order, for that season
  let card;
  app.get('ui').season = 'czqgnyozmf2tbr93';
  try {
    app.withSeason(() => {
      const ps = d.picks.filter(p => p.teamId === team.id);
      card = app.draftTeamCard(d, team.id, ps);
      const at = ps.sort((a, b) => a.pick - b.pick).map(p => card.html.indexOf(`>${p.name}<`));
      assert.ok(at.every((x, i) => x > 0 && (!i || x > at[i - 1])), 'every pick, in draft order');
    });
  } finally { app.get('ui').season = null; }
  assert.equal(card.title, "Eli's SGAteam: 2025-26 draft");
  assert.ok(names.every(n => card.html.indexOf(`>${n}<`) > 0 && card.html.indexOf(`>${n}<`) < card.html.indexOf('Picks</h3>')), 'keepers first');
});

test('keepers only in leagues whose draft leaves roster spots open', async () => {
  const pts = await app.useLeague(POINTS); // 14 rounds for 14 spots
  assert.equal(pts.draft.rounds, 14);
  assert.deepEqual({ ...pts.draft.keepers }, {}, 'a full-roster draft has no keepers, so pickups are not mistaken for them');
  const cats = await app.useLeague(CATS9); // 12 rounds for 13 spots
  assert.ok(cats.draft.rounds < 13);
  const counts = Object.values(cats.draft.keepers).map(k => k.length);
  assert.equal(counts.length, cats.teams.length);
  assert.ok(counts.every(n => n === 2), `keepers per team: ${counts}`);
});

test("Draft awards: Reach is the pick taken furthest ahead of consensus ADP, keepers off the board first; shareable", async () => {
  const L = await app.useLeague(CATS9);
  const d = app.draftData();
  assert.ok(d && d.picks.length > 20, 'the fixture league has a draft');
  const players = app.NBA.players, saved = players.map(r => [r, r.fx && { ...r.fx }, r.adp]);
  const setAdp = (r, v) => { r.fx = { ...(r.fx || {}), adp: v }; delete r.adp; };
  try {
    for (const r of players) { if (r.fx) delete r.fx.adp; delete r.adp; }
    // the keepers: the best ADPs of all, and still off the board (in a keeper league pick #1 is the first player after them)
    const keepers = Object.values(d.keepers).flat().map(k => k.nbaId);
    keepers.forEach((id, i) => setAdp(app.nbaById.get(id), i + 1));
    // every pick where consensus has him: no reach anywhere, so no award
    const picks = d.picks.filter(p => p.raw).sort((a, b) => a.pick - b.pick);
    picks.forEach(p => setAdp(p.raw, keepers.length + p.pick));
    assert.ok(!app.draftAwards(d).some(x => x.label === 'Reach'), 'nobody taken early');
    // one taken far ahead of consensus: his spot is last of the drafted players
    const reacher = picks[Math.floor(picks.length / 3)];
    setAdp(reacher.raw, 999);
    const awards = app.draftAwards(d), award = awards[0];
    assert.equal(award.label, 'Reach');
    assert.equal(award.p.nbaId, reacher.nbaId);
    const early = picks.length - reacher.pick;
    assert.equal(award.stats, `Taken #${reacher.pick}, ${early} picks early: consensus #${picks.length} (ADP 999.0)`, award.stats);
    assert.equal(award.text, `${reacher.name} (${app.fxTeamName(reacher.teamId)}): taken #${reacher.pick}, ${early} picks early: consensus #${picks.length} (ADP 999.0)`);
    // no Value Meal any more, and no emoji on any award (the owner's asks)
    assert.ok(!awards.some(x => x.label === 'Value Meal') && awards.every(x => !x.e));
    // on the Draft tab, with Share; shared as a picture or as the text and a link to the league's Draft tab
    const card = app.draftAwardsCard(d);
    assert.match(card, /data-action="draft-share"/);
    assert.ok(card.includes(`data-nba="${reacher.nbaId}"`));
    // drawn as the Recap's standouts: a player award a card with his photo, a team award a card of its line; no emoji
    assert.ok(card.includes('class="rx-card rx-player"') && !card.includes('pc-photo') && new RegExp(`class="rx-faces"><span class="hs[^"]*" style="[^"]*" data-photo="${reacher.nbaId}"`).test(card), 'his small round photo, never the big one');
    assert.equal((card.match(/class="rx-card rx-player"/g) || []).length, awards.filter(x => x.p).length);
    assert.ok(!/\p{Extended_Pictographic}/u.test(card), 'no emoji');
    // each award's title opens its breakdown: the 10 biggest reaches
    assert.match(card, /data-action="draft-award" data-key="Reach"/);
    const details = app.get('draftAwardDetails');
    const reaches = details.get('Reach').html;
    assert.ok(reaches.indexOf(`data-nba="${reacher.nbaId}"`) < reaches.indexOf('</li>'), 'the biggest reach first');
    assert.ok(reaches.includes(`<b class="aw-break-v ">${early} early</b>`), reaches.slice(0, 400));
    assert.ok((reaches.match(/<li>/g) || []).length <= 10);
    const doc = app.document, realQuery = doc.querySelector, els = {};
    doc.querySelector = sel => (['#infoBody', '#infoTitle', '#infoDialog'].includes(sel) ? (els[sel] = els[sel] || { innerHTML: '', textContent: '', open: false, showModal() { this.open = true; } }) : realQuery(sel));
    try {
      app.actions['draft-award']({ dataset: { key: 'Reach' } });
      assert.equal(els['#infoDialog'].open, true);
      assert.equal(els['#infoTitle'].textContent, 'Reach');
      assert.equal(els['#infoBody'].innerHTML, reaches);
    } finally { doc.querySelector = realQuery; }
    const S = app.draftShare(L, d, [award]);
    assert.ok(S.url.endsWith(`?league=${L.id}#draft`), S.url);
    assert.equal(S.text, `${L.name} · ${app.seasonLabel(L.year)} Draft Recap\n\nReach: ${award.text}`);
    assert.match(S.file, /-draft-recap\.png$/);
    // the Recap shares the same way
    assert.equal(typeof app.recapShare, 'function');
    // an ESPN or Sleeper league's players have the daily file's ADP (Fantrax's) instead
    assert.equal(app.adpOf({ adp: 12.5 }), 12.5);
    assert.equal(app.adpOf({ fx: { adp: 3 }, adp: 12.5 }), 3, "a Fantrax league's own first");
    // too few picks with an ADP to say: none of the ADP awards (the players' own, ages and teams, still)
    for (const p of picks.slice(0, Math.ceil(picks.length * 0.6))) delete p.raw.fx.adp;
    assert.ok(!app.draftAwards(d).some(x => ['Reach', 'Fall'].includes(x.label)));
    // a past season: today's ADP says nothing about its draft
    picks.forEach(p => setAdp(p.raw, keepers.length + p.pick));
    setAdp(reacher.raw, 999);
    app.set('seasonCtx', { basis: null, label: '2025-26' });
    assert.equal(app.draftAwards(d).length, 0);
  } finally {
    app.set('seasonCtx', null);
    for (const [r, fx, adp] of saved) { if (fx) r.fx = fx; else delete r.fx; if (adp != null) r.adp = adp; else delete r.adp; }
  }
});

test("Draft tab: a pick's fantasy team opens its card, and each team's best and worst pick open the player's", async () => {
  await app.useLeague(CATS9);
  const html = app.viewDraft();
  const best = html.split('<table class="dr-table">')[1].split('</table>')[0];
  const teamLinks = [...best.matchAll(/<div class="pmeta"><button[^>]*data-action="team-card" data-team="([^"]+)"/g)].map(m => m[1]);
  assert.equal(teamLinks.length, (best.match(/<tr class=/g) || []).length, 'every pick in Best picks: its team a link');
  const teams = html.split('<table class="dr-teams">')[1].split('</table>')[0];
  const rows = teams.split('<tr class=').slice(1);
  assert.ok(rows.length > 2);
  for (const r of rows) assert.equal((r.match(/data-action="player-detail"/g) || []).length, 2, 'its best and worst pick by name');
  // the draft awards come last: set once the draft is over, under the sections that change through the season
  assert.ok(html.includes('dr-awards'), 'the fixture draft has awards');
  assert.ok(html.indexOf('dr-awards') > html.indexOf('<table class="dr-board">'), 'under the draft board');
});

test('Draft awards: Fall, Glass, Young, Old, Homer and Passport', async () => {
  const L = await app.useLeague(CATS9);
  const [A, B, C] = L.teams.map(t => t.id);
  const players = app.NBA.players, archives = app.get('archives');
  const r = players.slice(0, 9), k = players[9];
  const saved = players.map(x => [x, x.fx && { ...x.fx }, x.adp]), fields = [...r, k].map(x => [x, x.born, x.team, x.exp, x.nat]);
  const y = +String(app.NBA.season).slice(0, 4), seasons = [app.seasonOf(y - 1), app.seasonOf(y - 2)];
  const hadArchives = seasons.map(s => [s, s in archives, archives[s]]);
  try {
    for (const x of players) { if (x.fx) delete x.fx.adp; delete x.adp; }
    const pick = (n, tid) => ({ round: Math.ceil(n / 3), pick: n, teamId: tid, nbaId: r[n - 1].id, raw: r[n - 1], name: r[n - 1].name });
    const d = { keepers: {}, date: '2026-10-20', picks: [pick(1, A), pick(2, B), pick(3, C), pick(4, A), pick(5, B), pick(6, C), pick(7, A), pick(8, C), pick(9, B)] };
    const [a1, b1, c1, a2, b2, c2, a3, c3, b3] = r; // (each team's picks, in draft order)
    // consensus as drafted, but #9 the top of the board: it fell 8 picks, every other a pick early
    r.forEach((x, i) => { x.fx = { ...(x.fx || {}), adp: i === 8 ? 0.5 : i + 1 }; });
    // A drafted young, all Thunder and American; B old, from three teams and three countries; C in between, two Celtics
    [[a1, '2005-06-01', 'OKC', 'US'], [a2, '2005-06-01', 'OKC', 'US'], [a3, '2005-06-01', 'OKC', 'US'], [b1, '1990-06-01', 'BOS', 'US'], [b2, '1990-06-01', 'LAL', 'FR'], [b3, '1990-06-01', 'MIA', 'CA'],
      [c1, '1998-06-01', 'BOS', 'US'], [c2, '1998-06-01', 'BOS', 'US'], [c3, '1998-06-01', 'DEN', 'RS']].forEach(([x, born, team, nat]) => Object.assign(x, { born, team, nat, exp: 5 }));
    // the last two seasons' games: A's 80 of 82; B's one 40, one out hurt both years (not in either archive), one 82;
    // C's a rookie (no seasons), one 82, one 70
    c1.exp = 0;
    const gp = new Map([[a1.id, 80], [a2.id, 80], [a3.id, 80], [b1.id, 40], [b3.id, 82], [c2.id, 82], [c3.id, 70]]);
    for (const s of seasons) archives[s] = { keys: ['gp'], players: new Map([...gp].map(([id, g]) => [id, { n: '', s: [g] }])) };
    const awards = app.draftAwards(d), get = label => awards.find(x => x.label === label);
    assert.deepEqual(Array.from(awards, x => x.label), ['Reach', 'Fall', 'Glass', 'Young', 'Old', 'Homer', 'Passport'], 'no Value Meal: gone');
    // Fall: the pick taken furthest past consensus
    assert.equal(get('Fall').text, `${b3.name} (${app.fxTeamName(B)}): taken #9, 8 picks late: consensus #1 (ADP 0.5)`);
    assert.equal(get('Fall').p.nbaId, b3.id);
    assert.ok(get('Fall').detail.html.includes('>8 late</b>'));
    // Glass: B's picks missed (42 + 42 + 82 + 82 + 0 + 0) / 6 = 41 a season; its most, the one out both years, named and on its card
    assert.equal(get('Glass').text, `${app.fxTeamName(B)}: their players missed 41 games a season, the last two seasons; most missed: ${app.lastName(b2.name)} (82 a season)`);
    assert.deepEqual(Array.from(get('Glass').faces, p => p.nbaId), [b2.id]);
    const glassRows = get('Glass').detail.html.split('<li>').slice(1);
    assert.deepEqual(Array.from(glassRows, x => x.match(/data-team="([^"]+)"/)[1]), [B, C, A], 'B 41, C 6 (its rookie left out), A 2');
    assert.match(glassRows[0], new RegExp(`most: <button[^>]*data-nba="${b2.id}"[^>]*>[^<]+</button>, 82 a season`));
    // Young and Old: average age on draft day
    const age = born => (Date.parse('2026-10-20T12:00:00') - Date.parse(`${born}T12:00:00`)) / (365.25 * 864e5);
    assert.equal(get('Young').text, `${app.fxTeamName(A)}: their players averaged ${age('2005-06-01').toFixed(1)} years old; youngest: ${app.lastName(a1.name)} (${Math.floor(age('2005-06-01'))})`);
    assert.equal(get('Old').text, `${app.fxTeamName(B)}: their players averaged ${age('1990-06-01').toFixed(1)} years old; oldest: ${app.lastName(b1.name)} (${Math.floor(age('1990-06-01'))})`);
    assert.deepEqual([get('Young').faces[0].nbaId, get('Old').faces[0].nbaId], [a1.id, b1.id], "the winner's youngest and oldest on their cards");
    assert.ok(get('Old').detail.html.indexOf(`data-team="${B}"`) < get('Old').detail.html.indexOf(`data-team="${A}"`), 'oldest first');
    // Homer: three Thunder, their faces on its card; Passport: three countries (players' nationalities, not their teams)
    assert.deepEqual(Array.from(get('Homer').faces, p => p.nbaId).sort(), [a1, a2, a3].map(x => x.id).sort(), "Homer's card: the faces of the players it names");
    assert.equal(get('Homer').text, `${app.fxTeamName(A)} has 3 Oklahoma City Thunder players: ${[a1, a2, a3].map(x => app.lastName(x.name)).join(', ').replace(/, ([^,]*)$/, ' and $1')}`);
    // their cards kept short (the owner's ask): the team and the number, Homer's faces and Passport's flags (most players first)
    assert.match(get('Homer').html, new RegExp(`^<b><button[^>]*data-team="${A}"[^>]*>[^<]+</button></b> [(]3 <button[^>]*>OKC</button>[)]$`));
    assert.equal(get('Passport').text, `${app.fxTeamName(B)}: their players came from 3 countries`);
    assert.match(get('Passport').html, new RegExp(`^<b><button[^>]*data-team="${B}"[^>]*>[^<]+</button></b> [(]3[)]$`));
    assert.deepEqual(Array.from(get('Passport').flags, r => Array.from(r)), [['US', 'FR', 'CA']]);
    assert.ok(!get('Passport').faces);
    assert.equal((app.draftAwardsCard(d).match(/class="rx-flags"><div>(<img class="flag"[^>]*>){3}<\/div><\/div>/g) || []).length, 1, "Passport's card: the winner's flags");
    const globeRows = get('Passport').detail.html.split('<li>').slice(1);
    assert.match(globeRows[0], />3 countries<\/b>/);
    assert.equal((globeRows[0].match(/<img class="flag"/g) || []).length, 3, "B's three flags");
    assert.match(globeRows.find(x => x.includes(`data-team="${C}"`)), /alt="United States"[^>]*>×2/, "C's two Americans: one flag, ×2");
    // a keeper counts with the picks in these (the team's roster on draft day): A keeps a 41-year-old French Thunder player
    Object.assign(k, { born: '1985-06-01', team: 'OKC', nat: 'FR', exp: 0 });
    d.keepers = { [A]: [{ nbaId: k.id, name: k.name }] };
    const withK = app.draftAwards(d), getK = label => withK.find(x => x.label === label);
    assert.equal(getK('Homer').text, `${app.fxTeamName(A)} has 4 Oklahoma City Thunder players: ${[a1, a2, a3].map(x => app.lastName(x.name)).join(', ')} and ${app.lastName(k.name)}`);
    assert.match(getK('Homer').detail.html, /\(keeper\)/, 'marked as a keeper in the breakdown');
    assert.equal(getK('Young').text, `${app.fxTeamName(A)}: their players averaged ${((3 * age('2005-06-01') + age('1985-06-01')) / 4).toFixed(1)} years old; youngest: ${app.lastName(a1.name)} (${Math.floor(age('2005-06-01'))})`);
    assert.match(getK('Passport').detail.html.split('<li>').slice(1).find(x => x.includes(`data-team="${A}"`)), />2 countries<\/b>/);
    assert.equal(getK('Fall').text, get('Fall').text, 'never in the ADP awards');
    d.keepers = {};
    // a tie names each team (with its real team on Homer's text); its card just the teams and their real teams' logos, no
    // room for faces
    c3.team = 'BOS';
    const tied = app.draftAwards(d).find(x => x.label === 'Homer');
    assert.equal(tied.text, `${app.fxTeamName(A)} (OKC) and ${app.fxTeamName(C)} (BOS) tied: 3 players each from one team`);
    assert.match(tied.html, new RegExp(`data-team="${A}".* and <b>.*data-team="${C}".*</b> [(]3[)]$`));
    assert.ok(!tied.faces);
    assert.deepEqual(Array.from(tied.logos), ['OKC', 'BOS']);
    const wasImg = app.get('IMG');
    try {
      app.set('IMG', { cols: 24, ids: [], logos: { OKC: 'data:image/svg+xml;base64,AAAA', BOS: 'data:image/svg+xml;base64,AAAA' } });
      assert.match(app.standoutCard(tied), /class="rx-logos"><img class="tlogo"[^>]*alt="OKC"[^>]*><img class="tlogo"[^>]*alt="BOS"/);
      app.set('IMG', { cols: 24, ids: [], logos: {} });
      assert.ok(!app.standoutCard(tied).includes('rx-logos'), 'only logos the site has (never the bare codes)');
    } finally { app.set('IMG', wasImg); }
    // the seasons' archives not in yet (on their way): no Glass until they are
    const loading = app.get('glassLoading');
    for (const s of seasons) { delete archives[s]; loading.add(s); }
    assert.ok(!app.draftAwards(d).some(x => x.label === 'Glass'));
    for (const s of seasons) loading.delete(s);
  } finally {
    for (const [x, born, team, exp, nat] of fields) Object.assign(x, { born, team, exp, nat });
    for (const [x, fx, adp] of saved) { if (fx) x.fx = fx; else delete x.fx; if (adp != null) x.adp = adp; else delete x.adp; }
    for (const [s, had, v] of hadArchives) { if (had) archives[s] = v; else delete archives[s]; }
  }
});

test("Draft awards: Trigger Finger and Clock Milker, from Fantrax's pick times (each team's average), with the winner's quickest or longest pick", async () => {
  const L = await app.useLeague(CATS9);
  const [A, B, C] = L.teams.map(t => t.id);
  // Fantrax's times come through with the draft: each pick's, and when the draft opened
  assert.equal(app.fxLeague().draft.picks[0].length, 6);
  const dd = app.draftData();
  assert.ok('at' in dd.picks[0] && 'start' in dd, 'the pick times reach the Draft tab');
  const r = app.NBA.players.slice(0, 9);
  const start = Date.parse('2026-10-17T23:00:00Z');
  // each pick's wait: A 5 s each; B 100, 100 and a 400 s pause; C 30 s each
  const wait = { [A]: [5, 5, 5], [B]: [100, 100, 400], [C]: [30, 30, 30] }, used = { [A]: 0, [B]: 0, [C]: 0 };
  const order = [A, B, C, C, B, A, A, B, C];
  let t = start;
  const picks = order.map((tid, i) => { t += wait[tid][used[tid]++] * 1000; return { round: Math.ceil((i + 1) / 3), pick: i + 1, teamId: tid, nbaId: r[i].id, raw: r[i], name: r[i].name, at: t }; });
  const d = { keepers: {}, date: '2026-10-17', start, picks };
  const get = label => app.draftAwards(d).find(x => x.label === label);
  // by the average (the owner's ask: one number), the pause in it; the winner's quickest (longest) pick named and its face on the card
  assert.equal(get('Trigger Finger').text, `${app.fxTeamName(A)}: their picks took 5 seconds on average; quickest: ${app.lastName(r[0].name)} (5s)`);
  assert.equal(get('Clock Milker').text, `${app.fxTeamName(B)}: their picks took 200 seconds on average; longest: ${app.lastName(r[7].name)} (400s)`);
  // on the card the player has a line of his own under the award's, in the lighter text (the owner's ask)
  assert.ok(!get('Trigger Finger').html.includes('quickest'));
  assert.match(app.standoutCard(get('Trigger Finger')), new RegExp(`<div class="rx-text">[^]*</div><div class="rx-aside">Quickest: <button[^>]*data-nba="${r[0].id}"[^>]*>[^<]+</button> [(]5s[)]</div>`));
  assert.deepEqual(Array.from(get('Trigger Finger').faces, p => p.nbaId), [r[0].id]);
  assert.deepEqual(Array.from(get('Clock Milker').faces, p => p.nbaId), [r[7].id]);
  assert.ok(get('Clock Milker').aside.includes(`data-nba="${r[7].id}"`), 'his name (on the line under the award) opens his card');
  const rows = get('Clock Milker').detail.html.split('<li>').slice(1);
  assert.deepEqual(Array.from(rows, x => x.match(/data-team="([^"]+)"/)[1]), [B, C, A], 'slowest first');
  assert.match(rows[0], new RegExp(`longest: <button[^>]*data-nba="${r[7].id}"[^>]*>[^<]+</button>, 400s</div>.*>200s</b>`));
  const fastRows = get('Trigger Finger').detail.html.split('<li>').slice(1);
  assert.deepEqual(Array.from(fastRows, x => x.match(/data-team="([^"]+)"/)[1]), [A, C, B], 'fastest first');
  assert.match(fastRows[2], />quickest: <button[^>]*>[^<]+<\/button>, 100s<\/div>/, "each team's quickest pick, not its longest");
  assert.ok(!/typical/.test(get('Trigger Finger').detail.html + get('Clock Milker').text), 'no typical pick any more');
  // a draft whose picks all carry one time (Fantrax rewrites an old draft's): no pick clocks
  for (const p of picks) p.at = start + 1000;
  assert.ok(!app.draftAwards(d).some(x => x.label === 'Trigger Finger' || x.label === 'Clock Milker'));
  // no times at all (ESPN, Sleeper, Yahoo): none either
  for (const p of picks) p.at = null;
  assert.ok(!app.draftAwards(d).some(x => x.label === 'Trigger Finger'));
});

test("a draft request that fails is tried again, and a draft that still won't come isn't kept as 'no draft'", async () => {
  const realFetch = app.fetch;
  let fails = 0;
  app.fetch = (url, init) => (String(url).includes('getDraftResults') && fails-- > 0
    ? Promise.resolve({ ok: false, status: 403, text: async () => '' }) : realFetch(url, init));
  try {
    fails = 1; // once: the second try brings it
    const once = await app.fetchFantraxLeague(POINTS);
    assert.ok(once.league.draft && once.league.draft.picks.length && !once.league.draftFailed);
    fails = 2; // twice: a failure, not a league without a draft
    forgetLeague(POINTS);
    const res = await app.getLeague(POINTS, true);
    assert.ok(res.league.draftFailed && !res.league.draft);
    assert.ok(!app.readLeagueCache()[POINTS], "not kept on the device, so it's asked for again");
    const was = app.NBA.league;
    app.NBA.league = res.league;
    try { assert.match(app.viewDraft(), /Couldn't load the draft[\s\S]*data-action="draft-retry"/); } finally { app.NBA.league = was; }
  } finally { app.fetch = realFetch; }
});

// drop a league from the device's league cache
function forgetLeague(id) { const all = app.readLeagueCache(); delete all[id]; app.localStorage.setItem(app.FX_CACHE_KEY, JSON.stringify(all)); }

test("this season's draft: graded by the season so far, unless the league started late or is over", async () => {
  await app.loadBoxes();
  await app.loadGameLog('cur');
  const F = await app.useLeague(CATS9);
  assert.equal(app.draftSeason(F, 'cur'), null, 'the league started on opening night and is on: its season so far is the NBA\'s');
  assert.equal(app.leagueSeason(await app.useLeague(SLEEPER)).to, '2027-04-04', "a Sleeper week ends with its Sunday's games");
  const E = await app.useLeague(ESPN); // starts in week 3, Nov 2
  const W = app.draftSeason(E, 'cur');
  assert.equal(W.win.from, '2026-11-02');
  assert.equal(W.stats.size, 0, 'none of the games so far (to Oct 26) were in its season');
  // once a league is over, the NBA games after its last week don't count
  const over = await onDay('2027-04-20', () => app.draftSeason(F, 'cur'));
  assert.ok(over && over.win.to === '2027-04-11', 'its last week ends Apr 11');
});
