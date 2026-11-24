// League Layer: the Trades tab: a proposal between two teams, draft picks in it, and sharing it as a picture or a link.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

function viewTrade() {
  if (ui.tradeLink && state.fxTeam && NBA) applyTradeLink(); // (a shared trade, once your team is known)
  if (ui.tradeSeen && !fxPickable().some(t => t.id === ui.tradeSeen.from)) ui.tradeSeen = null; // (another league's)
  // the other side of the deal is another team's Fantrax roster
  const others = fxPickable().filter(t => t.id !== state.fxTeam);
  if (!others.some(t => t.id === ui.tradeTeam)) { ui.tradeTeam = others.length ? others[0].id : null; ui.tradeGet.clear(); }
  const theirs = ui.tradeTeam ? fxTeamSide(ui.tradeTeam).players : [];
  // prune selections that no longer exist (their players are picked by NBA id: they're rebuilt every render)
  for (const id of ui.tradeGive) if (!state.players.some(p => p.id === id)) ui.tradeGive.delete(id);
  for (const id of ui.tradeGet) if (!theirs.some(p => String(p.nbaId) === id)) ui.tradeGet.delete(id);
  // the league's future draft picks (read the first time they're needed: leaguePicks); a pick no longer theirs drops out
  const PK = leaguePicks(), owned = tid => (PK.list || []).filter(p => p.owner === tid).sort((a, b) => a.year - b.year || a.round - b.round);
  if (PK.list) {
    for (const k of ui.tradeGivePicks) if (!owned(state.fxTeam).some(p => pickKey(p) === k)) ui.tradeGivePicks.delete(k);
    for (const k of ui.tradeGetPicks) if (!owned(ui.tradeTeam).some(p => pickKey(p) === k)) ui.tradeGetPicks.delete(k);
  }

  const pick = (list, set, side, key) => list.length ? `<ul class="pick-list">${sortDesc(list, value).map(p => `
    <li><label><input type="checkbox" data-change="trade" data-side="${side}" value="${key(p)}" ${set.has(key(p)) ? 'checked' : ''}>
      <span class="grow">${playerCell(p)}</span>${p.status !== 'Healthy' ? statusBadge(p) : ''}<span class="val">${fmtValue(value(p))}</span></label></li>`).join('')}</ul>`
    : `<p class="muted small">${side === 'get' ? (others.length ? 'This team has no players yet.' : 'Connect a league to trade with its teams.') : 'Your roster is empty.'}</p>`;
  // under a team's players, its draft picks to tick ("2027 R1"; one it traded for says whose it was)
  const picksOf = (tid, set, side) => {
    if (!tid) return '';
    if (PK.loading) return '<p class="muted small pp-note">Loading draft picks…</p>';
    if (PK.error) return `<p class="muted small pp-note">Couldn't read the draft picks (${esc(PK.error)}). <button type="button" class="link-btn" data-action="trade-picks-retry">Try again</button></p>`;
    const list = owned(tid);
    return list.length ? `<div class="pp"><div class="pp-head">Draft picks</div><div class="pp-list">${list.map(p => { const k = pickKey(p), on = set.has(k); return `<label class="pp-chip${on ? ' on' : ''}">
      <input type="checkbox" data-change="trade-pick" data-side="${side}" value="${esc(k)}"${on ? ' checked' : ''}><span>${p.year} R${p.round}</span>${p.from !== tid ? `<span class="pp-from">${esc(fxTeamName(p.from))}</span>` : ''}</label>`; }).join('')}</div></div>` : '';
  };

  const give = [...ui.tradeGive].map(byId).filter(Boolean);
  const get = theirs.filter(p => ui.tradeGet.has(String(p.nbaId)));
  const givePicks = [...ui.tradeGivePicks], getPicks = [...ui.tradeGetPicks];
  // the deal in one card: both sides, how they compare, and what it does for your team. Under the lists; a league mate's
  // shared deal above them instead
  const card = ui.tradeSeen ? tradeCard(ui.tradeSeen)
    : give.length || get.length || givePicks.length || getPicks.length
      ? tradeCard({ from: state.fxTeam, to: ui.tradeTeam, give: give.filter(p => p.nbaId != null).map(p => String(p.nbaId)), get: [...ui.tradeGet], givePicks, getPicks }, tradeForYou(give, get))
      : `<div class="card"><div class="empty"><strong>Pick players on both sides</strong>See how the deal changes your team's ${isRoto() ? 'projected roto finish' : 'per-game production'}, and share it with the other team.</div></div>`;
  return `${ui.tradeSeen ? card : ''}
  <div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length + givePicks.length} selected</span></div>${pick(state.players, ui.tradeGive, 'give', p => p.id)}${picksOf(state.fxTeam, ui.tradeGivePicks, 'give')}</div>
    <div class="card"><div class="card-head"><h2>You get</h2>${others.length ? `<select class="trade-team" data-change="trade-team" aria-label="Team to trade with">${others.map(t => `<option value="${esc(t.id)}" ${t.id === ui.tradeTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}<span class="muted small">${get.length + getPicks.length} selected</span></div>${pick(theirs, ui.tradeGet, 'get', p => String(p.nbaId))}${picksOf(ui.tradeTeam, ui.tradeGetPicks, 'get')}</div>
  </div>
  ${ui.tradeSeen ? '' : card}`;
}

// A draft pick in a deal and its link: "year:round:team whose pick it was"; and in words
const pickKey = p => `${p.year}:${p.round}:${p.from}`;
const pickOf = k => { const [year, round, ...from] = String(k).split(':'); return { year: +year, round: +round, from: from.join(':') }; };
const pickName = p => `${p.year} Round ${p.round}`;

// What a deal does for your team: value over a waiver player each way (each player in a deal takes a roster spot someone
// off waivers could fill; a goalie for his share of his team's games, as the waiver player's), and each category's
// per-game total across your active (non-IR) roster now and after. Numbers only: the site never says who wins a trade or
// whether it's fair, that's for the people trading to judge (the owner's rule)
function tradeForYou(give, get) {
  const active = state.players.filter(p => !state.il.includes(p.id)), out = new Set(give.map(p => p.id));
  const before = totals(active), after = totals([...active.filter(p => !out.has(p.id)), ...get]);
  const wv = waiverValue(), over = p => gameWorth(p) - wv;
  const vGive = sum(give.map(over)), vGet = sum(get.map(over)), diff = vGet - vGive, cats = scoreCats();
  const better = c => { const d = after[c.key] - before[c.key]; return c.neg ? d < -1e-9 : d > 1e-9; };
  return { before, after, vGive, vGet, diff, won: cats.filter(better).length, n: cats.length, rosterAfter: activeCount() - give.length + get.length,
    roto: isRoto() && ui.tradeTeam ? rotoTradeChange(give, get, ui.tradeTeam) : null }; // (roto: your projected finish, now and with the deal)
}

/* ---------- Trade proposal: both sides of a deal, with photos and per-game numbers, to share with the other team ---------- */
// A deal: { from, to, give, get, givePicks, getPicks }: team `from` sends `give` and `givePicks`, and receives `get` and
// `getPicks` (players by data id, as text; draft picks by pickKey). The pickers make one (you are `from`, with something
// picked on both sides); a shared link carries one (tradeUrl, openSharedLink).
function tradeDeal() {
  if (ui.tradeSeen) return ui.tradeSeen;
  const give = [...ui.tradeGive].map(byId).filter(p => p && p.nbaId != null).map(p => String(p.nbaId)), get = [...ui.tradeGet];
  const givePicks = [...ui.tradeGivePicks], getPicks = [...ui.tradeGetPicks];
  return state.fxTeam && ui.tradeTeam && (give.length || givePicks.length) && (get.length || getPicks.length) ? { from: state.fxTeam, to: ui.tradeTeam, give, get, givePicks, getPicks } : null;
}

// A shared trade, once your team is known: either of its teams gets it in the pickers, from their side (what they'd send
// on the left); anyone else sees it as it was sent, above the pickers (ui.tradeSeen, until they pick or close it)
function applyTradeLink() {
  const T = ui.tradeLink, me = state.fxTeam, teams = fxPickable().map(t => t.id);
  ui.tradeLink = null;
  if (!teams.includes(T.from) || !teams.includes(T.to) || T.from === T.to) return;
  ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeGivePicks.clear(); ui.tradeGetPicks.clear(); ui.tradeSeen = null;
  if (me !== T.from && me !== T.to) { ui.tradeSeen = T; return; }
  const [mine, theirs] = me === T.from ? [T.give, T.get] : [T.get, T.give];
  ui.tradeTeam = me === T.from ? T.to : T.from;
  // its draft picks (one no longer theirs drops out once the league's picks are in: viewTrade)
  for (const k of (me === T.from ? T.givePicks : T.getPicks) || []) ui.tradeGivePicks.add(k);
  for (const k of (me === T.from ? T.getPicks : T.givePicks) || []) ui.tradeGetPicks.add(k);
  for (const p of state.players) if (mine.includes(String(p.nbaId))) ui.tradeGive.add(p.id);
  const onTheirs = new Set(fxTeamSide(ui.tradeTeam).players.map(p => String(p.nbaId)));
  for (const id of theirs) if (onTheirs.has(id)) ui.tradeGet.add(id);
  // a player who has changed teams since the link was made drops out of the deal: say so
  const gone = mine.length + theirs.length - ui.tradeGive.size - ui.tradeGet.size;
  if (gone) toast(`${gone === 1 ? 'A player' : `${gone} players`} in the shared trade ${gone === 1 ? 'is' : 'are'} on another team now`);
}

// The league's categories, fantasy points first in a points league (a shooting pair it scores both halves of as one, "8.2/17.1 FG": lineCats)
const dealCats = () => { const cs = lineCats(); return [...cs.filter(c => c.fp), ...cs.filter(c => !c.fp)]; };
// a category's number as the site shows it; null (no attempts: a side without a goalie has no GAA) is a dash
const dealShow = (c, v) => (v == null ? '—' : c.rate ? fmt(v, 2) : c.pct ? fmtPct(v) : fmt(v, c.dec || 1));
// a shooting category's volume: makes and attempts a game ("7.2/14.5")
const dealVol = (made, att) => `${fmt(made, 1)}/${fmt(att, 1)}`;
// One player's average game in the league's categories (a goalie's in the goalie ones), minutes first; a percentage with
// its makes and attempts, as the Recap's lines show them ("7.2/14.5 FG (.496)")
function dealLine(p) {
  const goalie = isGoalie(p), parts = p.min ? [`${fmt(p.min, 1)} MIN`] : [];
  for (const c of dealCats()) {
    if (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie) continue;
    if (c.shot) { parts.push(`${dealVol(statVal(p, c.made), statVal(p, c.att))} ${c.label}`); continue; }
    const m = c.pct && statVal(p, c.made), a = c.pct && statVal(p, c.att);
    if (c.pct && !c.rate) parts.push(`${dealVol(m, a)} ${c.label.replace('%', '')} (${a ? fmtPct(m / a) : '—'})`);
    else parts.push(`${dealShow(c, c.pct ? (a ? pctOf(p, c) : null) : statOf(p, c))} ${c.label}`);
  }
  return parts;
}

// Both sides of a deal, for the card, the picture and the text: what each team gets (players as the Players tab has
// them, best first), their value added up (sum) and over a waiver player (value, as the value line above the table counts it), and their
// per-game totals, then the
// comparison's rows: { key, label, sa, sb (as shown), lead: 1 (the first side's is better), -1, or 0 (even, or no number),
// and for a shooting percentage va, vb (makes/attempts a game) and ta, tb (what the volume adds, for a tip) }
function tradeModel(T) {
  const rawOf = id => nbaById.get(+id) || nbaById.get(id);
  const wv = waiverValue(), over = p => gameWorth(p) - wv;
  // (and its draft picks, first year and round first; sender: the team sending them, so a pick that was someone else's says so)
  const side = (tid, ids, keys, sender) => {
    const players = sortDesc(ids.map(rawOf).filter(Boolean).map(raw => playerFromRaw(raw)), value);
    const picks = (keys || []).map(pickOf).sort((a, b) => a.year - b.year || a.round - b.round);
    return { tid, sender, name: fxTeamName(tid) || 'Team', players, picks, sum: sum(players.map(value)), value: sum(players.map(over)), tot: totals(players) };
  };
  const A = side(T.from, T.get, T.getPicks, T.to), B = side(T.to, T.give, T.givePicks, T.from);
  const row = (key, label, a, b, show, neg) => {
    const sa = show(a), sb = show(b);
    return { key, label, a, b, sa, sb, lead: a == null || b == null || sa === sb ? 0 : (neg ? a < b : a > b) ? 1 : -1 };
  };
  const catOf = (t, c) => (c.fp ? t.fp : c.pct ? (t[c.att] ? t[c.made] / t[c.att] : null) : lineStat(t, c.key));
  // a shooting percentage counts its volume, as Value does: the better side adds more makes over what the league's
  // average percentage would give on its attempts (a .513 on 4 shots a game isn't better than a .498 on 15)
  const shotRow = c => {
    const r = row(c.key, c.label, catOf(A.tot, c), catOf(B.tot, c), v => dealShow(c, v), c.neg), avg = BASE[c.key] && BASE[c.key][0];
    const what = c.made === 'sv' ? 'saves' : c.made === 'fow' ? 'faceoffs won' : 'makes';
    const over = t => (t[c.att] && avg ? (c.neg ? -1 : 1) * (t[c.made] - avg * t[c.att]) : null);
    const tip = t => (over(t) == null ? '' : `${dealVol(t[c.made], t[c.att])} a game: ${fmt(Math.abs(over(t)), 1)} ${over(t) >= 0 ? 'more' : 'fewer'} ${what} than the league's average of ${fmtPct(avg)} would give`);
    const [oa, ob] = [over(A.tot), over(B.tot)];
    return { ...r, pct: true, va: A.tot[c.att] ? dealVol(A.tot[c.made], A.tot[c.att]) : '', vb: B.tot[c.att] ? dealVol(B.tot[c.made], B.tot[c.att]) : '', ta: tip(A.tot), tb: tip(B.tot),
      lead: oa == null || ob == null ? r.lead : Math.abs(oa - ob) < 0.05 ? 0 : oa > ob ? 1 : -1 };
  };
  // a points league's shooting pair (lineCats): makes/attempts a game, the points they score under them, and the side
  // they score more for marked (a, b: those points)
  const pairRow = c => {
    const a = shotFp(A.tot, c), b = shotFp(B.tot, c), vol = t => dealVol(lineStat(t, c.made), lineStat(t, c.att));
    return { key: c.key, label: c.label, a, b, sa: vol(A.tot), sb: vol(B.tot), va: `${signed(a, 1)} FP`, vb: `${signed(b, 1)} FP`, pct: true, shot: true,
      lead: Math.abs(a - b) < 0.05 ? 0 : a > b ? 1 : -1 };
  };
  // a league with playoffs to come: each side's games in them (more is better: they decide the title)
  const P = playoffDays();
  if (P) for (const S of [A, B]) S.po = sum(S.players.map(p => playoffGames(p, P)));
  const rows = [row('value', valueLabel(), A.value, B.value, v => fmtValue(v)), ...(P ? [row('po', 'Playoff games', A.po, B.po, fmtGames)] : []),
    ...dealCats().map(c => (c.shot ? pairRow(c) : c.pct && !c.rate ? shotRow(c) : row(c.key, c.label, catOf(A.tot, c), catOf(B.tot, c), v => dealShow(c, v), c.neg)))];
  return { A, B, rows, P };
}
// The playoffs in words, for tips and notes: "weeks 19–23 (Mar 1 – Apr 11)"
const playoffWeeks = P => `week${P.ps.length > 1 ? `s ${P.ps[0].n}–${P.ps[P.ps.length - 1].n}` : ` ${P.ps[0].n}`} (${fmtMonthDay(P.from)} – ${fmtMonthDay(P.to)})`;

// The proposal on the Trades tab, all in one table: for each side, what it gets (each player's photo, his games and games
// missed this season, his average game in the league's categories, his value), then that side's total with the better
// side's numbers marked (a side getting one player: his row is its total, not a copy of it under him); last, with Y (your
// own deal: tradeForYou), what it does for your team. In your own deal your side's better numbers are green and the other
// side's red; a league mate's deal (no Y) stays neutral. A points league's FP is the Value column. What it all means is
// in the title's (i) (INFO.trade): the table carries no notes.
function tradeCard(T, Y) {
  const M = tradeModel(T), seen = !Y, me = myTeamId(), P = M.P;
  const mineAt = M.A.tid === me ? 1 : M.B.tid === me ? -1 : 0;
  // the sides with something in the deal (Share once both have); totals compared only when both have players
  const sides = [[M.A, 1], [M.B, -1]].filter(([S]) => S.players.length || S.picks.length), shareable = sides.length === 2;
  const both = !!(M.A.players.length && M.B.players.length);
  const cats = dealCats().filter(c => !c.fp), rowOf = new Map(M.rows.map(r => [r.key, r])), ncol = 5 + cats.length + (P ? 1 : 0);
  // the playoffs' column (a league with playoffs to come): his games in them, each side's added up, your net
  const poTip = P ? `Games in the league's playoffs, ${playoffWeeks(P)}${P.started ? ', still to play' : ''}${isOneGame() ? ': the playoff weeks he plays in, as one game a week counts' : isHockey() ? ': a goalie\'s expected starts' : ''}` : '';
  const poCell = (v, cls = '') => (P ? `<td class="num tp-po${cls}">${v}</td>` : '');
  const mark = (r, col) => (both && r && r.lead === col ? ` tp-lead${mineAt ? (col === mineAt ? ' pos-good' : ' pos-bad') : ''}` : '');
  const vol = v => (v ? `<div class="tp-vol">${v}</div>` : '');
  const skip = (p, c) => isHockey() && SPORT.goalieCats.includes(c.key) !== isGoalie(p); // (a skater has no saves)
  // a category's cell: a player's average game, or a side's total (marked when it's the better side's)
  const gameCell = (p, c) => {
    if (skip(p, c)) return '<td class="num"></td>';
    if (c.shot) return `<td class="num">${dealVol(statVal(p, c.made), statVal(p, c.att))}${vol(`${signed(fantasyPoints(p, shotPoints(c)), 1)} FP`)}</td>`;
    const m = c.pct && statVal(p, c.made), a = c.pct && statVal(p, c.att);
    if (c.pct && !c.rate) return `<td class="num">${a ? fmtPct(m / a) : '—'}${a ? vol(dealVol(m, a)) : ''}</td>`;
    return `<td class="num">${dealShow(c, c.pct ? (a ? pctOf(p, c) : null) : statOf(p, c))}</td>`;
  };
  const totalCell = (c, col) => { const r = rowOf.get(c.key), [v, vl, tip] = col === 1 ? [r.sa, r.va, r.ta] : [r.sb, r.vb, r.tb]; return `<td class="num${mark(r, col)}"${tip ? ` title="${esc(tip)}"` : ''}>${v}${vol(vl)}</td>`; };
  // a side's value: added up, its value over a waiver player for each roster spot under it (what's compared)
  const valueCell = (S, col, shown) => `<td class="num tp-v${mark(M.rows[0], col)}" title="${esc(`${valueLabel()} ${S.players.length > 1 ? 'added up' : 'per game'}; ${fmtValue(S.value)} over a waiver player for each roster spot, which is what's compared`)}"><b>${shown}</b>${vol(`${fmtValue(S.value)} over waiver`)}</td>`;
  const who = p => `<td class="tp-pl"><div class="bplayer">${headshot(p, hsPx(36, 32))}<div class="bmain"><div class="bname">${playerBtn(p.nbaId, p.name)}${p.inj ? ` ${injBadge(p.inj)}` : ''}</div>
      <div class="pmeta">${p.team ? teamBtn(p.team) : 'FA'} · ${posTags(p.pos)}</div></div></div></td>`;
  const games = p => { const n = gamesMissed(p); return `<td class="num">${seasonGp(p)}</td><td class="num${n ? '' : ' muted'}">${n == null ? '' : n}</td>`; };
  // a player; one alone on his side is its total too (S, col): its marks and its value over waiver on his row
  const playerRow = (p, S, col) => (S ? `<tr class="tp-one">${who(p)}${games(p)}${poCell(fmtGames(S.po), mark(rowOf.get('po'), col))}<td class="num">${fmt(p.min || 0, 1)}</td>
      ${cats.map(c => (skip(p, c) ? '<td class="num"></td>' : totalCell(c, col))).join('')}${valueCell(S, col, fmtValue(value(p)))}</tr>`
    : `<tr>${who(p)}${games(p)}${poCell(fmtGames(playoffGames(p, P)))}<td class="num">${fmt(p.min || 0, 1)}</td>${cats.map(c => gameCell(p, c)).join('')}<td class="num tp-v"><b>${fmtValue(value(p))}</b></td></tr>`);
  // a side's total (two players or more): its playoff games and each category added up (a percentage from its makes and attempts), its value
  const totalRow = (S, col) => `<tr class="tp-tot"><td class="tp-pl"></td><td></td><td></td>${poCell(fmtGames(S.po), mark(rowOf.get('po'), col))}<td></td>
    ${cats.map(c => totalCell(c, col)).join('')}${valueCell(S, col, fmtValue(S.sum))}</tr>`;
  // a draft pick: its round in the photo's place, the year and round, and whose it was when that's not the sender's own (no
  // numbers: next season's order isn't known)
  const pickRow = (p, sender) => `<tr class="tp-pick"><td class="tp-pl"><div class="bplayer"><span class="hs hs-none pk-ico" style="width:${hsPx(36, 32)}px;height:${hsPx(36, 32)}px" aria-hidden="true">R${p.round}</span>
      <div class="bmain"><div class="bname"><b>${pickName(p)}</b></div><div class="pmeta">Draft pick${p.from !== sender ? ` · originally ${teamLink(p.from)}` : ''}</div></div></div></td><td colspan="${ncol - 1}"></td></tr>`;
  const sideRows = ([S, col]) => {
    const one = S.players.length === 1;
    return `<tr class="tp-grp"><th colspan="${ncol}" scope="rowgroup"><span class="tp-grp-name">${teamLink(S.tid)} gets</span></th></tr>`
      + `${S.players.map(p => playerRow(p, one ? S : null, col)).join('')}${S.picks.map(p => pickRow(p, S.sender)).join('')}${S.players.length > 1 ? totalRow(S, col) : ''}`;
  };
  // your own deal: what it does to your active roster's per-game totals (now and after on hover), and the net value
  const change = (c, d) => (c.rate ? signed(d, 2) : c.pct ? `${signed(d * 100, 1)}%` : signed(d, 1));
  const zero = shown => !+String(shown).replace(/[^\d.]/g, ''); // (a change that rounds to nothing is gray, not green)
  const poNet = P && M.A.po - M.B.po, poShown = P ? `${poNet > 0.05 ? '+' : poNet < -0.05 ? '−' : ''}${fmtGames(Math.abs(poNet))}` : '';
  const youRow = Y && Y.roto ? rotoTradeRow(Y.roto, cats, P ? poCell(poShown, zero(poShown) ? ' muted' : poNet > 0 ? ' pos-good' : ' pos-bad') : '')
    : Y ? `<tr class="tp-you"><td class="tp-pl"><b>For your team</b></td><td></td><td></td>${poCell(poShown, zero(poShown) ? ' muted' : poNet > 0 ? ' pos-good' : ' pos-bad')}<td></td>
    ${cats.map(c => {
      // a shooting pair: its makes and attempts a game, marked by the points they score
      if (c.shot) {
        const d = shotFp(Y.after, c) - shotFp(Y.before, c), vb = dealVol(Y.before[c.made], Y.before[c.att]), va = dealVol(Y.after[c.made], Y.after[c.att]);
        return `<td class="num ${Math.abs(d) < 0.05 ? 'muted' : d > 0 ? 'pos-good' : 'pos-bad'}" title="${c.label}: ${vb} now, ${va} after; ${signed(d, 1)} FP">${signed(Y.after[c.made] - Y.before[c.made], 1)}/${signed(Y.after[c.att] - Y.before[c.att], 1)}</td>`;
      }
      const b = Y.before[c.key], a = Y.after[c.key], d = a - b, shown = change(c, d); return `<td class="num ${zero(shown) ? 'muted' : (c.neg ? d < 0 : d > 0) ? 'pos-good' : 'pos-bad'}" title="${c.label}: ${dealShow(c, b)} now, ${dealShow(c, a)} after">${shown}</td>`; }).join('')}
    <td class="num tp-v ${zero(fmtValue(Y.diff)) ? 'muted' : Y.diff > 0 ? 'pos-good' : 'pos-bad'}" title="Net ${isPoints() ? 'fp/g' : 'value'} over a waiver player"><b>${fmtValue(Y.diff)}</b></td></tr>` : '';
  return `<div class="card tp">
    <div class="card-head"><div class="tp-head"><h2>Trade proposal ${infoBtn('trade')}</h2></div>
      <div class="tp-btns">${seen ? '<button type="button" class="btn sm" data-action="trade-seen-close">Close</button>' : ''}${shareable ? shareBtn('trade-share') : ''}</div></div>
    ${seen ? `<p class="muted small tp-note">A trade a league mate shared, between ${teamLink(M.A.tid)} and ${teamLink(M.B.tid)}.</p>` : ''}
    ${Y && Y.rosterAfter > rosterLimit() ? `<p class="alert warn small tp-warn">This puts you at ${Y.rosterAfter}/${rosterLimit()}: you'd need to drop ${Y.rosterAfter - rosterLimit()}.</p>` : ''}
    <div class="tp-wrap"><table class="tp-table">
      <thead><tr><th class="tp-pl"></th><th class="num" title="Games played this season">GP</th><th class="num" title="Games his team has played this season without him${isHockey() ? ' (none for a goalie: a healthy backup sits most games)' : ''}">Missed</th>${P ? `<th class="num tp-po" title="${esc(poTip)}">Playoff G</th>` : ''}<th class="num">MIN</th>${cats.map(c => `<th class="num">${c.label}</th>`).join('')}<th class="num tp-v">${valueLabel()}</th></tr></thead>
      <tbody>${sides.map(sideRows).join('')}${youRow}</tbody>
    </table></div>
  </div>`;
}

// Sharing it (shareWith, recap.js): a picture, or the text and a link that opens the deal on the Trades tab
const tradeUrl = (L, T) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&from=${encodeURIComponent(T.from)}&to=${encodeURIComponent(T.to)}`
  + `&give=${T.give.map(encodeURIComponent).join(',')}&get=${T.get.map(encodeURIComponent).join(',')}`
  + `${(T.givePicks || []).length ? `&givepicks=${T.givePicks.map(encodeURIComponent).join(',')}` : ''}${(T.getPicks || []).length ? `&getpicks=${T.getPicks.map(encodeURIComponent).join(',')}` : ''}#trade`;
// a pick in words, with whose it was when that's not the sender's own ("2027 Round 2 pick (originally Tatum Tots)")
const pickWords = (p, sender) => `${pickName(p)} pick${p.from !== sender ? ` (originally ${fxTeamName(p.from)})` : ''}`;
const tradeText = (L, M) => [`${SPORT.emoji} ${L.name} · Trade proposal`,
  ...[M.A, M.B].map(S => `${S.name} gets: ${[...S.players.map(p => `${p.name} (${p.team || 'FA'})`), ...S.picks.map(p => pickWords(p, S.sender))].join(', ')}`)].join('\n\n');
function tradeShare(L, T) {
  const M = tradeModel(T);
  return {
    title: 'Trade proposal', name: `${L.name} · Trade proposal`, what: 'Trade proposal', link: 'Side by side', text: tradeText(L, M), url: tradeUrl(L, T),
    file: `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-trade.png`, alt: `Trade proposal between ${M.A.name} and ${M.B.name}`,
    draw: () => tradeCanvas(L, M),
  };
}

// The picture: each side in a card (what it gets: each player on his team's colors with his positions, games missed and
// average game; its draft picks), a swap mark between them, then (both sides with players) the comparison, each row's
// two numbers on bars growing from the middle, the better one orange, and what its numbers mean
async function tradeCanvas(L, M) {
  const n = M.A.players.length + M.B.players.length, picks = M.A.picks.length + M.B.picks.length, compare = !!(M.A.players.length && M.B.players.length);
  const K = await sharePad(Math.max(4000, 1400 + n * 300 + picks * 160 + M.rows.length * 100)), { C, W, inner, ctx, font, text, round, panel, lay, drawLay, meta } = K;
  await K.prep([...M.A.players, ...M.B.players]);
  let y = K.top({ kicker: 'TRADE PROPOSAL', title: L.name, sub: `${fmtDay(todayIso())} · per game, ${basisLabel().toLowerCase()}` });
  const x0 = C.pad + 32, right = W - C.pad - 32, pw = 210, ph = 154, tx = x0 + pw + 28;
  let swapY = 0;
  for (const S of [M.A, M.B]) {
    // measured first: each player's numbers wrap to the width beside his photo (the number bold, its label gray); a pick
    // is one or two lines
    const rows = [...S.players.map(p => {
      const units = [...(M.P ? [[[fmtGames(playoffGames(p, M.P)), 'b'], [' playoff G', 'm']]] : []),
        ...dealLine(p).map(s => { const i = s.indexOf(' '); return [[s.slice(0, i), 'b'], [s.slice(i), 'm']]; })];
      const lines = lay(units, right - tx, 25, 20);
      return { p, lines, h: Math.max(ph, 96 + lines.length * 36) };
    }), ...S.picks.map(k => ({ k, h: 110 }))];
    const h = 30 + 50 + sum(rows.map(r => r.h)) + (rows.length - 1) * 36 + 32;
    round(C.pad, y, inner, h, 28, C.card);
    let ty = y + 30;
    font(22, 700, 2); text(fitText(ctx, `${S.name} gets`.toUpperCase(), right - x0), x0, ty, C.accent);
    ty += 50;
    rows.forEach((r, i) => {
      if (i) { ctx.fillStyle = C.line; ctx.fillRect(x0, ty + 17, right - x0, 2); ty += 36; }
      if (r.k) {
        // a draft pick: its round where a photo would be, then the year and round, and whose it was
        const k = r.k, orig = k.from !== S.sender;
        round(x0, ty, pw, r.h, 18, C.card2);
        font(17, 700, 2); text('ROUND', x0 + pw / 2, ty + 16, C.muted, 'center');
        font(52, 700); text(String(k.round), x0 + pw / 2, ty + 40, C.accent, 'center');
        font(36, 700, -0.5); text(fitText(ctx, `${pickName(k)} pick`, right - tx), tx, ty + (orig ? 18 : 36));
        if (orig) { font(25); text(fitText(ctx, `originally ${fxTeamName(k.from)}`, right - tx), tx, ty + 66, C.muted); }
        ty += r.h;
        return;
      }
      const p = r.p;
      panel(p, x0, ty, pw, ph, 18);
      // his value a game over a waiver player, in a pill on the right
      font(27, 700); const pv = fmtValue(value(p)), pvW = ctx.measureText(pv).width + 32;
      round(right - pvW, ty, pvW, 44, 22, 'rgba(255,255,255,0.08)'); text(pv, right - pvW / 2, ty + 9, C.text, 'center');
      font(38, 700, -0.5); text(fitText(ctx, p.name, right - tx - pvW - 16), tx, ty + 2);
      // his team, his positions in their colors, his games and games missed this season, and an injury in red
      const missed = gamesMissed(p);
      meta(tx, ty + 54, 24, p.team, p.pos, [[` · ${seasonGp(p)} GP`, C.muted], ...(missed ? [[` · ${missed} missed`, C.soft, 700]] : []),
        ...(p.inj ? [[` · ${p.status.toUpperCase()}`, C.bad, 700]] : [])]);
      drawLay(r.lines, tx, ty + 96, 25, 36);
      ty += r.h;
    });
    y += h;
    if (!swapY) { swapY = y + 22; y += 44; }
  }
  // the swap mark: an up and a down arrow in a circle, over the gap between the sides
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(W / 2, swapY, 34, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.bg; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [x, dir] of [[W / 2 - 9, -1], [W / 2 + 9, 1]]) {
    ctx.beginPath(); ctx.moveTo(x, swapY - 14 * dir); ctx.lineTo(x, swapY + 14 * dir);
    ctx.moveTo(x - 7, swapY + 7 * dir); ctx.lineTo(x, swapY + 14 * dir); ctx.lineTo(x + 7, swapY + 7 * dir); ctx.stroke();
  }

  const notes = [];
  if (compare) {
    // side by side: each side's number at its edge, a bar from the middle as long as its share of the bigger one (a
    // percentage has none: its marking counts makes, not the bare %), the better one orange
    y += 48;
    font(22, 700, 2); text('SIDE BY SIDE · PER GAME', C.pad, y, C.accent); y += 50;
    const cx = W / 2, lw = 104, maxBar = cx - lw - 14 - (x0 + 132), rowH = r => (r.va || r.vb ? 96 : 74);
    const h = 30 + 54 + sum(M.rows.map(rowH)) + 16;
    round(C.pad, y, inner, h, 28, C.card);
    let ty = y + 30;
    font(26, 700);
    text(fitText(ctx, M.A.name, cx - x0 - 24), x0, ty, C.text);
    text(fitText(ctx, M.B.name, right - cx - 24), right, ty, C.text, 'right');
    ty += 54;
    for (const r of M.rows) {
      const rh = rowH(r), bars = !r.pct && r.a != null && r.b != null && r.a >= 0 && r.b >= 0 && Math.max(r.a, r.b) > 0;
      ctx.fillStyle = C.line; ctx.fillRect(x0, ty, right - x0, 2);
      font(19, 700, 1.5); text(fitText(ctx, r.label.toUpperCase(), lw * 2 - 8), cx, ty + (rh - 18) / 2, C.muted, 'center');
      [[r.sa, r.va, r.a, 1], [r.sb, r.vb, r.b, -1]].forEach(([v, vol, num, side], i) => {
        const lead = r.lead === side, edge = i ? right : x0, align = i ? 'right' : 'left';
        font(32, lead ? 700 : 500); text(v, edge, ty + 19, lead ? C.accent : r.lead ? C.muted : C.text, align);
        if (vol) { font(20); text(vol, edge, ty + 60, C.muted, align); }
        if (bars) {
          const len = Math.max(8, maxBar * num / Math.max(r.a, r.b)), from = i ? cx + lw + 14 : cx - lw - 14, by = ty + (rh - 12) / 2;
          round(i ? from : from - maxBar, by, maxBar, 12, 6, 'rgba(255,255,255,0.06)');
          round(i ? from : from - len, by, len, 12, 6, lead ? C.accent : '#4a505c');
        }
      });
      ty += rh;
    }
    y += h;
    // (short: the picture has no (i), and the site's own card says the rest)
    notes.push(`${valueLabel()}: per game, over a waiver player for each roster spot`);
    if (M.P) notes.push(`playoff games: ${playoffWeeks(M.P)}${M.P.started ? ', still to play' : ''}`);
    if (M.rows.some(r => (r.va || r.vb) && !r.shot)) notes.push('FG% and FT% marked by makes over the league average');
    const pairs = M.rows.filter(r => r.shot).map(r => r.label);
    if (pairs.length) notes.push(`${pairs.join(', ')}: makes/attempts, marked by the points they score`);
  }
  if (picks) notes.push("draft picks aren't valued");
  y += 24;
  font(23);
  const said = notes.join(' · ');
  if (said) for (const l of wrapText(ctx, `${said[0].toUpperCase()}${said.slice(1)}.`, inner)) { text(l, C.pad, y, C.muted); y += 34; }
  return K.done(y);
}
