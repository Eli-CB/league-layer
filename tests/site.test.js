const { test, assert, sharedApp, loadApp, CATS9, POINTS, DAILY, ESPN, ESPN_ROTO, YAHOO, between, SLEEPER, HOCKEY, quiet, FOOTBALL, ESPN_FOOTBALL } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test('popups scroll inside, without collapsing on older iPhone Safari', () => {
  // flex-basis 0 on a popup's body made Safari before 16 size the popup from 0: a sliver between the header and footer
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.modal-body[^{}]*)\{([^}]*)\}/g)].filter(m => /flex\s*:/.test(m[2]));
  assert.ok(rules.length >= 2, 'the player card and (i) popups both flex their body');
  for (const [, sel, body] of rules) assert.match(body, /flex:\s*1 1 auto/, `${sel.trim()}: flex-basis auto, not 0`);
});

test("a popup's scrolling stays in the popup, and the page behind stays put", () => {
  // scrolling to the end of a player's card went on to scroll the tab behind it
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // (comments hold commas)
  const rule = sel => [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(m => m[1].split(',').some(x => x.trim() === sel)).map(m => m[2]).join(';');
  for (const sel of ['.modal', '.modal-body']) assert.match(rule(sel), /overscroll-behavior:\s*contain/, sel);
  assert.match(rule('html:has(dialog[open])'), /overflow:\s*hidden/, 'the page is frozen while a popup is open');
  // a table inside the card (its games) still hands on to the card when it ends
  assert.doesNotMatch(rule('.pc-games-wrap'), /overscroll-behavior/);
});

test("the error log: a search engine's crawler isn't a visitor", () => {
  const re = app.get('CRAWLER');
  assert.ok(re.test('Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.97 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'));
  assert.ok(re.test('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'));
  assert.ok(!re.test('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'));
  assert.ok(!re.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'));
});

test('Send feedback: an email to feedback@leaguelayer.com with the league, page and version filled in', async () => {
  const L = await app.useLeague(CATS9);
  const href = app.feedbackHref();
  assert.ok(href.startsWith('mailto:feedback@leaguelayer.com?subject=League%20Layer%20feedback&body='));
  const body = decodeURIComponent(href.split('&body=')[1]);
  assert.ok(body.includes(`League: ${L.name} (Fantrax ${L.id})`) && body.includes('Page: ') && body.includes('Version: '), body);
  assert.ok(body.split('\n').length > 6, 'on separate lines');
  // the popup: Gmail in the browser (an email link alone does nothing without an email app), the email app, or copy
  const pop = app.feedbackPopup();
  assert.ok(pop.includes('https://mail.google.com/mail/?view=cm') && pop.includes('to=feedback%40leaguelayer.com'));
  assert.ok(pop.includes('href="mailto:feedback@leaguelayer.com') && pop.includes('data-action="feedback-copy"'));
  assert.ok(pop.includes(L.id), 'the details shown');
  // the League ID field: the connected league's to start; one typed in (a league that won't connect) goes along instead
  assert.ok(pop.includes(`data-input="fb-league" value="${L.id}"`), pop);
  app.set('ui.fbLeague', ' 1715452380 ');
  assert.ok(app.feedbackDetails().startsWith('League: ID 1715452380\n'), app.feedbackDetails());
  assert.ok(decodeURIComponent(app.feedbackGmail()).includes('League: ID 1715452380'));
  app.set('ui.fbLeague', '');
  assert.ok(app.feedbackDetails().startsWith('League: none given'));
  app.set('ui.fbLeague', null);
  assert.ok(app.feedbackDetails().includes(`(Fantrax ${L.id})`));
});

test('the site installs to a home screen: its manifest, the offer in the menu, iPhone steps, and staying fresh', async () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="manifest.webmanifest"/);
  assert.ok(fs.existsSync(path.join(root, html.match(/apple-touch-icon" href="([^"]+)"/)[1])));

  const a = loadApp();
  await a.ready();
  const ui = a.get('ui');
  assert.equal(a.canInstall(), false, 'no offer, not an iPhone');
  let shown = 0;
  ui.installPrompt = { prompt() { shown++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  assert.equal(a.canInstall(), true);
  await a.actions['install-app']();
  assert.equal(shown, 1);
  assert.equal(ui.installPrompt, null);
  a.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  assert.equal(a.canInstall(), true, 'an iPhone: steps');
  await a.actions['install-app']();
  // installed: nothing to offer, and a stale app loads again
  a.navigator.standalone = true;
  assert.equal(a.isInstalled(), true);
  assert.equal(a.canInstall(), false);
  assert.equal(a.appStale(), false, 'just opened');
  a.setClock('2026-10-27T00:00:01-04:00'); // four hours on
  assert.equal(a.appStale(), true);
  a.navigator.standalone = false;
  assert.equal(a.appStale(), false, 'a browser tab has a refresh button');
  a.setClock();
});

// ----- Names a league's members choose are text, never HTML -----
// A shared link opens any league on leaguelayer.com, so a league's own name and its teams' names (anything a member can
// type) must never be read as HTML: here each is written to break out of any HTML it lands in, every tab and every
// popup a tab's buttons open is drawn, and the names must come out escaped. A tooltip (data-tip) is HTML kept in an
// attribute and put in the page again as HTML, so a name in one has to be escaped twice.
const XSS = `"'<i id=xss>`, XSS_ESCAPED = '&quot;&#39;&lt;i id=xss';

const POPUPS = ['team-card', 'player-detail', 'sport-team', 'award-team', 'draft-award', 'draft-team', 'trend-cat', 'waiver-order', 'feedback', 'recap-step', 'week-shift'];

const unattr = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Each place a name broke out of its HTML: anywhere it isn't escaped exactly as esc() does, or a quote or < left as it was
function unescapedNames(html, where) {
  const bad = [], tips = [];
  // (a tooltip's HTML, as the page will put it in: its attribute read once)
  const rest = html.replace(/data-tip="([^"]*)"/g, (m, t) => { tips.push(unattr(t)); return 'data-tip=""'; });
  const check = (text, ctx) => {
    for (const m of text.matchAll(/i id=xss|"'(<|&lt;)|'</g)) {
      if (m[0] === 'i id=xss' && text.slice(m.index - XSS_ESCAPED.length + 8, m.index + 8) === XSS_ESCAPED) continue;
      bad.push(`${where}${ctx}: …${text.slice(Math.max(0, m.index - 60), m.index + 20)}…`);
    }
  };
  check(rest, '');
  for (const t of tips) check(t, ' (tooltip)');
  return bad;
}

async function xssPass(a, id, label) {
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 5)); };
  // the page's elements, each kept so what's drawn into it can be read back
  const els = new Map(), El = a.document.createElement().constructor;
  a.document.querySelector = sel => { if (!els.has(sel)) els.set(sel, new El()); return els.get(sel); };
  a.document.getElementById = idOf => a.document.querySelector('#' + idOf);
  const shown = [], read = what => { for (const s of ['#view', '#leagueMenu', '#teamMenu', '#gearMenu', '#ctxMeta', '#tabs', '#detailBody', '#detailTitle', '#infoBody']) { const h = els.get(s) && els.get(s).innerHTML; if (h) shown.push([`${label} ${what} ${s}`, h]); } };
  const L0 = await a.connectLeague(id).then(() => a.fxLeague());
  // every name the league's members chose, made into one that breaks out of HTML (the same name, the same way)
  const made = new Map(), named = s => { if (!made.has(s)) made.set(s, `N${made.size}${XSS}`); return made.get(s); };
  const poison = (o, names, seen = new Set()) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (o instanceof Map) { for (const [k, v] of o) typeof v === 'string' && names.has(v) ? o.set(k, named(v)) : poison(v, names, seen); return; }
    for (const k of Object.keys(o)) typeof o[k] === 'string' && names.has(o[k]) ? (o[k] = named(o[k])) : poison(o[k], names, seen);
  };
  const namesOf = L => new Set([L.name, ...L.teams.map(t => t.name)].filter(Boolean));
  const names = namesOf(L0);
  poison(L0, names); poison(a.get('state'), names);
  a.render(); await settle(); a.render(); read('landing');
  a.adoptTeam(a.fxLeague().teams[0].id);
  quiet(a);
  const ui = a.get('ui'), actions = a.get('actions'), done = new Set();
  // a trade between two other teams, as a league mate's link shows it, so the Trades tab draws a proposal with their names
  const [, tA, tB] = a.fxPickable().map(t => t.id), onTeam = t => (t ? a.fxTeamSide(t).players.filter(p => p.nbaId).slice(0, 1).map(p => String(p.nbaId)) : []);
  if (onTeam(tA).length && onTeam(tB).length) ui.tradeSeen = { from: tA, to: tB, give: onTeam(tA), get: onTeam(tB) };
  const popups = async (html, what) => {
    let players = 0, teams = 0;
    for (const m of html.matchAll(/<[a-z]+\b[^>]*\bdata-action="([^"]+)"[^>]*>/g)) {
      if (!POPUPS.includes(m[1])) continue;
      const dataset = {};
      for (const d of m[0].matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) if (d[1] !== 'action' && d[1] !== 'tip') dataset[d[1].replace(/-([a-z])/g, (x, c) => c.toUpperCase())] = unattr(d[2]);
      // (a popup is the same from any tab: each once; a step to another week, once a tab)
      const key = `${/step|shift/.test(m[1]) ? ui.tab : ''}|${m[1]}|${JSON.stringify(dataset)}`;
      if (done.has(key) || (m[1] === 'player-detail' && ++players > 8) || (m[1] === 'sport-team' && ++teams > 3)) continue;
      done.add(key);
      for (const s of ['#detailBody', '#detailTitle', '#infoBody']) a.document.querySelector(s).innerHTML = '';
      await actions[m[1]]({ dataset, closest: () => null, disabled: false });
      await (/step|shift/.test(m[1]) ? settle() : new Promise(r => setImmediate(r)));
      read(`${what} ${m[1]} ${JSON.stringify(dataset)}`);
    }
  };
  const tabs = async what => {
    for (const [tab] of a.tabList()) {
      ui.tab = tab;
      a.render(); await settle(); a.render();
      read(`${what} ${tab}`);
      await popups(['#view', '#gearMenu', '#ctxMeta'].map(s => a.document.querySelector(s).innerHTML).join(''), `${what} ${tab}`);
      quiet(a);
    }
  };
  await tabs('this season');
  // past seasons: their own names, poisoned the same way (a team keeps its name across seasons, so stays the same team)
  for (const P of (a.fxLeague().pastSeasons || []).map(p => p.id || p)) {
    try { await a.switchSeason(P, 'standings'); } catch (e) { continue; }
    const past = a.get('pastCache')[P];
    if (!past || !past.league) continue;
    const pn = namesOf(past.league);
    poison(past, pn);
    a.route();
    await tabs(`past season ${P}`);
    await a.switchSeason(null, 'standings');
  }
  quiet(a);
  return shown;
}

