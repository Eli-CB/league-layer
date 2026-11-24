// League Layer: Loading leagues from Fantrax.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Any visitor's Fantrax league, fetched in the browser -----
// The daily data file carries NBA stats for everyone plus the site's default league. Fantrax's
// public league API allows requests from any site, so a visitor's own league can be loaded here.
// Public ESPN leagues load the same way (js/espn.js) into the same league shape, so the rest of the
// site doesn't care where a league came from; "fx" names (fxLeague, raw.fx, fxTeamSide) cover both.
const FX_API = 'https://www.fantrax.com/fxea/general/';
const NBA_POS_MAP = { G: ['PG', 'SG'], F: ['SF', 'PF'], C: ['C'], 'G-F': ['SG', 'SF'], 'F-G': ['SG', 'SF'], 'F-C': ['PF', 'C'], 'C-F': ['PF', 'C'] };
const FX_SLOT_MAP = { PG: 'PG', SG: 'SG', G: 'G', SF: 'SF', PF: 'PF', F: 'F', C: 'C', Flx: 'FLX', Util: 'FLX', UT: 'FLX' };

// Which site a league is on. ESPN league IDs are all digits, Sleeper's long ones (18 or 19 digits); Yahoo's are
// league keys ("nba.l.12345"); Fantrax's mix letters and digits.
const SOURCE_NAME = { fantrax: 'Fantrax', espn: 'ESPN', sleeper: 'Sleeper', yahoo: 'Yahoo' };
const leagueSourceOf = id => (/^(nba|\d+)\.l\.\d+$/.test(String(id || '')) ? 'yahoo' : /^\d{15,20}$/.test(String(id || '')) ? 'sleeper' : /^\d+$/.test(String(id || '')) ? 'espn' : 'fantrax');
const sourceName = (L = fxLeague()) => SOURCE_NAME[(L && L.source) || 'fantrax'];
// A league ID from what someone typed or pasted: the ID itself, or the league's address on either site
function parseLeagueId(text) {
  const s = String(text || '').trim();
  const y = s.match(/fantasysports\.yahoo\.com\/nba\/(\d+)/i);
  if (y) return `nba.l.${y[1]}`;
  if (/^(nba|\d+)\.l\.\d+$/.test(s)) return s;
  const sl = s.match(/sleeper\.(?:com|app)\/leagues\/(\d{15,20})/i);
  if (sl) return sl[1];
  if (/^\d{15,20}$/.test(s)) return s;
  const m = s.match(/[?&]leagueId=(\d+)/i) || s.match(/fantrax\.com\/fantasy\/league\/([A-Za-z0-9]+)/i);
  const id = m ? m[1] : s;
  return /^\d{3,12}$/.test(id) || /^[A-Za-z0-9]{6,32}$/.test(id) ? id : null;
}
const BAD_LEAGUE_ID = "That doesn't look like a league ID. Paste your league's address from Fantrax, ESPN or Sleeper, or just its ID.";
// A league that can't be read, said plainly: leagueError shows a plainError's message as it is
const plainError = msg => Object.assign(new Error(msg), { plain: true });
// The sports each site's leagues are read for (Yahoo's sign-in shows once Yahoo approves it: yahooOn)
const SITE_SPORTS = { Fantrax: ['basketball', 'hockey'], ESPN: ['basketball', 'football'], Sleeper: ['basketball', 'football'], Yahoo: ['basketball'] };
// A league of a sport the site doesn't read on that site, and the sites that sport works with
function sportNotRead(site, sport) {
  const s = String(sport).toLowerCase(), elsewhere = Object.keys(SITE_SPORTS).filter(k => k !== site && SITE_SPORTS[k].includes(s));
  return plainError(`That's ${/^[AEIOU]/.test(site) ? 'an' : 'a'} ${site} ${sport} league. On ${site}, League Layer covers ${SITE_SPORTS[site].join(' and ')} leagues${elsewhere.length ? `; ${s} works with ${elsewhere.join(' and ')} leagues` : ''}.`);
}
// Weekly lineup history (Season totals, Awards, Recap) is read from Fantrax and Sleeper (past seasons: Fantrax only)
const hasLineupHistory = L => !!L && ['fantrax', 'sleeper'].includes(L.source || 'fantrax');

// One request to a league site. "Too many requests", server errors and dropped connections are retried
// after a growing wait (the site's Retry-After when it sends one); anything else fails straight away.
// Fantrax says "too many requests" in a normal answer: { error: { code: 'RATE_LIMITED', message: '... may be called at
// most once every 5 seconds per IP address.' } } (getDraftResults: the current league and a past season loading
// together ask twice): that waits as long as it says and asks again too.
const pause = ms => new Promise(res => setTimeout(res, ms));
async function getJson(url, site, init, tries = 3) {
  for (let i = 0; ; i++) {
    let r = null;
    try { r = await fetch(url, init); } catch (e) { if (i >= tries - 1) throw new Error(`couldn't reach ${site}`); }
    if (r && r.ok) {
      const j = JSON.parse(await r.text()); // Fantrax serves JSON as text/plain
      if (!(j && j.error && j.error.code === 'RATE_LIMITED')) return j;
      if (i >= tries - 1) throw new Error(`${site} is busy (too many requests)`);
      await pause((+(String(j.error.message || '').match(/every (\d+) seconds?/) || [])[1] || 5) * 1000 + 250);
      continue;
    }
    if (r && r.status !== 429 && r.status < 500) throw new Error(`${site} answered ${r.status}`);
    if (i >= tries - 1) throw new Error(`${site} answered ${r ? r.status : 'nothing'}`);
    const after = r && r.headers && +r.headers.get('Retry-After');
    await pause(Math.min(after ? after * 1000 : 600 * 3 ** i, 10000));
  }
}
const fxGet = (path, tries) => getJson(FX_API + path, 'Fantrax', undefined, tries);
// Many requests at once (weekly rosters): a few at a time, and stop as soon as one fails for good. get: the site's
// request (Fantrax's unless given)
async function fxGetAll(paths, each, width = 4, get = fxGet) {
  let next = 0, failed = null;
  const worker = async () => {
    while (next < paths.length && !failed) {
      const path = paths[next++];
      try { each(path, await get(path)); } catch (e) { failed = failed || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, paths.length) }, worker));
  if (failed) throw failed;
}

// Keepers: only in leagues whose draft gives each team fewer picks than it has roster spots (starters
// plus bench; IR isn't filled at the draft). Then they're the players on a team's opening-week roster it
// didn't draft (before week 1 is over, its current roster). Team id -> [NBA ids]
function keepersOf(league) {
  const cfg = slotsFromLeague(league) || {};
  const ri = league.rosterInfo || {};
  const spots = ri.maxTotalActivePlayers != null && ri.maxTotalReservePlayers != null
    ? ri.maxTotalActivePlayers + ri.maxTotalReservePlayers : (cfg.slots || []).length + (cfg.bench || 0);
  if (!spots || !league.draft.rounds || league.draft.rounds >= spots) return {};
  const start = league.openingRosters || league.rosters;
  const out = {};
  for (const [tid, items] of Object.entries(start)) {
    const drafted = new Set(league.draft.picks.filter(p => p[2] === tid).map(p => p[3]));
    const kept = items.map(x => x.nba).filter(n => n && !drafted.has(n));
    if (kept.length) out[tid] = kept;
  }
  return out;
}

