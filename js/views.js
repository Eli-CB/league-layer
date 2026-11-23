// League Layer: Roster, Standings, Season totals (Trades: trades.js).
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

const DRAFT_MODE_KEY = 'league-layer-draft-mode';
ui.draftMode = store.get(DRAFT_MODE_KEY) || 'game';

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// A team's real per-game numbers: counting stats per player, FG%/FT% from makes ÷ attempts
function teamRaw(players) {
  const n = players.length || 1;
  const out = {};
  for (const c of scoreCats()) {
    if (c.fp) out.fp = sum(players.map(p => fantasyPoints(p))) / n;
    else if (c.pct) {
      const att = sum(players.map(p => statVal(p, c.att)));
      out[c.key] = att ? sum(players.map(p => statVal(p, c.made))) / att : 0;
    } else out[c.key] = sum(players.map(p => statVal(p, c.key))) / n;
  }
  // a points league's shooting pair (lineCats): makes and attempts per player, and its points (what it's ranked on) under `fgm:fp`
  for (const c of lineCats()) {
    if (!c.shot) continue;
    for (const k of [c.made, c.att]) out[k] = sum(players.map(p => statVal(p, k))) / n;
    out[`${c.key}:fp`] = sum(players.map(p => fantasyPoints(p, shotPoints(c)))) / n;
  }
  return out;
}

const fmtRaw = (c, v) => (c.pct ? fmtPct(v) : fmt(v, 1));
// a category's number in a team's per-player line (teamRaw): a shooting pair's as "4.8/10.2"
const rawShown = (c, raw) => (c.shot ? shotVol(raw[c.made], raw[c.att]) : fmtRaw(c, raw[c.key]));

// ----- A fantasy team's card: category strengths (was a card on Standings, for your own team only) -----
// Each team's best players by their season's value (seasonTotal), as many as the league starts (injured reserve left out):
// an end-of-bench player, a one-off start or a game or two doesn't move it. Per category: the team's number, the league's
// average, how far from it (in team-to-team spreads), its rank and every team on one line; a row opens to who helped and hurt
function teamStrengths(tid) {
  const N = state.slots.length;
  const top = id => { const s = fxTeamSide(id), il = new Set(s.il); return sortDesc(s.players.filter(p => !il.has(p.id)), p => seasonTotal(nbaById.get(p.nbaId)).v).slice(0, N); };
  const teams = fxPickable().map(t => { const ps = top(t.id); return { id: t.id, name: t.name, ps, raw: teamRaw(ps) }; }).filter(t => t.ps.length);
  const me = teams.find(t => t.id === tid), n = teams.length;
  if (!me || n < 2) return '';
  const rows = lineCats().map(c => {
    const key = c.shot ? `${c.key}:fp` : c.key; // (a shooting pair by its points)
    const vals = teams.map(t => t.raw[key]);
    const mean = sum(vals) / n;
    const sd = Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / n) || 1e-9;
    // how far each team is from the league average, in team-to-team spreads (fewer TO is better)
    const gap = v => (c.neg ? -1 : 1) * (v - mean) / sd;
    const z = gap(me.raw[key]);
    const rank = teams.filter(t => gap(t.raw[key]) - z > 1e-9).length + 1;
    // who helps or hurts: each player's own number against the league average shown in this row.
    // For FG%/FT% that's makes above or below average at the player's volume.
    const att = c.att;
    const num = p => (c.fp ? fantasyPoints(p) : c.shot ? fantasyPoints(p, shotPoints(c)) : statOf(p, c));
    const vol = p => shotVol(statVal(p, c.made), statVal(p, c.att));
    const impact = p => (c.neg ? -1 : 1) * (c.pct ? (pctOf(p, c) - mean) * statVal(p, att) : num(p) - mean);
    const byImpact = sortDesc(me.ps.map(p => ({ p, d: impact(p) })), x => x.d);
    const big = c.pct ? 0.1 : Math.max(0.1, Math.abs(mean) * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the league average of ${fmtPct(mean)} would give`
      : c.shot ? `${x.p.name}: ${vol(x.p)} ${c.label} a game, ${signed(num(x.p), 1)} FP, vs the league average of ${signed(mean, 1)} per player`
      : `${x.p.name}: ${fmt(num(x.p), 1)} ${c.label} a game vs the league average of ${fmt(mean, 1)} per player`;
    const csName = x => `<button type="button" class="link-btn cs-name" data-action="player-detail" data-nba="${x.p.nbaId}">${inlinePlayer(x.p, esc(nameShown(x.p.name, x.p.nbaId, 'last')))}</button>`;
    const csNum = x => `<b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : c.shot ? vol(x.p) : fmt(num(x.p), 1)}</b>`;
    const csAtt = x => (c.pct ? `<span class="muted small"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : '');
    const who = list => list.map(x => `<span class="cs-p" title="${esc(tip(x))}">${csName(x)}${csNum(x)}${csAtt(x)}</span>`).join('');
    const w = Math.min(Math.abs(z) / 2, 1) * 50; // bar edge = 2 spreads from the league average
    const pos = v => ((Math.max(-2.5, Math.min(2.5, gap(v))) + 2.5) / 5) * 100;
    const open = ui.csOpen.has(c.key);
    // the league's average (a shooting pair's: its makes and attempts, averaged over the teams)
    const avgShown = c.shot ? shotVol(sum(teams.map(t => t.raw[c.made])) / n, sum(teams.map(t => t.raw[c.att])) / n) : fmtRaw(c, mean);
    // every team on one line: this card's team the big dot, your own team orange (orange is only ever your team)
    const dot = t => `<span class="sdot${t.id === tid ? ' this' : ''}${t.id === state.fxTeam ? ' me' : ''}" style="left:${pos(t.raw[key]).toFixed(1)}%" title="${esc(t.name)}${t.id === state.fxTeam ? ' (you)' : ''}: ${rawShown(c, t.raw)}"></span>`;
    return `<tr class="cs-row" data-action="cs-toggle" data-cat="${c.key}" aria-expanded="${open}" title="Show who helped (green) and hurt (red) most">
      <td><span class="cs-chev" aria-hidden="true">▸</span><b>${c.label}</b></td>
      <td class="num"><b>${rawShown(c, me.raw)}</b><span class="cs-avg">avg ${avgShown}</span></td>
      <td class="num muted cs-lavg">${avgShown}</td>
      <td class="cs-bar" title="${signed(z, 2)} spreads from the league average"><span class="track"><span class="fill ${z >= 0 ? 'up' : 'down'}" style="width:${w}%"></span></span></td>
      <td class="num cs-rank ${rank <= 3 ? 'pos-good' : rank > n - 3 ? 'pos-bad' : ''}"><b>${ordinal(rank)}</b><span class="muted hide-sm"> / ${n}</span></td>
      <td class="cs-strip"><div class="strip">${teams.map(dot).join('')}</div></td>
    </tr>
    <tr class="cs-detail"${open ? '' : ' hidden'}><td colspan="6"><div class="cs-who">
      ${drivers.length || drag.length ? `${drivers.length ? `<div class="cs-grp">${who(drivers)}</div>` : ''}${drag.length ? `<div class="cs-grp">${who(drag)}</div>` : ''}` : '<span class="muted small">No one stands out</span>'}
    </div></td></tr>`;
  });
  const mine = tid === state.fxTeam;
  return `<div><h3 class="sub" style="margin-top:0">By category <span class="muted small" title="Each team's ${N} best players by their value this season (injured reserve left out), as many as a lineup starts">top ${N}, against every team</span> ${infoBtn('strengths')}</h3>
    <div class="table-wrap"><table class="cs-table">
      <thead><tr><th>Cat</th><th class="num">Per player</th><th class="num cs-lavg">League avg</th><th class="cs-bar">Below · league avg · above</th><th class="num">Rank</th><th class="cs-strip"><span class="hide-sm">Every team (${mine ? 'you in orange' : state.fxTeam ? 'this one bigger, you in orange' : 'this one bigger'})</span><span class="show-sm-inline">All ${n} teams</span></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div></div>`;
}