test("a league's own name and its teams' names are shown as text on every tab and popup, never as HTML; positions always in their colors", async () => {
  const runs = [['Fantrax categories', CATS9], ['Fantrax points', POINTS], ['Fantrax daily, not drafted', DAILY], ['ESPN', ESPN], ['ESPN roto', ESPN_ROTO], ['Sleeper', SLEEPER], ['Yahoo', YAHOO], ['hockey', HOCKEY], ['football', FOOTBALL], ['ESPN football', ESPN_FOOTBALL]];
  const problems = [], plain = new Set();
  let drawn = 0;
  for (const [label, id] of runs) {
    const a = loadApp();
    await a.ready();
    if (id === YAHOO) { a.get('yahoo').proxy = 'https://yahoo.test'; a.localStorage.setItem('league-layer-yahoo', JSON.stringify({ access: 'a', refresh: 'r', until: a.NOW + 36e5 })); }
    const shown = await xssPass(a, id, label);
    assert.ok(shown.some(([, h]) => h.includes(XSS_ESCAPED)), `${label}: the names reached the page`);
    assert.ok(shown.some(([w, h]) => w.includes(' feedback ') && h.includes(XSS_ESCAPED)), `${label}: and the feedback popup, with the league's name`);
    if (id === CATS9) assert.ok(shown.some(([w, h]) => w.endsWith(' trade #view') && h.includes('A trade a league mate shared')), 'and a trade proposal');
    for (const [where, h] of shown) problems.push(...unescapedNames(h, where));
    // a position the sport has a color for is never drawn plain, wherever it shows (posTags, core.js)
    const colors = a.get('SPORT').slotColors || {};
    for (const [where, h] of shown) {
      for (const m of h.matchAll(/<span class="pt pt-([^" ]+)([^"]*)"/g)) {
        if (!colors[m[1]]) continue;
        drawn++;
        if (!m[2].includes(` pc pc-${colors[m[1]]}`)) plain.add(`${where}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)].slice(0, 40), []);
  assert.ok(drawn > 1000, `${drawn} positions drawn`);
  assert.deepEqual([...plain].slice(0, 20), [], 'positions drawn without their colors');
});

test('shared helpers: the toggles, a table sorted with empty cells last, whose a player is (the sandbox too), a card sorted by makes then attempts', async () => {
  const a = loadApp();
  await a.ready();
  await a.loadBoxes();
  const ui = a.get('ui');
  ui.tab = 'standings'; // (no live box scores in the background)
  // a toggle: one button on, a tip where given, more attributes on every button
  const seg = a.segBtns('Show', 'x-pick', 'v', [['a', 'A'], ['b', 'B', 'Tip']], 'b', ' disabled');
  assert.ok(seg.startsWith('<div class="seg seg-sm" role="group" aria-label="Show">'));
  assert.ok(seg.includes('class="" data-action="x-pick" data-v="a" aria-pressed="false" disabled>A<'));
  assert.ok(seg.includes('class="on" data-action="x-pick" data-v="b" aria-pressed="true" title="Tip" disabled>B<'));
  // a table's rows: either way, an empty cell last and ties in the order given
  const rows = [{ n: 'p', v: 2 }, { n: 'q', v: null }, { n: 'r', v: 5 }, { n: 's', v: 2 }];
  assert.deepEqual([...a.sortRows(rows, r => r.v, 1)].map(r => r.n), ['p', 's', 'r', 'q']);
  assert.deepEqual([...a.sortRows(rows, r => r.v, -1)].map(r => r.n), ['r', 'p', 's', 'q']);
  assert.deepEqual(rows.map(r => r.n), ['p', 'q', 'r', 's'], 'the list itself untouched');
  const doc = a.document, realQuery = doc.querySelector, els = {};
  doc.querySelector = sel => (['#detailBody', '#detailTitle', '#detailDialog'].includes(sel) ? (els[sel] = els[sel] || { innerHTML: '', textContent: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } }) : realQuery(sel));
  try {
    // the sandbox: an NBA team's card marks My team's players, as the Players tab and Trends do (one lookup: rosterOwners)
    a.actions['land-browse']();
    const p = a.sortDesc(a.nbaPlayers().filter(x => x.gp && x.team), x => x.val)[0];
    a.actions['sb-add']({ dataset: { id: String(p.nbaId) } });
    a.actions['sport-team']({ dataset: { team: p.team } });
    assert.ok(els['#detailBody'].innerHTML.includes('<span class="perf-owner mine"><span class="team-mine">My team</span></span>'), 'My team on his NBA team card');
    // a player's games sorted by FG%: by makes, then attempts ("8/15")
    const raw = a.NBA.players.find(r => { const g = a.cardGames(r); return g.some((x, i) => g.some((y, j) => i !== j && x.fgm === y.fgm && x.fga !== y.fga)); });
    assert.ok(raw, 'a player with two games of the same makes');
    a.showPlayerDetail(raw.id);
    ui.cardSort = { key: String(a.cardStats(raw).findIndex(c => c[0] === 'FG%')), dir: -1 };
    a.showPlayerDetail(raw.id);
    const log = els['#detailBody'].innerHTML.split('class="pc-log"')[1];
    const fg = [...log.matchAll(/<td class="num">(\d+)\/(\d+)<\/td><td class="num">\d+\/\d+<\/td>/g)].map(m => [+m[1], +m[2]]);
    assert.equal(fg.length, a.cardGames(raw).length, 'every game');
    assert.ok(fg.every((x, i) => !i || fg[i - 1][0] > x[0] || (fg[i - 1][0] === x[0] && fg[i - 1][1] >= x[1])), 'most makes first, then most attempts');
  } finally { doc.querySelector = realQuery; }
});

test('the js files share one scope: no two declare the same function (a later file\'s would silently replace the earlier)', () => {
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'js'), seen = new Map(), twice = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^(?:async )?function\s+(\w+)/gm)) {
      if (seen.has(m[1])) twice.push(`${m[1]}: ${seen.get(m[1])} and ${f}`); else seen.set(m[1], f);
    }
  }
  assert.deepEqual(twice, []);
});

test("the page's Content-Security-Policy: first in the page, no inline script, and every outside address the code uses is listed", () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(meta, 'index.html has its policy');
  assert.ok(html.indexOf(meta[0]) < html.search(/<link|<script/), 'before anything it governs loads');
  const policy = Object.fromEntries(meta[1].split(';').map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.ok(!policy['script-src'].some(v => /unsafe|data:|blob:|\*/.test(v)), "scripts: the site's own files and named servers only");
  assert.deepEqual([...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map(m => m[0]), [], 'no inline script in index.html');
  const handlers = /\son[a-z]+\s*=\s*["'{`$]/;
  assert.ok(!handlers.test(html), 'no onclick= and the like in index.html');
  // every outside address in the code, in the directive its use needs (links people open aren't loads)
  const LINKS = new Set(['https://ko-fi.com', 'https://mail.google.com']);
  const allowed = new Set([...policy['img-src'], ...policy['connect-src'], ...policy['script-src']]);
  const missing = [];
  for (const f of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    assert.ok(!handlers.test(src) && !/javascript:|\beval\(|new Function\(/.test(src), `${f}: no inline handlers or eval (the policy blocks them)`);
    for (const [origin] of src.matchAll(/https:\/\/[a-z0-9.-]+/g)) if (!LINKS.has(origin) && !allowed.has(origin)) missing.push(`${origin} (${f})`);
  }
  assert.deepEqual([...new Set(missing)], [], "outside addresses the page's policy would block: add them to index.html's Content-Security-Policy");
});

test('positions are drawn by one helper, always in their colors (the page and the share pictures)', () => {
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'js');
  assert.equal(app.posTags(['PG', 'C']), '<span class="pt pt-PG pc pc-orange-2">PG</span>,<span class="pt pt-C pc pc-emerald-1">C</span>');
  assert.equal(app.slotColor('SF'), 'blue-2');
  assert.equal(app.slotColor('XX'), '', 'a position without one stays plain');
  // no other file makes its own: a position's markup or its color comes from posTags / slotColor / slotInk
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    let src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f === 'core.js') src = src.replace(/^const (slotColor|posTags) = .*$/gm, '');
    assert.ok(!/class="pt\b|\bpos\.join\(|slotColors\[/.test(src), `${f} draws positions or their colors itself: use posTags (or slotColor / slotInk)`);
  }
});

test('the notes: CLAUDE.md stays small, and its map names every notes file and every js file', () => {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const md = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace(/\r/g, ''); // (a Windows checkout's line ends count once, as on GitHub)
  assert.ok(md.length <= 20000, `CLAUDE.md is ${md.length} characters, over 20,000 (the owner's limit): move area detail into its docs/ file (CLAUDE.md, "These notes")`);
  const docs = fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md'));
  for (const f of docs) assert.ok(md.includes(`docs/${f}`), `docs/${f} isn't in CLAUDE.md's map ("Where the notes are")`);
  for (const [, f] of md.matchAll(/docs\/([\w-]+\.md)/g)) assert.ok(docs.includes(f), `CLAUDE.md names docs/${f}, which doesn't exist`);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, f] of html.matchAll(/src="js\/([\w-]+\.js)/g)) assert.ok(md.includes(f), `js/${f} has no row in CLAUDE.md's map ("Where the notes are")`);
});