// Second pass for names written differently ("Cameron Thomas" on Fantrax, "Cam Thomas" on NBA.com):
// same last name, first initial and team. How Fantrax abbreviates teams (GS for GSW, say) is learned
// from the players that matched exactly. A player two Fantrax entries point to is left unmatched.
const nameKey = n => { const w = normName(n).split(' '); return w.length > 1 ? `${w[0][0]} ${w.slice(1).join(' ')}` : w[0]; };
// a player's position from the NHL or NBA, not what a league has made of it
const homePos = r => (r.basePos || r.pos)[0];
// role: what else tells two players apart (hockey: the Elias Petterssons, a center and a defenseman on one team)
function matchNicknames(ids, names, toNba, D = NBA, role = () => '') {
  const byId = new Map(D.players.map(r => [r.id, r]));
  const votes = {};
  for (const [fid, id] of Object.entries(toNba)) {
    const t = ids[fid].team, nt = (byId.get(id) || {}).team;
    if (t && nt) (votes[t] = votes[t] || {})[nt] = (votes[t][nt] || 0) + 1;
  }
  const team = Object.fromEntries(Object.entries(votes).map(([t, v]) => [t, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  const taken = new Set(Object.values(toNba));
  const open = new Map();
  for (const raw of D.players) if (!taken.has(raw.id)) { const k = `${nameKey(raw.name)}|${raw.team}|${role(homePos(raw))}`; open.set(k, open.has(k) ? null : raw.id); }
  const found = {}, claims = {};
  for (const [fid, v] of Object.entries(ids)) {
    if (toNba[fid] || !team[v.team]) continue;
    const id = open.get(`${nameKey(names[fid])}|${team[v.team]}|${role(v.position)}`);
    if (id) { found[fid] = id; claims[id] = (claims[id] || 0) + 1; }
  }
  for (const [fid, id] of Object.entries(found)) if (claims[id] === 1) toNba[fid] = id;
}

// A league site's players matched to NBA.com players by name (team breaks ties), then by nickname.
// ids: { site id: { team } }, names: { site id: "First Last" } -> { site id: NBA id }
function matchPlayers(ids, names, D = NBA, role = () => '') {
  const byName = new Map();
  for (const raw of D.players) {
    const n = normName(raw.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(raw);
  }
  const toNba = {};
  for (const [fid, v] of Object.entries(ids)) {
    const hits = byName.get(normName(names[fid])) || [];
    // the same name twice: by team and role, then either (one listed on another team mustn't take the other's id: the Sebastian Ahos)
    const same = h => role(homePos(h)) === role(v.position);
    const hit = hits.length > 1 ? (hits.find(h => h.team === v.team && same(h)) || hits.find(h => h.team === v.team) || hits.find(same) || hits[0]) : hits[0];
    if (hit) toNba[fid] = hit.id;
  }
  // two entries on one player, the other a namesake with no data here (or the league's site lists him twice): the one on
  // his team, in his role, keeps him, or the namesake takes his id and position
  const claims = new Map(), byId = new Map(D.players.map(r => [r.id, r]));
  for (const [fid, id] of Object.entries(toNba)) claims.set(id, [...(claims.get(id) || []), fid]);
  for (const [id, fids] of claims) {
    const raw = byId.get(id), own = fids.filter(f => ids[f].team === raw.team && role(ids[f].position) === role(homePos(raw)));
    if (fids.length > 1 && own.length === 1) for (const f of fids) if (f !== own[0]) delete toNba[f];
  }
  matchNicknames(ids, names, toNba, D, role);
  return toNba;
}

// Hockey's last pass, for a first name that shares nothing with the other's ("Benoit-Olivier" and "Bo" Groulx): the
// only unmatched player of his last name, team and role, on both sides
function matchLastNames(ids, names, toNba, D, role) {
  const taken = new Set(Object.values(toNba)), last = n => normName(n).split(' ').pop();
  const open = new Map(), want = new Map();
  for (const raw of D.players) if (!taken.has(raw.id)) { const k = `${last(raw.name)}|${raw.team}|${role(homePos(raw))}`; open.set(k, open.has(k) ? null : raw.id); }
  for (const [fid, v] of Object.entries(ids)) if (!toNba[fid]) { const k = `${last(names[fid])}|${v.team}|${role(v.position)}`; want.set(k, want.has(k) ? null : fid); }
  for (const [k, fid] of want) if (fid && open.get(k)) toNba[fid] = open.get(k);
}
const hockeyRole = pos => (pos === 'G' || pos === 'D' ? pos : 'F');

// "Last, First" -> "First Last"
const fxName = n => { const [last, first] = String(n).split(', '); return first ? `${first} ${last}` : String(n); };

// [{id, name, rank, w, l, t, gb}] from Fantrax's standings ("points" is "W-L-T")
function parseStandings(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r.teamId).map(r => {
    const [w, l, t] = String(r.points || '').split('-').map(n => +n || 0);
    return { id: r.teamId, name: r.teamName || '', rank: r.rank, w, l, t, gb: +r.gamesBack || 0, pf: r.totalPointsFor != null ? +r.totalPointsFor : null };
  });
}

// Points leagues: Fantrax's points per stat, mapped onto stats we can project. Matched by short name
// first, then by Fantrax's category code; anything else is listed as not projected.
const FX_PTS_SHORT = { PTS: 'pts', REB: 'reb', OREB: 'oreb', DREB: 'dreb', AST: 'ast', ST: 'stl', STL: 'stl', BLK: 'blk', TO: 'to',
  '3PTM': 'tpm', '3PM': 'tpm', '3PTA': 'tpa', '3PA': 'tpa', FGM: 'fgm', FGA: 'fga', FTM: 'ftm', FTA: 'fta', '2D': 'dd', DD: 'dd',
  '3D': 'td', TD: 'td', PF: 'pf', MIN: 'min', '+/-': 'pm', GP: 'gp1' };
const FX_PTS_CODES = [
  [/PERCENT|PCT/, null], [/OFFENSIVE_REB/, 'oreb'], [/DEFENSIVE_REB/, 'dreb'], [/REBOUND/, 'reb'],
  [/THREE.*MISS/, 'tpmi'], [/THREE.*ATTEMPT/, 'tpa'], [/THREE/, 'tpm'],
  [/TWO_POINT.*ATTEMPT/, 'fg2a'], [/TWO_POINT/, 'fg2m'],
  [/FREE_THROW.*MISS/, 'ftmi'], [/FREE_THROW.*ATTEMPT/, 'fta'], [/FREE_THROW/, 'ftm'],
  [/FIELD_GOAL.*MISS/, 'fgmi'], [/FIELD_GOAL.*ATTEMPT/, 'fga'], [/FIELD_GOAL/, 'fgm'],
  [/QUADRUPLE/, null], [/TRIPLE_DOUBLE/, 'td'], [/DOUBLE_DOUBLE/, 'dd'],
  [/ASSIST/, 'ast'], [/STEAL/, 'stl'], [/BLOCK/, 'blk'], [/TURNOVER/, 'to'],
  [/TECHNICAL|FLAGRANT|EJECT/, null], [/FOUL/, 'pf'], [/PLUS_MINUS/, 'pm'], [/MINUTE/, 'min'],
  [/GAMES?_PLAYED/, 'gp1'], [/POINTS$/, 'pts'],
];
// group: Fantrax's scoring group, which hockey needs (G is a goal for a skater and for a goalie); else one list
function fxStatKey(cat, group) {
  const short = String(cat.shortName || '').toUpperCase();
  const T = SPORTS.nhl.fxStats[group] || { short: FX_PTS_SHORT, codes: FX_PTS_CODES };
  if (T.short[short]) return T.short[short];
  const code = String(cat.code || '').toUpperCase();
  for (const [re, key] of T.codes) if (re.test(code)) return key;
  return null;
}
const fxGroup = cat => (cat.group && cat.group.code) || '';
// A league's sport, from its scoring groups (Fantrax doesn't name it): BASKETBALL_PLAYER, HOCKEY_SKATING / HOCKEY_GOALIE,
// GOLF_GOLFER... 'nba' or 'nhl', the ones read on Fantrax; another sport by its group's first word ('golf', 'football');
// a league whose groups don't say is taken for basketball, as before
const FANTRAX_SPORTS = ['nba', 'nhl'];
function fxSport(info) {
  const groups = ((info.scoringSystem || {}).scoringCategorySettings || []).map(fxGroup).filter(Boolean);
  if (groups.some(g => /^HOCKEY/.test(g))) return 'nhl';
  if (!groups.length || groups.some(g => /^BASKETBALL/.test(g))) return 'nba';
  return groups[0].split('_')[0].toLowerCase();
}

function fxPointsScoring(ss) {
  if (!ss || !/POINTS/.test(ss.type || '')) return {};
  const points = {}, other = [];
  let byPosition = false;
  for (const cat of ss.scoringCategorySettings || []) {
    for (const cfg of cat.configs || []) {
      const sc = cfg.scoringCategory || {};
      if (cfg.position && cfg.position.code !== 'DEFAULT') { byPosition = true; continue; }
      if (!+cfg.points) continue;
      const key = fxStatKey(sc, fxGroup(cat));
      if (key) points[key] = (points[key] || 0) + +cfg.points;
      else other.push(sc.shortName || sc.name || sc.code);
    }
  }
  if (byPosition) other.push('position-specific points');
  return Object.keys(points).length ? { points, pointsOther: other } : {};
}

// Category leagues: which categories count, in display order, plus any the site can't project (like A/TO)
function fxCategories(ss, sport = 'nba') {
  if (!ss || /POINTS/.test(ss.type || '')) return {};
  const T = SPORTS[sport], keys = new Set(), other = [];
  for (const cat of ss.scoringCategorySettings || []) {
    for (const cfg of cat.configs || []) {
      if (cfg.position && cfg.position.code !== 'DEFAULT') continue;
      const sc = cfg.scoringCategory || {};
      const short = String(sc.shortName || '').toUpperCase(), code = String(sc.code || '').toUpperCase();
      const is = (shorts, re) => shorts.includes(short) || re.test(code);
      // three-point first: its code also says FIELD_GOAL
      const key = sport === 'nhl' ? (is(['GAA'], /GOALS_AGAINST_AVERAGE/) ? 'gaa' : is(['SV%'], /SAVE.*(PERCENT|PCT)/) ? 'svPct' : is(['FO%'], /FACEOFF.*(PERCENT|PCT)/) ? 'foPct'
        : /%|\//.test(short) ? null : fxStatKey(sc, fxGroup(cat)))
        : is(['3PT%', '3P%', '3PM%'], /THREE.*(PERCENT|PCT)/) ? 'tpPct'
        : is(['FG%'], /FIELD_GOAL.*(PERCENT|PCT)/) ? 'fgPct'
        : is(['FT%'], /FREE_THROW.*(PERCENT|PCT)/) ? 'ftPct'
        : /PERCENT|PCT|%|RATIO|\//.test(`${short} ${code}`) ? null : fxStatKey(sc);
      if (key && (T.pctCats[key] || T.statLabel[key])) keys.add(key);
      else other.push(sc.shortName || sc.name || sc.code);
    }
  }
  return keys.size ? { cats: inCatOrder(keys, T.catOrder), catsOther: other } : {};
}
const fxScoring = (ss, sport = 'nba') => ({ ...fxPointsScoring(ss), ...fxCategories(ss, sport) });

// Typical length in days of a league's lineup lock periods: about 1 for daily lineups, 7 for weekly
function rosterPeriodDays(periods) {
  const lens = periods.slice(0, 6).map(p => (fxTime(p.endDate) - fxTime(p.startDate)) / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  return lens.length ? Math.round(lens[Math.floor(lens.length / 2)] * 100) / 100 : null;
}

// Fantrax's player list and ADP are the same for every league and barely change. The daily job saves them beside the
// sport's data (`fantrax.json`, fantrax_lists in scripts/update_data.py), so a site's worth of visitors doesn't each ask
// Fantrax for the same large lists: Fantrax itself only when that file is missing or over 2 days old (the job stopped).
// Kept on this device a day from when they were made, a list for each sport, with only what matching reads (name, team,
// position); the NHL's only those on a team (its whole list, everyone it has ever listed, is over 1 MB).
const FX_SHARED_KEY = 'league-layer-fantrax-shared-v1';
const fxSharedKey = sport => (sport === 'nba' ? FX_SHARED_KEY : `${FX_SHARED_KEY}-${sport}`);
const FX_LISTS_DAY = 864e5;
let fxShared = null, fxSharedOther = {};
async function fxListsFile(sport) {
  try {
    const r = await fetch(`${SPORTS[sport].data}fantrax.json`, { cache: 'no-cache' });
    const f = r.ok ? await r.json() : null, at = f && Date.parse(f.at);
    return f && f.ids && Date.now() - at < 2 * FX_LISTS_DAY ? { at, ids: f.ids, adp: Array.isArray(f.adp) ? f.adp : [] } : null;
  } catch (e) { return null; }
}
async function fxListsAsked(sport) {
  const [all, adp] = await Promise.all([fxGet(`getPlayerIds?sport=${SPORTS[sport].fantrax}`), fxGet(`getAdp?sport=${SPORTS[sport].fantrax}`).catch(() => [])]);
  const ids = Object.fromEntries(Object.entries(all).filter(([, v]) => sport === 'nba' || (v.team && v.team !== '(N/A)'))
    .map(([k, v]) => [k, { name: v.name, team: v.team, position: v.position }]));
  return { at: Date.now(), ids, adp: (Array.isArray(adp) ? adp : []).filter(a => a && a.id).map(a => ({ id: a.id, ADP: a.ADP })) };
}
async function fxPlayerLists(sport = 'nba') {
  let kept = sport === 'nba' ? fxShared : fxSharedOther[sport];
  if (!kept) kept = store.json(fxSharedKey(sport));
  if (!(kept && Date.now() - kept.at < FX_LISTS_DAY && kept.ids)) {
    kept = (await fxListsFile(sport)) || (await fxListsAsked(sport));
    store.setJson(fxSharedKey(sport), kept);
  }
  if (sport === 'nba') fxShared = kept; else fxSharedOther[sport] = kept;
  return kept;
}

async function fetchFantraxLeague(id, opts = {}) {
  const q = encodeURIComponent(id);
  // the league says its sport, which says whose players to match it to (nothing changes on the page until it's opened)
  const info = await fxGet(`getLeagueInfo?leagueId=${q}`);
  if (info.error || !info.teamInfo) throw new Error((info.error && info.error.message) || 'League not found');
  const sport = fxSport(info);
  // a sport the site doesn't read on Fantrax (golf, football...): said plainly, not loaded as basketball with no one matched;
  // which sports people try goes to the error log, to see what's wanted
  if (!FANTRAX_SPORTS.includes(sport)) {
    reportError(`Fantrax ${sport} league tried (not supported)`, 'js/fantrax.js');
    throw sportNotRead('Fantrax', sport);
  }
  const T = SPORTS[sport];
  // What can't change any more comes from the copy kept on this device, not asked for again: a finished draft (the request
  // Fantrax limits to once every 5 seconds) and, once week 1 is over, its rosters. The league is read more often since
  // Nov 24, 2026 (READ_PACE), so each read asks less. Not for a past season's read (opts.opening).
  const kept = opts.opening ? null : ((readLeagueCache()[id] || {}).res || {}).league || null;
  const keptDraft = kept && kept.draft && kept.draft.state === 'completed' ? kept : null;
  let [D, { ids, adp: adpList }, rosters, draftFirst, standings] = await Promise.all([
    SPORT.key === sport && NBA ? NBA : fetchSport(sport), fxPlayerLists(sport), fxGet(`getTeamRosters?leagueId=${q}`),
    keptDraft ? null : fxGet(`getDraftResults?leagueId=${q}`).catch(() => null), fxGet(`getStandings?leagueId=${q}`).catch(() => []),
  ]);
  // the draft can fail with everything else asking at once: once more on its own, a moment later. Still nothing is
  // a failure (draftFailed), not a league without a draft
  const draft = keptDraft ? null : draftFirst || await pause(1500).then(() => fxGet(`getDraftResults?leagueId=${q}`)).catch(() => null);
  // Fantrax hands out a new period's rosters from midnight, though the period starts at its first game (its start time):
  // until then the period just played is this one (weekStartAt), and the new one's lineups, still being set, are next
  // week's. Read as this week's, the Matchup tab drew the week just played with next week's lineups (Nov 23, 2026).
  // Weekly lineups only: a daily league's day is set up to its own games
  const weekly = rosterPeriodDays(info.rosterPeriods || []) >= 2;
  const rp = weekly && (info.rosterPeriods || []).find(p => p.number === rosters.period), rpAt = rp && rosters.period > 1 && fxTime(rp.startDate);
  const early = rpAt && Date.now() < rpAt ? rosters : null;
  if (early) {
    const prev = await fxGet(`getTeamRosters?leagueId=${q}&period=${early.period - 1}`).catch(() => null);
    if (prev && prev.period === early.period - 1) rosters = prev;
  }
  // the opening week's rosters: past seasons use them for keepers and pickups, and so does this season once week 1 is over
  const keptOpening = kept && (rosters.period || 1) > 1 && kept.openingRosters;
  const opening = !keptOpening && (opts.opening || (rosters.period || 1) > 1) ? await fxGet(`getTeamRosters?leagueId=${q}&period=1`).catch(() => null) : null;
  // weekly lineups: next week's too. This week's locked when it started, so the lineup people are setting is next week's
  const nextN = rosters.period && weekly && (info.rosterPeriods || []).some(p => p.number === rosters.period + 1) ? rosters.period + 1 : null;
  const next = early && early.period === nextN ? early : nextN && !opts.opening ? await fxGet(`getTeamRosters?leagueId=${q}&period=${nextN}`).catch(() => null) : null;

  const names = Object.fromEntries(Object.entries(ids).map(([fid, v]) => [fid, fxName(v.name || '')]));
  const hockey = sport === 'nhl', toNba = matchPlayers(ids, names, D, hockey ? hockeyRole : undefined);
  if (hockey) matchLastNames(ids, names, toNba, D, hockeyRole);
  const adp = Object.fromEntries((Array.isArray(adpList) ? adpList : []).filter(a => a.id).map(a => [a.id, a.ADP]));
  const fxPlayers = {};
  for (const [fid, pi] of Object.entries(info.playerInfo || {})) {
    const nba = toNba[fid];
    if (!nba) continue;
    const elig = new Set((pi.eligiblePos || '').split(','));
    for (const [broad, list] of Object.entries(T.broadPos)) if (elig.has(broad) && !list.some(x => elig.has(x))) for (const x of list) elig.add(x);
    fxPlayers[nba] = { id: fid, st: pi.status || '', pos: T.positions.filter(x => elig.has(x)), adp: adp[fid] };
  }
  const league = {
    id, source: 'fantrax', sport, name: info.leagueName || '', scoring: (info.scoringSystem || {}).type || '',
    historyId: info.leagueHistoryId || null, year: info.seasonYear || null,
    ...fxScoring(info.scoringSystem, sport),
    teams: Object.entries(info.teamInfo).map(([k, v]) => ({ id: k, name: v.name || '' })),
    periods: (info.scoringPeriods || []).map(p => ({ n: p.number, start: String(p.startDate).slice(0, 10), end: String(p.endDate).slice(0, 10), lock: String(p.startDate), endAt: String(p.endDate) })),
    lockDays: rosterPeriodDays(info.rosterPeriods || []),
    playoffPeriod: info.playoffs && info.playoffs.used ? info.playoffs.firstPlayoffPeriod : null,
    matchups: Object.fromEntries((info.matchups || []).map(m => [String(m.period),
      (m.matchupList || []).filter(x => x.away && x.away.id && x.home && x.home.id).map(x => [x.away.id, x.home.id])])),
    rosterPeriod: rosters.period,
    rosterPeriods: (info.rosterPeriods || []).map(p => [p.number, String(p.startDate), String(p.endDate)]),
    rosters: Object.fromEntries(Object.entries(rosters.rosters || {}).map(([tid, r]) => [tid,
      (r.rosterItems || []).map(it => ({ fid: it.id, nba: toNba[it.id] || null, name: names[it.id] || '', slot: it.position || '', st: it.status || '' }))])),
    nextRosters: next && next.period === nextN ? { period: nextN, rosters: Object.fromEntries(Object.entries(next.rosters || {}).map(([tid, r]) => [tid,
      (r.rosterItems || []).map(it => ({ fid: it.id, nba: toNba[it.id] || null, name: names[it.id] || '', slot: it.position || '', st: it.status || '' }))])) } : null,
    openingRosters: opening ? Object.fromEntries(Object.entries(opening.rosters || {}).map(([tid, r]) => [tid,
      (r.rosterItems || []).map(it => ({ fid: it.id, nba: toNba[it.id] || null, name: names[it.id] || '', st: it.status || '' }))])) : keptOpening || null,
    rosterInfo: info.rosterInfo || null,
    draft: keptDraft ? keptDraft.draft : null,
    draftAt: keptDraft ? keptDraft.draftAt : (draft && draft.draftDate) || null,
    standings: parseStandings(standings),
    ...(draft || keptDraft ? {} : { draftFailed: true }),
  };
  const picks = ((draft && draft.draftPicks) || []).filter(d => d.playerId);
  if (picks.length) {
    // Fantrax's times read as "2026-10-17T19:00:02.0-0400" (an offset without a colon, which not every browser takes)
    const at = s => { const m = String(s || '').match(/^(.+?)(?:\.\d+)?([+-]\d\d):?(\d\d)$/); return (m && Date.parse(`${m[1]}${m[2]}:${m[3]}`)) || null; };
    league.draft = {
      date: String(draft.draftDate || '').slice(0, 10), type: draft.draftType || '', state: draft.draftState || '',
      perRound: Math.max(...draft.draftPicks.map(d => d.pickInRound || 0)),
      start: at(draft.startDate), // (when the draft opened, and each pick's time: how long each took, for the Draft awards)
      picks: picks.map(d => [d.round, d.pick, d.teamId, toNba[d.playerId] || null, names[d.playerId] || '', d.time || null]),
      // pick slots per team, unused ones included
      rounds: Math.max(0, ...Object.values((draft.draftPicks || []).reduce((n, d) => { n[d.teamId] = (n[d.teamId] || 0) + 1; return n; }, {}))),
    };
    league.draft.keepers = keepersOf(league);
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}

// Swap the league the whole app works from; NBA stats stay as they are
function applyFantraxLeague({ league, fxPlayers }) {
  for (const raw of NBA.players) {
    const fx = fxPlayers[raw.id];
    raw.pos = fx && fx.pos.length ? fx.pos : raw.basePos;
    if (fx) raw.fx = { id: fx.id, st: fx.st, ...(fx.adp ? { adp: fx.adp } : {}) };
    else delete raw.fx;
  }
  NBA.league = league;
  changed('players');
}

// Roster slots from the league's settings (8 starters, bench and IR sizes)
// Our slot type for a Fantrax slot name; combo slots ("G/F", "F-C") are added on the fly
function fxSlot(name) {
  if (FX_SLOT_MAP[name]) return FX_SLOT_MAP[name];
  const parts = String(name).toUpperCase().split(/[\/-]/).filter(Boolean);
  const elig = [...new Set(parts.flatMap(x => ELIG[x] || []))];
  if (!elig.length) return 'FLX';
  if (parts.length === 1) return parts[0];
  const type = parts.join('/');
  if (!ELIG[type]) { ELIG[type] = POSITIONS.filter(x => elig.includes(x)); SLOT_TYPES.splice(SLOT_TYPES.indexOf('FLX'), 0, type); }
  return type;
}

function slotsFromLeague(league) {
  const ri = league && league.rosterInfo;
  if (!ri || !ri.positionConstraints) return null;
  const slots = [];
  const types = Object.entries(ri.positionConstraints).map(([k, v]) => [fxSlot(k), v.maxActive || 0]);
  for (const type of SLOT_TYPES) {
    for (const [t, n] of types) if (t === type) for (let i = 0; i < n; i++) slots.push(type);
  }
  if (!slots.length || (ri.maxTotalActivePlayers && slots.length !== ri.maxTotalActivePlayers)) return null;
  let bench = ri.maxTotalReservePlayers ?? null;
  let ir = ri.maxTotalPlayers && bench != null ? Math.max(0, ri.maxTotalPlayers - slots.length - bench) : null;
  // (IR spots can sit outside the limit)
  if (ir != null) ir = Math.max(ir, ...Object.values(league.rosters || {}).map(r => r.filter(it => it.st === 'INJURED_RESERVE').length));
  if (bench == null && ri.maxTotalPlayers) {
    // no reserve count: the rest of the roster is bench, and IR spots sit outside the limit
    bench = Math.max(0, ri.maxTotalPlayers - slots.length);
    ir = Math.max(1, ...Object.values(league.rosters || {}).map(r => r.filter(it => it.st === 'INJURED_RESERVE').length));
  }
  return { slots, bench, ir };
}

// ----- Fantrax league (positions, rosters, matchups) -----
// The league on screen: a past season (or this season's awards) can be viewed without touching the
// loaded league or your saved team, which stay as they are underneath.
let viewLeague = null, viewTeam = null;
// Browsing without a league (state.browse): none, though the daily file still carries the site's own (the demo)
const fxLeague = () => viewLeague || (!state.browse && NBA && NBA.league) || null;
// No league's rosters or positions on the players: nobody "free" in a league you're not in
function clearLeaguePlayers() {
  if (!NBA) return;
  for (const raw of NBA.players) { delete raw.fx; raw.pos = raw.basePos; }
  changed('players');
}
const myTeamId = () => (viewLeague ? viewTeam : state.browse ? SB_ME : state.fxTeam); // (the sandbox: its own roster, sandbox.js)
function viewingLeague(L, me, fn) {
  const was = [viewLeague, viewTeam];
  viewLeague = L; viewTeam = me;
  try { return fn(); } finally { [viewLeague, viewTeam] = was; }
}
// A = not on any roster (ESPN: free agent or on waivers; the league data doesn't say which)
const FX_STATUS = { T: 'Taken', W: 'Waivers', WW: 'Waivers', FA: 'Free agent', A: 'Available' };
const fxAvailable = raw => !!(raw && raw.fx && raw.fx.st !== 'T');

function fxPeriodFor(start) {
  const L = fxLeague();
  if (!L) return null;
  const mid = addDays(start, 3);
  return L.periods.find(p => p.start <= mid && mid <= p.end) || null;
}

// Every team in the league
const fxPickable = () => (fxLeague() ? fxLeague().teams : []);

function fxTeamName(id) {
  const L = fxLeague();
  const t = L && L.teams.find(x => x.id === id);
  return t ? t.name : !L && state.browse ? SANDBOX_SIDES[id] || '' : ''; // (the sandbox's two sides of a trade: sandbox.js)
}

function fxOpponentFor(start, teamId = state.fxTeam) {
  const L = fxLeague(), period = fxPeriodFor(start);
  if (!L || !period || !teamId) return null;
  const pair = (L.matchups[String(period.n)] || []).find(m => m.includes(teamId));
  if (!pair) return null;
  const id = pair[0] === teamId ? pair[1] : pair[0];
  return { id, name: fxTeamName(id), period: period.n };
}

// A Fantrax roster as players, with each one's lineup slot and status
// period: next week's lineups (L.nextRosters) when that's the week asked for; else this week's
function fxRoster(teamId, period) {
  const L = fxLeague(), next = L && period && L.nextRosters && L.nextRosters.period === period ? L.nextRosters.rosters : null;
  return (((next || (L && L.rosters)) || {})[teamId] || [])
    .map(it => ({ raw: it.nba ? nbaById.get(it.nba) : null, name: it.name, slot: it.slot === 'Flx' ? 'FLX' : it.slot, st: it.st }))
    .filter(x => x.raw);
}

// A league team as players, with Fantrax starters in their own slots and IR players on IR (a Sleeper taxi squad with them:
// neither can play)
function fxTeamSide(teamId, period) {
  const roster = fxRoster(teamId, period);
  const players = roster.map(x => playerFromRaw(x.raw));
  const lineup = Array(state.slots.length).fill(null);
  const leftover = [];
  roster.forEach((x, i) => {
    if (x.st !== 'ACTIVE') return;
    const slot = fxSlot(x.slot); // e.g. Fantrax "Flx" is our FLX
    const idx = state.slots.findIndex((s, j) => s === slot && !lineup[j]);
    if (idx !== -1) lineup[idx] = players[i].id; else leftover.push(players[i]);
  });
  for (const p of leftover) {
    const j = state.slots.findIndex((s, k) => !lineup[k] && canPlay(p, s));
    if (j !== -1) lineup[j] = p.id;
  }
  return {
    name: fxTeamName(teamId), players, lineup,
    il: players.filter((p, i) => roster[i].st === 'INJURED_RESERVE' || roster[i].st === 'TAXI').map(p => p.id),
    starters: players.filter((p, i) => roster[i].st === 'ACTIVE').map(p => p.id),
  };
}

// Compare against any team in the league: their roster and current Fantrax lineup
// For the site's own league, keep what only the daily file knows: keepers frozen at draft time
// (live rosters can't tell them from pickups) and the past seasons listed in league.json
function withSiteExtras(res) {
  const site = NBA.siteLeague;
  if (site && site.id === res.league.id) {
    if (site.pastSeasons) res.league.pastSeasons = site.pastSeasons;
    if (res.league.draft && site.draft && site.draft.date === res.league.draft.date && site.draft.keepers) res.league.draft.keepers = site.draft.keepers;
  }
  return res;
}

// Roster slots, bench and IR from the league's settings (they're the league's, not yours to edit)
function syncLeagueRules() {
  if (fxLeague()) state.lineupMode = leagueLineupMode(fxLeague());
  const cfg = slotsFromLeague(fxLeague());
  if (!cfg) return;
  state.slots = cfg.slots;
  if (cfg.bench != null) state.benchSize = cfg.bench;
  if (cfg.ir != null) state.ilSize = cfg.ir;
}

// ----- How often a league is read again from its site: THE place to turn it down -----
// One row per site, so one site can be turned down without the others (say Fantrax, ESPN or Sleeper asks about the
// requests coming from leaguelayer.com). Every read goes from each visitor's own browser: Fantrax 3-6 requests, ESPN 1,
// Sleeper about 7. ↻ Reload by hand always works (once in 2 minutes: RELOAD_COOL, actions.js).
//   open:  minutes. Opening the page (or picking the league), a copy older than this is drawn at once and read again
//          behind it. Raise it to read less (360 = six hours, as it was until Nov 24, 2026); 0: never on opening.
//   back:  minutes. Coming back to the page after a minute or more away (most moves are made on the league's own site, in
//          another tab or app), a copy older than this is read again. Raise it to read less; 0: off.
//   start: true: read 10-20 minutes before a matchup period's first game and 2-6 after (its locked lineups). false: off.
//   daily: true: in a daily-lineup league, the same around each game day's first game. false: off.
// What each does to a page: docs/fantrax.md (Rules settled with the owner). CLAUDE.md lists these values: change it with them.
const READ_PACE = {
  fantrax: { open: 30, back: 5, start: true, daily: true },
  espn: { open: 30, back: 5, start: true, daily: true },
  sleeper: { open: 30, back: 5, start: true, daily: true },
  yahoo: { open: 30, back: 5, start: true, daily: true },
};
const readPace = id => READ_PACE[leagueSourceOf(id)] || READ_PACE.fantrax;
// A copy this old is getting old: the Matchup tab's stamp says so in amber, and a read that fails says so (younger: quietly)
const LEAGUE_OLD_MS = 6 * 36e5;

// Every league loaded from its site is kept on this device (the five most recent). The site's own league uses it until
// the daily data file is newer; any other league until READ_PACE's open minutes, or ↻ Reload. Past that, a kept league
// is still drawn at once (anyAge) and read again from its site behind it (readLeagueBehind).
const FX_CACHE_KEY = 'league-layer-fantrax-v2';
const readLeagueCache = () => store.json(FX_CACHE_KEY, {});
function cachedLeague(id, anyAge = false) {
  const c = readLeagueCache()[id];
  if (!c || !c.res) return null;
  if (c.res.league.scoring === 'ROTO' && !c.res.league.roto) return null; // (an ESPN roto league kept before the site read roto: read again)
  const site = NBA && NBA.siteLeague && NBA.siteLeague.id === id, open = readPace(id).open;
  return (site ? c.at > Date.parse(NBA.updated || 0) : anyAge || !open || Date.now() - c.at < open * 60e3) ? c.res : null;
}
// kept here, but past READ_PACE's open minutes: drawn as it is while it's read again
const leagueStale = id => !cachedLeague(id) && !!cachedLeague(id, true);
// The site's own league, read this morning by the daily job: past the open minutes, read again behind the page too
const siteLeagueStale = id => { const open = readPace(id).open; return !!open && Date.now() - leagueReadAt(id) > open * 60e3; };
function saveLeague(id, res) {
  const all = readLeagueCache();
  all[id] = { at: Date.now(), res: { league: res.league, fxPlayers: res.fxPlayers } };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  store.setJson(FX_CACHE_KEY, Object.fromEntries(keep));
}
// A league from this device if it's fresh enough (anyAge: kept at all), else from its site (force: always from its site).
// A read already on its way is shared (↻ Reload while it's read behind the page: one read, not two).
const leagueReads = new Map(); // id -> its read from its site in progress
async function getLeague(id, force, anyAge = false) {
  const kept = force ? null : cachedLeague(id, anyAge);
  if (kept) return kept;
  if (!leagueReads.has(id)) {
    leagueReads.set(id, readLeague(id).finally(() => { leagueReads.delete(id); stampNow(); }));
    stampNow(); // (the Matchup tab's stamp: "reading")
  }
  return leagueReads.get(id);
}
// A league's read as it's compared: what a later read may change (not its future picks, read apart on the Trades tab, nor
// when this week's points were read, slpWeek.at: Sleeper's and ESPN football's, which made every read look new)
const leagueSig = res => JSON.stringify([{ ...res.league, futurePicks: null, slpWeek: res.league.slpWeek && { ...res.league.slpWeek, at: 0 } }, res.fxPlayers]);
async function readLeague(id) {
  const src = leagueSourceOf(id), was = readLeagueCache()[id];
  const res = await (src === 'espn' ? fetchEspnLeague(id) : src === 'sleeper' ? fetchSleeperLeague(id) : src === 'yahoo' ? fetchYahooLeague(id) : fetchFantraxLeague(id));
  // Nothing new on its site since the copy kept here, and that copy is what's drawn (the site's own league: not when this
  // morning's file is newer): same, so an automatic read leaves the page as it is, its odds and memos too, and only the
  // stamp's time moves (Nov 24, 2026: reads became frequent, and redrawing under someone mid-trade for nothing is worse)
  const site = NBA && NBA.siteLeague && NBA.siteLeague.id === id;
  res.same = !!(was && was.res && !(site && was.at <= Date.parse(NBA.updated || 0)) && leagueSig(was.res) === leagueSig(res));
  if (res.same && was.res.league.futurePicks) res.league.futurePicks = was.res.league.futurePicks;
  if (!res.league.draftFailed) saveLeague(id, res); // a league missing its draft is asked for again next time
  if (!res.same) changed('league', id); // its lineups, matchups and rosters may have changed: whatever was worked out from them goes
  return res;
}

// ----- Future draft picks, to trade -----
// A league's future picks: [{ year, round, from (whose pick it was), owner (who has it now) }]. Read from its site the first
// time the Trades tab needs them, then kept on the league (and with it on this device), so they're read again only with
// the league (READ_PACE), or ↻ Reload. Not with changed('league'), which a Sleeper league hears on game nights. None for a
// site that doesn't trade picks (ESPN; Yahoo here) or a league that doesn't (a Sleeper redraft league).
// Returns { list }, { loading }, or { error } (Try again: tradePicksRetry).
const picksLoads = new Map(); // league id -> the read in progress
function leaguePicks(L = fxLeague()) {
  const read = !L ? null : (L.source || 'fantrax') === 'fantrax' ? fetchFantraxPicks : L.source === 'sleeper' && L.pickInfo && L.pickInfo.type ? fetchSleeperPicks : null;
  if (!read) return { list: [] };
  if (L.futurePicks) return L.futurePicks;
  if (!picksLoads.has(L.id)) {
    picksLoads.set(L.id, read(L).then(list => {
      L.futurePicks = { list };
      const all = readLeagueCache();
      if (all[L.id]) { all[L.id].res.league.futurePicks = L.futurePicks; store.setJson(FX_CACHE_KEY, all); }
    }).catch(e => { L.futurePicks = { error: (e && e.message) || 'no answer' }; })
      .finally(() => { picksLoads.delete(L.id); if (ui.tab === 'trade') render(); }));
  }
  return { loading: true };
}
// Fantrax lists every future pick (getDraftPicks: futureDraftPicks; its currentDraftPicks are this draft's, unmade ones
// included, not for trading); a league that doesn't trade them answers an empty list
async function fetchFantraxPicks(L) {
  const r = await fxGet(`getDraftPicks?leagueId=${encodeURIComponent(L.id)}`);
  if (!r || r.error) throw new Error((r && r.error && r.error.message) || 'no answer');
  return (r.futureDraftPicks || []).map(p => ({ year: +p.year, round: +p.round, from: String(p.originalOwnerTeamId), owner: String(p.currentOwnerTeamId) }));
}

// Pull the league fresh from its site: matchups, rosters and lineups change during the week
async function refreshLeague(force = true, anyAge = false) {
  const id = state.fxLeagueId || (NBA.siteLeague && NBA.siteLeague.id);
  if (!id) return false;
  applyLeagueRead(id, await getLeague(id, force, anyAge));
  return true;
}
function applyLeagueRead(id, res) {
  const same = NBA.league && NBA.league.id === id;
  const before = same && state.fxTeam ? fxOpponentFor(weekStart()) : null;
  applyFantraxLeague(withSiteExtras(res));
  if (!state.fxTeam || !NBA.league.teams.some(t => t.id === state.fxTeam)) return;
  // follow your real opponent (and their latest roster) unless you'd picked someone else to scout
  const after = fxOpponentFor(weekStart());
  const cur = state.opp.fxId;
  if (after && (!cur || cur === after.id || (before && cur === before.id))) {
    const o = fxTeamSide(after.id);
    state.opp = { name: o.name, week: weekStart(), fxId: after.id, players: o.players, starters: o.starters, il: o.il };
  }
}

// A league drawn from this device past READ_PACE's open minutes (opening the page, or picking it in the league menu): read
// again from its site behind the page, then drawn again if anything changed (res.same: not). The page used to wait for it:
// on a visit's first load of the day "Loading" stayed up ~4 s, a Fantrax league being 4-5 requests one after another
// (Nov 21, 2026). The read goes on the page only if it's still on that league (not another league, the sandbox, the demo
// or a past season); if it fails, the kept copy stays, and says how old it is once that's past LEAGUE_OLD_MS (younger, the
// stamp's time is enough: a toast every half hour would nag). Its promise is kept for the tests.
let leagueBehind = null;
function readLeagueBehind(id) {
  const at = leagueReadAt(id);
  return (leagueBehind = getLeague(id, true).then(res => {
    if (currentLeagueId() !== id || state.browse || state.demo || ui.season || !NBA || !NBA.league || NBA.league.id !== id) return false;
    if (res.same) return true;
    applyLeagueRead(id, res);
    if (state.fxTeam && !NBA.league.teams.some(t => t.id === state.fxTeam)) state.fxTeam = null;
    if (state.fxTeam) syncLeagueRules();
    syncLinked();
    commit();
    return true;
  }, () => {
    if (currentLeagueId() === id && at && Date.now() - at > LEAGUE_OLD_MS) toast(`Couldn't reach ${SOURCE_NAME[leagueSourceOf(id)]} just now. Showing your league from ${ago(at)}.`);
    return false;
  }));
}

function loadFxTeam(teamId, week = weekStart()) {
  const side = fxTeamSide(teamId);
  const name = side.name;
  state.opp = { name, week, fxId: teamId, players: side.players, starters: side.starters, il: side.il };
  const opp = fxOpponentFor(week);
  commit(opp && opp.id === teamId ? `Loaded ${name}, your week ${opp.period} opponent` : `Scouting ${name}`);
}

// Viewing someone else's team: draw the week page from a throwaway copy of their matchup,
// so nothing about your own saved roster or opponent changes.
ui.viewA = null; // team whose side is on the left (null = yours)
ui.viewB = null; // who they're compared against (null = their real opponent)
const viewingOther = () => !!(ui.viewA && ui.viewA !== state.fxTeam && fxLeague());

// The roster period Matchups shows when it's next week's and that week's lineups are here (L.nextRosters), else null
function nextRosterPeriod(start = weekStart()) {
  const L = fxLeague(), N = L && L.nextRosters, rp = N && (L.rosterPeriods || []).find(r => r[0] === N.period);
  return rp && String(rp[1]).slice(0, 10) <= start && start < String(rp[2]).slice(0, 10) ? N.period : null;
}

// week: the Matchups tab, where next week shows next week's lineups as set on the league's site
function withViewedTeam(fn, week = false) {
  const n = week ? nextRosterPeriod() : null;
  if (!viewingOther()) {
    if (!n || !state.fxTeam) return fn();
    const me = fxTeamSide(state.fxTeam, n), o = state.opp.fxId ? fxTeamSide(state.opp.fxId, n) : null;
    return withState(saved => ({ ...saved, players: me.players, lineup: me.lineup, il: me.il, opp: o ? { ...saved.opp, players: o.players, starters: o.starters, il: o.il } : saved.opp }), fn);
  }
  const a = fxTeamSide(ui.viewA, n);
  const real = fxOpponentFor(weekStart(), ui.viewA);
  const bId = ui.viewB || (real && real.id);
  const b = bId ? fxTeamSide(bId, n) : null;
  const side = {
    teamName: a.name, players: a.players, lineup: a.lineup, il: a.il, sample: false,
    opp: b ? { name: b.name, week: weekStart(), fxId: bId, players: b.players, starters: b.starters, il: b.il } : { name: '', week: null, fxId: null, players: [], starters: null, il: [] },
  };
  ui.viewing = true;
  try { return withState(side, fn); } finally { ui.viewing = false; }
}

// Plan Ahead's opponent, picked where their name is on the scoreboard: the week's real one (marked) or any other team, to
// see how the week would go against them
function fxOppPicker(ctx) {
  const leftId = ui.viewing ? ui.viewA : state.fxTeam;
  const opp = fxOpponentFor(ctx.start, leftId); // the left team's real opponent that week
  const cur = state.opp.fxId;
  const when = ['last period', 'this period', 'next period'][ui.weekShift + 1] || 'that period';
  // (phones: the menu's too narrow for it, so the real opponent goes unmarked there)
  const phone = isPhone();
  return `<select class="ctx-team sb-opp" data-change="fx-opp" aria-label="Opponent">${cur ? '' : '<option value="">Pick a team</option>'}${fxPickable().filter(t => t.id !== leftId)
    .map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}${opp && t.id === opp.id && !phone ? ` (${when})` : ''}</option>`).join('')}</select>`;
}

// A team that isn't the week's real opponent says so, with the way back: one line across the top of the scoreboard, so
// both sides stay level (under the opponent's menu it took two or three lines on a phone, pushing that side's score down)
function fxOppNote(ctx) {
  const leftId = ui.viewing ? ui.viewA : state.fxTeam;
  const opp = fxOpponentFor(ctx.start, leftId), cur = state.opp.fxId;
  if (!cur || (opp && cur === opp.id)) return '';
  return `<div class="sb-hypo"><span class="badge warn">Hypothetical</span>${opp ? `<button class="link-btn quiet" data-action="${ui.viewing ? 'fx-view-actual' : 'fx-load-opp'}" title="Back to ${esc(opp.name)}, the real opponent">Back to ${esc(opp.name)}</button>` : ''}</div>`;
}

// A lineup deadline, short: "today 7:00 PM", "Mon 7:00 PM" in the coming six days, else "Mon, Dec 7, 7:00 PM"
function lockWhen(t) {
  const days = Math.round((Date.parse(isoDay(t) + 'T12:00') - Date.parse(todayIso() + 'T12:00')) / 864e5);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow'
    : t.toLocaleDateString(undefined, days < 7 ? { weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric' }) + (days < 7 ? '' : ',');
  return `${day} ${fmtTime(t)}`;
}
// Next to the week's dates: when lineups lock (weekly leagues: the week's first game, the deadline for setting them) or that
// they're locked (once it's started), and whose rosters these are
function fxWeekNotes(ctx) {
  const L = fxLeague();
  if (!L || !state.fxTeam) return '';
  const leftId = ui.viewing ? ui.viewA : state.fxTeam;
  const opp = fxOpponentFor(ctx.start, leftId);
  const over = ctx.dates[ctx.dates.length - 1] < todayIso();
  const shown = nextRosterPeriod(ctx.start) || L.rosterPeriod;
  const out = [];
  const longWhen = t => `${t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtTime(t)}`;
  if (ctx.locked && !over) {
    out.push(`<span title="Starters locked ${esc(longWhen(lockTime(ctx.start)))}, so this shows the lineups as set. Suggestions pick up again for next week.">lineups locked</span>`);
  } else if (ctx.weekly && !SPORT.gameLocks && !over && periodLock(ctx.start)) {
    // (a time not known yet, ESPN's or Yahoo's before game day: 7 PM ET, marked "~")
    const k = periodLock(ctx.start), t = new Date(k.at), about = k.known ? '' : 'about ';
    const tip = `The ${spanWord()} starts at its first game, ${about}${longWhen(t)}${k.known ? '' : ' (the exact time shows on game day)'}, and lineups lock then: set yours on ${sourceName(L)} before it.`;
    out.push(`<span title="${esc(tip)}">lineups lock <b>${k.known ? '' : '~'}${lockWhen(t)}</b></span>`);
  }
  if (!over && L.rosterPeriod && opp && opp.period !== shown) out.push(`rosters as of week ${shown}`);
  return out.map(x => ` · ${x}`).join('');
}

// No team picked yet: the one thing to do
const fxNoTeam = () => (fxLeague() && !state.fxTeam ? '<div class="fx-strip"><span>Pick your team at the top to load your roster and matchup.</span></div>' : '');

function validateLineup() {
  // (the sandbox: the league underneath keeps its lineup as it is; its spots may be another sport's, which this one's
  // table doesn't have)
  if (state.browse) return;
  const ids = new Set(state.players.map(p => p.id));
  state.il = state.il.filter(id => ids.has(id));
  const lu = Array(state.slots.length).fill(null);
  state.lineup.forEach((id, i) => {
    if (i >= lu.length || !id || !ids.has(id) || state.il.includes(id)) return;
    if (lu.includes(id)) return;
    if (canPlay(byId(id), state.slots[i])) lu[i] = id;
  });
  state.lineup = lu;
}

function rosterLimit() { return state.slots.length + state.benchSize; }
function activeCount() { return state.players.length - state.il.length; }