function slotBadge(slot) {
  const out = slot === 'IL' || slot === 'TAXI', pc = !out && slotColor(slot);
  const cls = out ? 'il' : `slot-${slot}${pc ? ` pc pc-${pc}` : ''}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot === 'IL' ? 'IR' : slot === 'TAXI' ? 'Taxi' : slot}</span>`;
}

// A sortable column header. down: whether this column is currently sorted biggest-first
function sortTh(action, key, label, sort, { cls = 'num', tip = '', down, attrs = '', arrow = true } = {}) {
  const on = sort.key === key;
  return `<th class="sortable ${cls}${on ? ' sorted' : ''}" data-action="${action}" data-key="${key}"${attrs}${tip ? ` title="${tip}"` : ''} aria-sort="${on ? (down ? 'descending' : 'ascending') : 'none'}">${label}${on && arrow ? (down ? ' ↓' : ' ↑') : ''}</th>`;
}
// Clicking a header: the same column flips; a new one starts at firstDir
function nextSort(sort, key, firstDir) {
  if (sort.key === key) sort.dir *= -1;
  else { sort.key = key; sort.dir = firstDir; }
}
// A sortable table's rows in the column's order: by valueOf (asked once a row), dir 1 smallest first, -1 biggest first;
// an empty cell (null) always last, and ties in the order the rows came in
function sortRows(rows, valueOf, dir) {
  const vals = new Map(rows.map(r => [r, valueOf(r)]));
  return [...rows].sort((a, b) => {
    const x = vals.get(a), y = vals.get(b);
    return x == null || y == null ? (x == null) - (y == null) : (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// a player's per-game row of SPORT.tableCols, then his value (minutes whole, the rest to one place)
function statCells(p) {
  return `${SPORT.tableCols.map(([k, , m, a]) => `<td class="num">${a ? fmtPct(p[a] ? statVal(p, m) / p[a] : 0) : fmt(p[k] || 0, k === 'min' ? 0 : 1)}</td>`).join('')}<td class="num"><b>${fmtValue(value(p))}</b></td>`;
}

/* ---------- Standings ---------- */

function viewStandings() {
  const L = fxLeague();
  if (L && L.roto) return rotoStandingsCard(L);
  const rows = (L && L.standings) || [];
  const S = L ? seasonLineups(L) : null; // (the season's lineups and games: Categories won and Season totals)
  return `
  <div class="card">
    ${rows.length ? `<div class="table-wrap"><table class="st-table">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Win %</th><th class="num">GB</th>${rows.some(r => r.pf != null) ? '<th class="num">Pts for</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => {
        const g = r.w + r.l + r.t;
        return `<tr${r.id === myTeamId() ? ' class="me-row"' : ''}><td class="num">${r.rank}</td><td><b>${teamLink(r.id, esc(r.name))}</b>${r.id === myTeamId() ? ' <span class="muted small">(you)</span>' : ''}</td>
          <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${g ? fmt(((r.w + r.t / 2) / g) * 100, 0) + '%' : '—'}</td><td class="num">${r.gb ? fmt(r.gb, 1) : '—'}</td>${rows.some(x => x.pf != null) ? `<td class="num">${r.pf != null ? fmtFp(r.pf) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table></div>${waiverLine()}` : `<div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div>`}
  </div>
  ${movesCard()}
  ${S && S.cw ? catsWonCard(rows, S.cw) : ''}
  ${L ? seasonTotalsCard(rows, S) : ''}`;
}

// ----- Moves this period: each team's adds, drops and trades this period (Standings, under the table) -----
// Team id -> [{ kind: 'add' | 'drop' | 'trade' (in) | 'away' (traded out), nba, name, from / to; a Sleeper waiver claim's
// bid; a draft pick traded, pick: { year, round, from: whose pick it was }; waiver budget traded, budget }]
// A player in a move: by his id on the league's site (fx.id), else his name: a Sleeper player with no NBA.com match from
// the daily file (slpNames: one dropped is on no roster), else the one the league's rosters give
function moveWho(L) {
  const fidNba = currentFidNba();
  const names = new Map(Object.values(L.rosters || {}).flat().map(x => [x.fid, x.name]));
  const slp = (L.source === 'sleeper' && NBA.slpNames) || {};
  return f => { const nba = fidNba(f), raw = nba && nbaById.get(nba); return { nba, name: raw ? raw.name : slp[f] || names.get(f) || 'A player' }; };
}
// Fantrax shares each period's rosters but no transaction log, so a move is a difference between the last period's
// rosters and this one's as they are now: on no roster before = added, on no roster now = dropped, on another team
// before = traded (on both teams). A player added and dropped in between isn't seen.
function periodMoves(L, weeks) {
  const cur = L.rosterPeriod;
  const now = cur && weeks && weeks.find(w => w.n === cur), before = now && weeks.find(w => w.n === cur - 1);
  if (!now || !before) return null;
  const who = moveWho(L);
  const out = {};
  const add = (tid, m) => (out[tid] = out[tid] || []).push(m);
  for (const [f, o] of now.owner) {
    const b = before.owner.get(f);
    if (!b) add(o.tid, { kind: 'add', ...who(f) });
    else if (b.tid !== o.tid) { add(o.tid, { kind: 'trade', from: b.tid, ...who(f) }); add(b.tid, { kind: 'away', to: o.tid, ...who(f) }); }
  }
  for (const [f, b] of before.owner) if (!now.owner.has(f)) add(b.tid, { kind: 'drop', ...who(f) });
  return out;
}
// Sleeper lists every transaction, by its week (transactions/<week>): the ones that went through (a failed waiver claim
// isn't a move), in that order. A trade gives each side what it got: players, draft picks and waiver budget (a player
// dropped to make room is a drop); a waiver claim keeps its bid; a commissioner's move counts as the team's.
// since: none from before it (Sleeper puts a dynasty league's whole offseason in week 1)
function sleeperMoves(L, txs, since = 0) {
  const who = moveWho(L);
  const out = {};
  const add = (tid, m) => (out[tid] = out[tid] || []).push(m);
  const done = (Array.isArray(txs) ? txs : []).filter(t => t && t.status === 'complete' && +t.status_updated >= since)
    .sort((a, b) => a.status_updated - b.status_updated);
  for (const t of done) {
    const adds = t.adds || {}, drops = t.drops || {};
    if (t.type === 'trade') {
      for (const [f, to] of Object.entries(adds)) {
        if (drops[f] == null) continue;
        const from = String(drops[f]);
        add(String(to), { kind: 'trade', from, ...who(f) });
        add(from, { kind: 'away', to: String(to), ...who(f) });
      }
      for (const k of t.draft_picks || []) {
        const pick = { year: +k.season, round: +k.round, from: String(k.roster_id) }, to = String(k.owner_id), from = String(k.previous_owner_id);
        add(to, { kind: 'trade', from, pick });
        add(from, { kind: 'away', to, pick });
      }
      for (const b of t.waiver_budget || []) {
        add(String(b.receiver), { kind: 'trade', from: String(b.sender), budget: +b.amount });
        add(String(b.sender), { kind: 'away', to: String(b.receiver), budget: +b.amount });
      }
      for (const [f, tid] of Object.entries(drops)) if (adds[f] == null) add(String(tid), { kind: 'drop', ...who(f) });
      continue;
    }
    const bid = t.type === 'waiver' ? +((t.settings || {}).waiver_bid) || 0 : 0;
    for (const [f, tid] of Object.entries(adds)) add(String(tid), { kind: 'add', ...who(f), ...(bid ? { bid } : {}) });
    for (const [f, tid] of Object.entries(drops)) add(String(tid), { kind: 'drop', ...who(f) });
  }
  return out;
}
// The period's moves: { n: the period, at: as of when, rosters: from the rosters (Fantrax), moves (null: none to show) }.
// Sleeper's: one request, for the week on now (sleeperWeekNow), counting from a week before it starts
function loadMoves(L) {
  if (L.source === 'sleeper') {
    const n = sleeperWeekNow(L.periods || []), p = (L.periods || []).find(x => x.n === n);
    if (!p) return Promise.resolve({ moves: null });
    const since = new Date(`${addDays(p.start, -7)}T00:00:00`).getTime();
    return slpGet(`league/${encodeURIComponent(L.id)}/transactions/${n}`).then(txs => ({ n, at: Date.now(), moves: sleeperMoves(L, txs, since) }));
  }
  return loadRosterWeeks(L).then(w => ({ n: L.rosterPeriod, at: (readLeagueCache()[L.id] || {}).at, rosters: true, moves: periodMoves(L, w || []) }));
}
const movesLoad = new WeakMap(); // league -> its moves (loadMoves), once read: a league read again (↻ Reload) reads them again
// This season only: a past season's last period says nothing now. On phones it rolls up even though it's the tab's
// first section with a heading (class "rolls", rollCards): Categories won stays the open one, as before
function movesCard() {
  const L = fxLeague();
  const slp = !!L && L.source === 'sleeper';
  if (!NBA || ui.season || seasonCtx || !L || !(slp || (hasLineupHistory(L) && L.rosterPeriod > 1))) return '';
  if (!movesLoad.has(L)) {
    movesLoad.set(L, null);
    loadMoves(L).catch(() => ({ moves: null })).then(r => movesLoad.set(L, r)).finally(() => { if (ui.tab === 'standings') render(); });
  }
  const got = movesLoad.get(L);
  const card = (sub, body) => `<div class="card rolls" style="margin-top:16px">
    <div class="card-head"><h2>Moves this period ${infoBtn(slp ? 'movesSlp' : 'moves')}</h2>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>${body}</div>`;
  if (!got) return card('', loadingLine(slp ? "Loading Sleeper's transactions…" : "Loading last period's rosters…"));
  const { moves } = got;
  if (!moves) return '';
  const me = myTeamId();
  const order = { add: 0, trade: 1, away: 2, drop: 3 };
  const tids = Object.keys(moves).sort((a, b) => (b === me) - (a === me) || moves[b].length - moves[a].length);
  const SIGN = { add: '+', drop: '−' }, SAID = { add: 'added', drop: 'dropped', trade: 'traded for' }; // (a trade either way: ⇄)
  // what moved: a player (his card), a draft pick (named as on Trades) or waiver budget
  const what = (m, tid) => (m.pick ? `<span class="mv-what">${pickName(m.pick)} pick${m.pick.from !== (m.kind === 'away' ? tid : m.from) ? ` <span class="muted small">originally ${esc(fxTeamName(m.pick.from))}</span>` : ''}</span>`
    : m.budget != null ? `<span class="mv-what">$${fmt(m.budget, 0)} of waiver budget</span>`
    : m.nba ? inlinePlayer({ nbaId: m.nba, name: m.name }, playerBtn(m.nba, m.name))
    : m.name !== 'A player' ? inlinePlayer({ nbaId: null, name: m.name }, esc(m.name)) : esc(m.name)); // (no NBA team: his initials, no card)
  const other = m => (m.kind === 'trade' ? ` <span class="muted small">from ${esc(fxTeamName(m.from))}</span>` : m.kind === 'away' ? ` <span class="muted small">to ${esc(fxTeamName(m.to))}</span>`
    : m.bid ? ` <span class="muted small" title="Waiver bid">$${fmt(m.bid, 0)}</span>` : '');
  const move = (m, tid) => `<li class="mv mv-${m.kind}"><span class="mv-k" aria-hidden="true">${SIGN[m.kind] || '⇄'}</span>${what(m, tid)}${other(m)}<span class="sr-only">${SAID[m.kind] || 'traded away'}</span></li>`;
  const body = tids.length ? `<div class="mv-teams">${tids.map(tid => `<div class="mv-team${tid === me ? ' me' : ''}"><div class="mv-name">${teamLink(tid)}</div>
      <ul class="mv-list">${[...moves[tid]].sort((a, b) => order[a.kind] - order[b.kind]).map(m => move(m, tid)).join('')}</ul></div>`).join('')}</div>`
    : '<p class="muted small" style="margin:0">No moves yet this period.</p>';
  // the line: how many moves (each piece of a trade once), and yours
  const n = Object.values(moves).flat().filter(m => m.kind !== 'away').length;
  const mineM = moves[me] || [], cnt = k => mineM.filter(m => m.kind === k).length;
  const yours = [cnt('add') && `+${cnt('add')}`, cnt('trade') && `⇄${cnt('trade')}`, cnt('drop') && `−${cnt('drop')}`].filter(Boolean).join(' ');
  const sub = n ? `${yours ? `you ${yours} · ` : ''}${n} move${n === 1 ? '' : 's'}` : '';
  return card(sub, `${body}${got.at ? `<p class="muted small mv-when">Period ${got.n} · ${got.rosters ? 'rosters ' : ''}as of ${fmtTime(got.at, { weekday: 'short' })} · ↻ Reload in ⚙ for the latest</p>` : ''}`);
}

// ----- A fantasy team's card: its record and this week's opponent (the title), its category strengths (teamStrengths), its roster -----
let teamCardOpen = null; // the fantasy team whose card is showing, for its table's sort (team-sort)
function showTeamCard(tid, sorting) {
  if (!sorting) ui.teamSort = { key: 'v', dir: -1 }; // (a card just opened: best first by the last column)
  const html = teamCardHtml(tid);
  if (!html) return;
  teamCardOpen = tid;
  $('#detailBody').innerHTML = html;
  $('#detailTitle').innerHTML = teamCardTitle(tid);
  cardOpen = null;
  sportCardOpen = null;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
  if (!sorting) $('#detailBody').scrollTop = 0;
}
// the card's title: the team's name, (you) on your own, then its record, standing, points for and this week's opponent
// (as an NBA team's card)
function teamCardTitle(tid) {
  const L = fxLeague(), r = L && (L.standings || []).find(x => x.id === tid), opp = L && fxOpponentFor(weekStartAt(0), tid);
  const of = r && `${ordinal(r.rank || 0)} of ${fxPickable().length}`;
  // (a roto league: its points and standing, and no weekly opponent to name)
  const bio = (isRoto() ? [r && `<span class="dt-rec">${fmtRotoPts(r.pts)}</span> roto points · ${of}`]
    : [r && `<span class="dt-rec">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</span> · ${of}${r.pf != null ? ` · ${fmtFp(r.pf)} points for` : ''}`,
      `<span class="dt-vs">${opp ? `This week vs <span class="dt-rec">${teamLink(opp.id)}</span>` : 'No matchup this week'}</span>`]).filter(Boolean).join(' · ');
  return `<span class="dt-name">${esc(fxTeamName(tid))}${tid === state.fxTeam ? ' <span class="muted small">(you)</span>' : ''}</span><span class="dt-bio">${bio}</span>`;
}

function teamCardHtml(tid) {
  const L = fxLeague();
  if (!L || !fxPickable().some(t => t.id === tid)) return '';
  const side = fxTeamSide(tid), me = tid === state.fxTeam;
  const football = isFootball(), week = matchDates(weekStartAt(0));
  // each player's worth: football's projection this week, else his value over the whole season (seasonTotal: a game or
  // two can't top the list), with its games
  const tot = new Map(side.players.map(p => [p.id, seasonTotal(nbaById.get(p.nbaId))]));
  const worth = p => (football ? (gamesIn(p, week) ? `${fmt(footballPts(p, week), 1)}` : '<span class="muted">Bye</span>') : tot.get(p.id).gp ? fmtTotal(tot.get(p.id).v) : '—');
  const unit = football ? 'Proj' : totalLabel();
  // each player's season a game, as the Players tab's Per game shows it (the stats chosen under Stats used): games, minutes,
  // then the league's categories (a points league: every stat it scores, a shooting pair as one "11.9/25.6 FG": lineCats);
  // football shows its projection alone
  const cols = football ? [] : lineCats().filter(c => !c.fp);
  const cell = (p, c) => {
    if (!p.gp) return '<td class="sc muted">—</td>';
    if (c.shot) return `<td class="sc" title="${c.label}: ${signed(fantasyPoints(p, shotPoints(c)), 1)} FP a game">${shotVol(statVal(p, c.made), statVal(p, c.att))}</td>`;
    if (!c.pct) return `<td class="sc">${fmt(statVal(p, c.key), c.dec || 1)}</td>`;
    const m = statVal(p, c.made), a = statVal(p, c.att);
    return `<td class="sc"${c.rate ? '' : ` title="${c.label}: ${fmt(m, 1)}/${fmt(a, 1)} a game"`}>${!a ? '—' : c.rate ? fmt(m / a, 2) : fmtPct(m / a)}</td>`;
  };
  // the player: photo, name, then his positions in their lineup-spot colors and his NBA team; any injury under it
  const who = p => {
    const raw = nbaById.get(p.nbaId) || {};
    const inj = p.inj ? `<div class="pmeta inj" title="${esc(p.inj.note)}">${esc(p.inj.label)}${p.inj.note ? ': ' + esc(p.inj.note) : ''}</div>` : '';
    return `<td class="pf-name"><div class="bplayer">${headshot(p, 34)}<div class="bmain">
      <div class="bname">${p.nbaId ? playerBtn(p.nbaId, p.name) : `<span class="pname">${esc(p.name)}</span>`}${rookieBadge(raw, 'by-name')}</div>
      <div class="pmeta">${rookieBadge(raw, 'in-meta')}${[posTags(p.pos), p.team && teamBtn(p.team)].filter(Boolean).join(' · ')}</div>${inj}</div></div></td>`;
  };
  // every player in one list, best first by what the last column shows (football: this week's projection, a bye last),
  // or by the column whose heading was clicked (ui.teamSort; a player with nothing in that column always last);
  // injured reserve greyed where it falls (the owner's ask: no starters / bench split)
  const il = new Set(side.il);
  const order = p => (football ? (gamesIn(p, week) ? footballPts(p, week) : -1) : tot.get(p.id).gp ? tot.get(p.id).v : -1e9);
  const row = p => `<tr${il.has(p.id) ? ' class="muted-row"' : ''}>${who(p)}${football ? '' : `<td class="sc">${tot.get(p.id).gp || '—'}</td><td class="sc">${p.gp ? fmt(p.min, 1) : '—'}</td>`}${cols.map(c => cell(p, c)).join('')}<td class="num pf-v">${worth(p)}</td></tr>`;
  const so = ui.teamSort;
  const pctOf = (p, c) => { const a = statVal(p, c.att); return a ? statVal(p, c.made) / a : null; };
  const sortVal = p => (so.key === 'v' ? ((football ? gamesIn(p, week) : tot.get(p.id).gp) ? order(p) : null) : so.key === 'name' ? p.name.toLowerCase() : so.key === 'gp' ? tot.get(p.id).gp || null
    : !p.gp || (so.key !== 'min' && !cols[so.key]) ? null : so.key === 'min' ? p.min : cols[so.key].shot ? fantasyPoints(p, shotPoints(cols[so.key])) : cols[so.key].pct ? pctOf(p, cols[so.key]) : statVal(p, cols[so.key].key));
  const rows = sortRows(sortDesc(side.players, order), sortVal, so.dir).map(row).join(''); // (ties stay best first)
  const th = (key, label, cls, tip, attrs) => sortTh('team-sort', key, label, so, { cls, tip, attrs, down: so.dir < 0 });
  const cats = football ? '' : teamStrengths(tid);
  // (each part 16 px below the one before: .tc-body)
  return `<div class="tc-body">
    ${!me && state.fxTeam && !isRoto() ? `<div><button type="button" class="btn sm" data-action="team-compare" data-team="${esc(tid)}">Compare on Plan Ahead</button></div>` : ''}
    ${cats}
    <div class="perf-wrap"><table class="perf-table tc-roster"><thead><tr>${th('name', 'Player', 'pf-name')}${football ? '' : th('gp', 'GP', 'sc', 'Games played') + th('min', 'MIN', 'sc', 'Minutes a game')}${cols.map((c, i) => th(i, c.label, 'sc')).join('')}${th('v', unit, 'num pf-v', '', football ? '' : ` data-tip="${esc(seasonTotalTip())}"`)}</tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

// ----- Season totals: what each team's starters actually produced -----
// Fantrax returns every lineup period's rosters. A player's games count for a team only in periods he
// was ACTIVE there, using this season's box scores (data/boxscores.json, loaded when Standings opens).
let boxLoad = null;
let BOX = null; // { byPlayer, finals } once data/boxscores.json has loaded
keep('sport', () => { BOX = null; boxLoad = null; });
const seasonTot = {}; // league id -> { state: 'loading' | 'ready' | 'error', teams, msg }
keep('box league', id => dropKept(seasonTot, id));

function rosterPeriodsOf(L) {
  if (L.rosterPeriods && L.rosterPeriods.length) return L.rosterPeriods.map(([n, start, end]) => ({ n, start, end }));
  return (L.periods || []).map(p => ({ n: p.n, start: p.lock, end: p.endAt })); // weekly leagues lock by scoring period
}
// a game day belongs to a period from its first day; the last day only if the period runs into the night
const periodHas = (p, d) => d >= p.start.slice(0, 10) && (d < p.end.slice(0, 10) || (d === p.end.slice(0, 10) && +p.end.slice(11, 13) >= 21));

// a box score line with the counts some leagues score: double-doubles, triple-doubles, games
function boxCounts(st) {
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(k => st[k] >= 10).length;
  return Object.assign(st, { dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 });
}

// The season's box scores as the daily job publishes them: one file per month (NBA.box: month -> its version, which is in
// the file's address), so the browser keeps a finished month and downloads only the month underway each day. A data file
// from before months had the whole season in boxscores.json, new every day.
async function boxFiles() {
  const dir = SPORT.data, months = Object.entries(NBA.box || {});
  const get = url => getJson(url, 'League Layer', undefined, 3); // (a dropped connection or a server hiccup: asked again)
  if (!months.length) return get(`${dir}boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`);
  const parts = await Promise.all(months.map(([month, v]) => get(`${dir}box/${month}.json?v=${v}`)));
  return { ...parts[0], games: Object.assign({}, ...parts.map(p => p.games)) };
}

// (a load started for another sport, finishing after a switch, isn't this page's: it gives way to this sport's load. It
// used to land in BOX, the other sport's games under this one's players, and could leave a tab on "Loading" until a click)
let boxFail = ''; // the last load's failure, for a tab with nothing else to show (boxWait)
keep('sport', () => { boxFail = ''; });
function loadBoxes() {
  if (boxLoad) return boxLoad;
  const sport = SPORT;
  const load = boxLoad = boxFiles().then(data => {
    if (SPORT !== sport) return loadBoxes();
    const unique = new Map(), cols = data.keys || SPORT.boxCols; // (a box row's columns, as boxGameLog reads them too)
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    const scores = new Map(); // "date team" -> { home, away, hs, as, last } (last: hockey's REG / OT / SO)
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      const s = { home: g.home, away: g.away, hs: g.hs, as: g.as, last: g.last };
      scores.set(`${g.d} ${g.home}`, s).set(`${g.d} ${g.away}`, s);
      for (const row of g.rows) {
        const st = boxCounts(Object.fromEntries(cols.map((k, i) => [k, +row[i + 2] || 0])));
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin, row[1]]);
      }
    }
    BOX = { cols, byPlayer, finals, scores, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
    boxFail = '';
    dropPlayedInjuries();
    return BOX;
  }).catch(e => { if (boxLoad === load) { boxLoad = null; boxFail = e.message || 'no answer'; } throw e; });
  return load;
}
// A tab that needs the box scores and has nothing to show without them (Live, Trends): loads them (drawn again when
// they're in), and meanwhile a loading card, or what went wrong with Try again ('box-retry')
function boxWait(tab, title, text) {
  if (boxFail && !boxLoad) return `<div class="card"><div class="empty"><strong>Couldn't load the box scores</strong>${esc(boxFail)}. <button type="button" class="link-btn" data-action="box-retry">Try again</button></div></div>`;
  loadBoxes().then(() => { if (ui.tab === tab) render(); }).catch(() => { if (ui.tab === tab) render(); });
  return loadingCard(title, text);
}

// This season's Season totals and Awards: the shared weekly rosters (Fantrax ids) mapped to NBA players
const currentFidNba = () => { const m = new Map(NBA.players.filter(r => r.fx).map(r => [r.fx.id, r.id])); return f => m.get(f) || null; };
async function buildSeasonTotals(L) {
  const [weeks, G] = await Promise.all([loadRosterWeeks(L), loadGameLog('cur')]);
  if (!weeks || !G) return { teams: {}, cw: null };
  const LL = { ...L, weeks, fidNba: currentFidNba() };
  return { teams: pastSeasonTotals(LL, G), LL, G }; // (Categories won is counted when drawn: seasonLineups)
}

// The Standings tab's season so far, for Categories won and Season totals: { teams, cw } once its lineups and games are in
// (teams: pastSeasonTotals; cw: catsWonRecords, null in a points league or before a week is over), else { msg } meanwhile.
// A past season: its weekly lineups and its saved game log; this season: the weekly lineups and box scores, loaded once
function seasonLineups(L) {
  if (seasonCtx) {
    if (!L.weeks) return { msg: "Fantrax didn't return this season's weekly rosters." };
    if (!L.season || !(L.season in gameLogs)) {
      if (L.season) loadGameLog(L.season).then(() => { if (ui.tab === 'standings' && ui.season) render(); });
      return { msg: L.season ? `${loaderMark('sm')}Loading the season’s games…` : `No ${SPORT.name} game logs are saved for this season.` };
    }
    const G = gameLogs[L.season];
    if (!G) return { msg: `No ${SPORT.name} game logs are saved for this season (the site has 2016-17 on).` };
    return { teams: pastSeasonTotals(L, G), cw: catsWonRecords(L, G) };
  }
  if (!hasLineupHistory(L)) return { msg: `Season totals need every day's lineups, which the site reads from Fantrax and Sleeper only for now, not ${sourceName(L)}.` };
  const id = L.id, S = seasonTot[id];
  if (!S) {
    seasonTot[id] = { state: 'loading' };
    buildSeasonTotals(L).then(t => { seasonTot[id] = { state: 'ready', ...t }; })
      .catch(e => { seasonTot[id] = { state: 'error', msg: e.message }; })
      .finally(() => { if (ui.tab === 'standings' && !ui.season) render(); });
  }
  if (!S || S.state === 'loading') return { msg: `${loaderMark('sm')}Loading every lineup from Fantrax…` };
  if (S.state === 'error') return { msg: `Couldn't load season totals (${esc(S.msg)}).` };
  // (counted here, with the league on the page: its categories, and the weeks over by now)
  if (!('cw' in S)) S.cw = catsWonRecords(S.LL, S.G);
  return S;
}

// ----- Categories won: each team's categories won, lost and tied against its opponents, in all and one by one -----
// Every finished regular-season matchup, counted from the week's real lineups and box scores as the Recap counts a final
// (weekScore). Team id -> { w, l, t, weeks, by: [{ w, l, t }] in scoreCats' order }, or null: a points league, or no week
// over yet. L: with its weekly lineups (weeks) and fidNba, as pastSeasonTotals takes it
function catsWonRecords(L, G) {
  if (isPoints() || isFootball() || !L || !L.weeks || !G) return null;
  const cats = scoreCats(), out = {};
  for (const p of (L.periods || []).filter(x => (!L.playoffPeriod || x.n < L.playoffPeriod) && periodOver(x))) {
    const pairs = ((L.matchups || {})[String(p.n)] || []).filter(m => m.length === 2);
    // the lineup periods that start within it (the week, or each of its days in a daily league), as benchSwaps finds them
    const rps = L.weeks.filter(w => fxTime(w.start) >= fxTime(p.lock) && fxTime(w.start) < fxTime(p.endAt));
    if (!pairs.length || !rps.length) continue;
    const tot = pastSeasonTotals({ ...L, weeks: rps }, G);
    for (const [a, b] of pairs) {
      const sc = weekScore((tot[a] || {}).s || {}, (tot[b] || {}).s || {});
      for (const [tid, sign] of [[a, 1], [b, -1]]) {
        const R = out[tid] = out[tid] || { w: 0, l: 0, t: 0, weeks: 0, by: cats.map(() => ({ w: 0, l: 0, t: 0 })) };
        R.weeks++;
        sc.lead.forEach((x, i) => { const k = x * sign > 0 ? 'w' : x * sign < 0 ? 'l' : 't'; R[k]++; R.by[i][k]++; });
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

// The card: categories won, lost and tied and the share won, then each category's weeks won-lost (-tied), shaded by how
// often the team takes it; standings order until a column is picked (ui.cwSort, as Season totals)
function catsWonCard(standings, cw) {
  const cats = scoreCats();
  const order = standings.length ? standings.map(r => r.id) : fxPickable().map(t => t.id);
  const list = order.filter(tid => cw[tid]).map(tid => ({ tid, R: cw[tid] }));
  if (!list.length) return '';
  const share = x => (x.w + x.l + x.t ? (x.w + x.t / 2) / (x.w + x.l + x.t) : 0);
  const rec = x => `${x.w}-${x.l}${x.t ? '-' + x.t : ''}`;
  const ties = list.some(x => x.R.t);
  const so = ui.cwSort;
  if (so.key != null && !['team', 'w', 'l', 't', 'pct'].includes(so.key) && !cats[so.key]) so.key = null;
  if (so.key === 't' && !ties) so.key = null;
  const sortVal = x => (so.key === 'team' ? (fxTeamName(x.tid) || '').toLowerCase() : so.key === 'w' ? x.R.w : so.key === 'l' ? -x.R.l
    : so.key === 't' ? x.R.t : so.key === 'pct' ? share(x.R) : share(x.R.by[so.key]));
  const rows = so.key != null ? sortRows(list, sortVal, -so.dir) : [...list];
  const th = (key, label, cls = 'num', tip = '') => sortTh('cw-sort', key, label, so, { cls, tip, down: so.dir > 0 });
  const weeks = Math.max(...list.map(x => x.R.weeks));
  return `<div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Categories won ${infoBtn('catsWon')}</h2><span class="muted small">${weeks} week${weeks === 1 ? '' : 's'}, against each week's opponent</span></div>
    <div class="table-wrap"><table class="cats-won">
      <thead><tr>${th('team', 'Team', '')}${th('w', 'W', 'num', 'Categories won')}${th('l', 'L', 'num', 'Categories lost')}${ties ? th('t', 'T', 'num', 'Categories tied') : ''}${th('pct', 'Win %', 'num', 'Share of categories won, a tie counting half')}${cats.map((c, i) => th(i, c.label, 'num', `Weeks won-lost in ${c.label}`)).join('')}</tr></thead>
      <tbody>${rows.map(x => `<tr${x.tid === myTeamId() ? ' class="me-row"' : ''}><td><b>${teamLink(x.tid, esc(fxTeamName(x.tid) || ''))}</b></td>
        <td class="num"><b>${x.R.w}</b></td><td class="num">${x.R.l}</td>${ties ? `<td class="num">${x.R.t}</td>` : ''}<td class="num">${fmt(share(x.R) * 100, 0)}%</td>
        ${cats.map((c, i) => { const b = x.R.by[i]; return `<td class="num" style="${shadeProb(share(b))}" title="${c.label}: won ${b.w}, lost ${b.l}${b.t ? `, tied ${b.t}` : ''} of ${x.R.weeks} week${x.R.weeks === 1 ? '' : 's'}">${rec(b)}</td>`; }).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

// A season's totals: every game each starter played in a week he was in the lineup, from the weekly
// rosters (kept on this device) and that season's game log (archived, or this season's box scores)
function pastSeasonTotals(L, G) {
  const teams = {};
  for (const w of L.weeks) {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (!o.on) continue;
      const T = teams[o.tid] = teams[o.tid] || { gp: 0, s: {} };
      const nba = L.fidNba(f);
      // one-game leagues: only the game that counted
      for (const r of countedRows(L, G, w, f, ((nba && G.players.get(nba)) || []).filter(r => wd.has(r[0])))) {
        T.gp++;
        for (const [k, v] of Object.entries(gameLine(G, r))) T.s[k] = (T.s[k] || 0) + v;
      }
    }
  }
  return teams;
}

// S: seasonLineups' answer (its message while the lineups and games aren't in)
function seasonTotalsCard(standings, S) {
  // Sleeper basketball: its lineups can't give Lock-In's real scores (slpWeekPts, sleeper.js), so these are estimates and
  // its fantasy points are the standings' Pts for, Sleeper's own
  const est = slpEstimated(fxLeague());
  const head = `<div class="card-head"><h2>Season totals ${infoBtn(est ? 'slpScores' : 'totals')}</h2><span class="muted small">${est ? "estimated from each week's final lineups" : `from each ${leagueLineupMode(fxLeague()) === 'daily' && !isFootball() ? "day's" : "week's"} starting lineups`}</span></div>`;
  if (S.msg) return `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">${S.msg}</p></div>`;
  const teams = S.teams;

  // totals of any scored stat, derived ones included
  const tot = (T, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (T.s[b] || 0) * c)) : T.s[k] || 0);
  const sc = leaguePoints();
  const cols = sc
    ? [...inCatOrder(Object.keys(STAT_LABEL).filter(k => sc[k])).map(k => ({ label: STAT_LABEL[k], neg: sc[k] < 0, val: T => tot(T, k), fmt: v => fmt(v, 0) })),
      ...(est ? [] : [{ label: 'FP', val: T => sum(Object.entries(sc).map(([k, v]) => tot(T, k) * v)), fmt: v => fmtFp(v) }])]
    : scoreCats().map(c => ({ label: c.label, neg: c.neg,
      val: c.pct ? (T => (tot(T, c.att) ? tot(T, c.made) / tot(T, c.att) : 0)) : T => tot(T, c.key),
      fmt: c.pct ? fmtPct : v => fmt(v, c.dec ? 1 : 0) }));
  const order = standings.length ? standings.map(r => r.id) : fxPickable().map(t => t.id);
  const list = order.map(tid => ({ tid, T: teams[tid] || { gp: 0, s: {} } }));
  const stats = cols.map(c => {
    const vals = list.map(x => c.val(x.T));
    const m = sum(vals) / vals.length;
    const sd = Math.sqrt(sum(vals.map(v => (v - m) ** 2)) / vals.length) || 1e-9;
    return { vals, z: v => (c.neg ? -1 : 1) * (v - m) / sd, rank: v => 1 + vals.filter(x => (c.neg ? x < v : x > v)).length };
  });
  const avgRank = i => sum(stats.map(st => st.rank(st.vals[i]))) / cols.length;
  // sort by any column: best first (clicking again flips it); standings order until a column is picked, or when the one
  // picked isn't in this league's table (picked in a league with more columns: a 9-category one, then a points one)
  const so = ui.totSort;
  if (so.key != null && !['team', 'gp', 'rank'].includes(so.key) && !cols[so.key]) so.key = null;
  const sortVal = i => (so.key === 'team' ? (fxTeamName(list[i].tid) || '').toLowerCase() : so.key === 'gp' ? list[i].T.gp
    : so.key === 'rank' ? -avgRank(i) : (cols[so.key].neg ? -1 : 1) * stats[so.key].vals[i]);
  const idx = so.key != null ? sortRows(list.map((x, i) => i), sortVal, -so.dir) : list.map((x, i) => i);
  const th = (key, label, cls = 'num', tip = '') => sortTh('tot-sort', key, label, so, { cls, tip, down: so.dir > 0 });
  return `<div class="card" style="margin-top:16px">
    ${head}
    <div class="table-wrap"><table class="season-tot">
      <thead><tr>${th('team', 'Team', '')}${th('gp', 'Player games', 'num', 'Games played by the players in each starting lineup, added up')}${cols.map((c, j) => th(j, c.label)).join('')}${sc ? '' : th('rank', 'Avg rank', 'num', 'Average rank across the categories')}</tr></thead>
      <tbody>${idx.map(i => { const x = list[i]; return `<tr${x.tid === myTeamId() ? ' class="me-row"' : ''}><td><b>${teamLink(x.tid, esc(fxTeamName(x.tid) || ''))}</b></td><td class="num muted">${x.T.gp}</td>
        ${cols.map((c, j) => { const v = stats[j].vals[i]; return `<td class="num" style="${shade(stats[j].z(v))}" title="${c.label}: ${ordinal(stats[j].rank(v))} of ${list.length}">${c.fmt(v)}</td>`; }).join('')}
        ${sc ? '' : `<td class="num"><b>${fmt(avgRank(i), 1)}</b></td>`}</tr>`; }).join('')}</tbody>
    </table></div>
  </div>`;
}
