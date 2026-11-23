const { test, assert, sharedApp, ESPN, between, answer } = require('./helpers');

let app;
test.before(async () => { app = await sharedApp(); });

test("the Worker's ESPN route: only the site's feeds, only for its pages, kept for seconds", async () => {
  const worker = (await import('../worker/index.js')).default;
  const store = new Map(), upstream = [];
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async r => (store.has(r.url) ? store.get(r.url).clone() : undefined), put: async (r, res) => { store.set(r.url, res); }, delete: async r => store.delete(r.url) } };
  globalThis.fetch = async u => { upstream.push(String(u)); return new Response('{"events":[]}', { status: String(u).includes('event=9') ? 404 : 200, headers: { 'Content-Type': 'application/json' } }); };
  const env = { SITE_ORIGINS: 'https://leaguelayer.com,http://localhost:5173' };
  const ask = async (path, origin = 'https://leaguelayer.com') => {
    const waits = [];
    const res = await worker.fetch(new Request(`https://api.leaguelayer.com${path}`, { headers: origin ? { Origin: origin } : {} }), env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  try {
    let r = await ask('/espn/basketball/nba/scoreboard');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://leaguelayer.com');
    assert.equal(r.headers.get('Cache-Control'), 'no-store', "the browser doesn't keep it");
    assert.deepEqual(upstream, ['https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard']);
    await ask('/espn/basketball/nba/scoreboard');
    assert.equal(upstream.length, 1, 'a second visitor: from the cache, ESPN not asked again');
    await ask('/espn/hockey/nhl/scoreboard?dates=20261108&x=1');
    assert.equal(upstream[1], 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261108', 'only the parameters a feed takes');
    await ask('/espn/football/nfl/injuries');
    await ask('/espn/basketball/nba/summary?event=9');
    await ask('/espn/basketball/nba/summary?event=9');
    assert.equal(upstream.filter(u => u.endsWith('event=9')).length, 2, "an ESPN error isn't kept");
    const n = upstream.length;
    for (const bad of ['/espn/basketball/nba/teams', '/espn/baseball/mlb/scoreboard', '/espn/basketball/nba/summary', '/espn/basketball/nba/scoreboard?dates=tomorrow', '/espn/../../x']) {
      assert.equal((await ask(bad)).status, 404, bad);
    }
    assert.equal((await ask('/espn/basketball/nba/scoreboard', 'https://elsewhere.example')).status, 404, "another site's page");
    assert.equal((await ask('/espn/basketball/nba/scoreboard', null)).status, 404, 'no page at all (a script)');
    assert.equal(upstream.length, n, 'none of those reached ESPN');
  } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
});

test("the Worker starts the daily data job at 08:00 UTC through GitHub's API, and logs a run it can't start", async () => {
  const worker = (await import('../worker/index.js')).default;
  const realFetch = globalThis.fetch, realTimeout = globalThis.setTimeout;
  const asked = [], kv = new Map();
  let answers = [];
  globalThis.fetch = async (u, o) => { asked.push({ u: String(u), o }); const [status, body] = answers.shift(); return new Response(body ? JSON.stringify(body) : null, { status }); };
  globalThis.setTimeout = f => realTimeout(f, 0); // (its minute between tries)
  const env = { GITHUB_TOKEN: 'tok', ERRORS: { put: async (k, v) => { kv.set(k, JSON.parse(v)); } } };
  const run = async e => { const waits = []; await worker.scheduled({ cron: '0 8 * * *' }, e, { waitUntil: p => waits.push(p) }); await Promise.all(waits); };
  try {
    answers = [[204]];
    await run(env);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].u, 'https://api.github.com/repos/Eli-CB/league-layer/actions/workflows/site.yml/dispatches');
    assert.equal(asked[0].o.method, 'POST');
    assert.deepEqual(JSON.parse(asked[0].o.body), { ref: 'main' });
    assert.equal(asked[0].o.headers.Authorization, 'Bearer tok');
    assert.ok(asked[0].o.headers['User-Agent'], 'GitHub refuses requests without one');
    assert.equal(kv.size, 0, 'started: nothing logged');
    // an expired token: asked once, and the error log says so
    asked.length = 0;
    answers = [[401, { message: 'Bad credentials' }]];
    await run(env);
    assert.equal(asked.length, 1, "asking again won't help");
    assert.deepEqual([...kv.values()].map(r => r.msg), ['Daily data job not started: GitHub answered 401 (Bad credentials)']);
    // GitHub down for a moment: asked again
    asked.length = 0; kv.clear();
    answers = [[503], [204]];
    await run(env);
    assert.equal(asked.length, 2);
    assert.equal(kv.size, 0);
    // not set up (no token): nothing asked
    asked.length = 0;
    await run({ ERRORS: env.ERRORS });
    assert.equal(asked.length, 0);
  } finally { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; }
});

test("the Worker's live feed: today's scoreboard and box scores cut to what the page reads, built once for everyone", async () => {
  const worker = (await import('../worker/index.js')).default;
  const store = new Map(), upstream = [];
  const realFetch = globalThis.fetch, realCaches = globalThis.caches, realNow = Date.now;
  let now = Date.parse('2026-11-15T23:00:00Z'), espnUp = true;
  Date.now = () => now;
  globalThis.caches = { default: { match: async r => (store.has(r.url) ? store.get(r.url).clone() : undefined), put: async (r, res) => { store.set(r.url, res); }, delete: async r => store.delete(r.url) } };
  // five games: three on, one over, one to come; ESPN's answers with all they carry (news, plays...) besides what the page reads
  const team = (abbreviation, id) => ({ id, abbreviation, displayName: 'x', logo: 'https://x', color: 'fff' });
  const event = (id, state) => ({ id, date: '2026-11-15T23:00Z', name: 'x', links: [{ href: 'x' }], status: { period: 2, clock: 300, displayClock: '5:00', type: { state, shortDetail: '5:00 - 2nd', description: 'x' } },
    competitions: [{ venue: { fullName: 'x' }, competitors: [{ homeAway: 'home', score: '50', team: team('BOS', '2'), records: [], probables: [] }, { homeAway: 'away', score: '48', team: team('DAL', '6'), records: [] }] }] });
  const events = [event('1', 'in'), event('2', 'in'), event('3', 'post'), event('4', 'in'), event('5', 'pre')];
  const box = id => ({ plays: Array(200).fill({ text: 'a long play' }), news: [{ x: 1 }], header: { id }, boxscore: { players: [{ team: team('BOS', '2'), statistics: [{ name: 'x', keys: ['minutes', 'points'], labels: ['MIN', 'PTS'], athletes: [{ athlete: { id: '100', displayName: 'A Player', shortName: 'A. Player', headshot: { href: 'x' } }, active: true, starter: true, didNotPlay: false, stats: ['20', '12'] }] }] }] } });
  globalThis.fetch = async u => {
    u = String(u); upstream.push(u);
    if (!espnUp) return new Response('{}', { status: 503 });
    const body = u.includes('/scoreboard') ? { day: { date: '2026-11-15' }, leagues: [{ x: 1 }], events } : box(u.split('event=')[1]);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const env = { SITE_ORIGINS: 'https://leaguelayer.com,http://localhost:5173' };
  const ask = async (path, origin = 'https://leaguelayer.com') => {
    const waits = [];
    const res = await worker.fetch(new Request(`https://api.leaguelayer.com${path}`, { headers: origin ? { Origin: origin } : {} }), env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const expire = () => store.delete('https://api.leaguelayer.com/__live/basketball/nba'); // (the whole answer's 5 seconds up)
  const summaries = () => upstream.filter(u => u.includes('summary')).map(u => u.split('event=')[1]);
  try {
    let r = await ask('/live/basketball/nba');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://leaguelayer.com');
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    let f = await r.json();
    // at most three box scores a build (the free plan's CPU), the scoreboard always
    assert.deepEqual(summaries(), ['1', '2', '3']);
    assert.deepEqual(Object.keys(f.boxes).sort(), ['1', '2', '3']);
    assert.ok(f.boxes['3'].final && !f.boxes['1'].final, 'a game over: final');
    // cut to what the page reads
    const text = JSON.stringify(f);
    assert.ok(!/plays|news|venue|headshot|links|records|labels|logo/.test(text), text.slice(0, 300));
    assert.deepEqual(f.boxes['1'].box.boxscore.players[0].statistics[0].athletes[0], { athlete: { id: '100', displayName: 'A Player', shortName: 'A. Player' }, active: true, didNotPlay: false, stats: ['20', '12'] });
    assert.deepEqual(f.scoreboard.events[0].competitions[0].competitors[0], { homeAway: 'home', score: '50', team: { id: '2', abbreviation: 'BOS' }, probables: [] });
    assert.equal(f.scoreboard.events[0].status.type.shortDetail, '5:00 - 2nd');
    // a second visitor within the 5 seconds: the same answer, ESPN not asked
    const n = upstream.length;
    await ask('/live/basketball/nba');
    assert.equal(upstream.length, n);
    // the next build: the box score it lacked, not the fresh ones
    expire();
    f = await (await ask('/live/basketball/nba')).json();
    assert.deepEqual(summaries().slice(3), ['4']);
    assert.deepEqual(Object.keys(f.boxes).sort(), ['1', '2', '3', '4'], 'each game with its last one');
    // 20 seconds on: the stalest games under way read again, the finished one never
    now += 20e3;
    expire();
    f = await (await ask('/live/basketball/nba')).json();
    assert.deepEqual(summaries().slice(4).sort(), ['1', '2', '4']);
    assert.equal(f.boxes['1'].at, now);
    // ESPN down: an error (the page asks ESPN itself), nothing kept
    espnUp = false;
    expire();
    assert.equal((await ask('/live/basketball/nba')).status, 502);
    assert.ok(!store.has('https://api.leaguelayer.com/__live/basketball/nba'));
    espnUp = true;
    // football: the scoreboard only (its points come from Sleeper)
    const before = summaries().length;
    f = await (await ask('/live/football/nfl')).json();
    assert.equal(summaries().length, before);
    assert.deepEqual(f.boxes, {});
    // only the site's own pages, only the sports it reads
    assert.equal((await ask('/live/basketball/nba', 'https://elsewhere.example')).status, 404);
    assert.equal((await ask('/live/basketball/nba', null)).status, 404);
    assert.equal((await ask('/live/baseball/mlb')).status, 404);
  } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; Date.now = realNow; }
});

test("the Worker's injury watch: ESPN's report every 3 minutes, one sport a run, what changed and when, written only when it did", async () => {
  const worker = (await import('../worker/index.js')).default;
  const realFetch = globalThis.fetch, realCaches = globalThis.caches, realNow = Date.now;
  let now = 0;
  Date.now = () => now;
  const store = new Map();
  globalThis.caches = { default: {
    match: async r => { const e = store.get(r.url); return e && now < e.until ? e.res.clone() : undefined; },
    put: async (r, res) => { store.set(r.url, { res, until: now + 1e3 * +((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [0, 0])[1] }); },
    delete: async r => store.delete(r.url),
  } };
  const kv = new Map(), puts = [];
  let gets = 0;
  const ERRORS = {
    get: async (k, type) => { gets++; return kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null; },
    put: async (k, v) => { puts.push(k); kv.set(k, v); },
    list: async () => ({ keys: [...kv.keys()].sort().map(name => ({ name })), list_complete: true }),
  };
  const env = { SITE_ORIGINS: 'https://leaguelayer.com', ERRORS, ERRORS_KEY: 'k' };
  // ESPN's entries with all they carry (links, logos, long comments...) besides what the page reads
  const espnEntry = (n, status, note = 'news') => ({ id: String(n), longComment: 'a long comment', shortComment: `${note} ${n}`, status, date: '2026-11-21T15:00Z', source: { id: '1' }, type: { id: '4', name: 'INJURY_STATUS_OUT' },
    details: { fantasyStatus: { abbreviation: 'GTD' }, returnDate: '2026-11-25' },
    athlete: { firstName: 'A', displayName: `Player ${n}`, links: [{ href: `https://www.espn.com/nba/player/_/id/${1000 + n}/player` }], headshot: { href: 'x' }, team: { id: '2', abbreviation: 'BOS', logos: [{ href: 'x' }] }, position: { id: '3', abbreviation: 'G', name: 'Guard' }, notes: [] } });
  let report = Array.from({ length: 24 }, (_, n) => espnEntry(n, n % 3 ? 'Out' : 'Day-To-Day')), espn = 200;
  const upstream = [];
  globalThis.fetch = async u => { upstream.push(String(u)); return new Response(espn === 200 ? JSON.stringify({ timestamp: 'x', injuries: [{ id: '2', displayName: 'Celtics', injuries: report }] }) : '{}', { status: espn }); };
  const run = async (at, cron = '*/3 * * * *') => { const waits = []; await worker.scheduled({ cron, scheduledTime: Date.parse(at) }, env, { waitUntil: p => waits.push(p) }); return (await Promise.all(waits))[0]; };
  const kept = (league = 'basketball/nba') => JSON.parse(kv.get(`watch:${league}`));
  const entry = n => kept().list.find(e => e.athlete.displayName === `Player ${n}`);
  const ask = async (path, origin = 'https://leaguelayer.com') => {
    const waits = [];
    const res = await worker.fetch(new Request(`https://api.leaguelayer.com${path}`, { headers: origin ? { Origin: origin } : {} }), env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  try {
    // the first look (5 p.m. ET): everything kept, at ESPN's times, nothing marked as a change
    assert.equal(await run('2026-11-21T22:00:00Z'), 'written');
    assert.deepEqual(upstream, ['https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries']);
    assert.equal(kept().list.length, 24);
    assert.deepEqual(entry(0), { status: 'Day-To-Day', date: '2026-11-21T15:00Z', shortComment: 'news 0', details: { returnDate: '2026-11-25' },
      athlete: { id: '1000', displayName: 'Player 0', team: { id: '2', abbreviation: 'BOS' }, position: { abbreviation: 'G' } }, since: '2026-11-21T15:00Z' }, 'cut to what the page reads');
    // nothing new 3 minutes on: ESPN asked, nothing written
    assert.equal(await run('2026-11-21T22:03:00Z'), 'unchanged');
    assert.equal(puts.length, 1);
    // ruled out, newly listed, off the report: written at once, with when and what before
    report[0] = espnEntry(0, 'Out');
    report.push(espnEntry(30, 'Day-To-Day'));
    report.splice(2, 1);
    assert.equal(await run('2026-11-21T22:06:00Z'), 'written');
    assert.deepEqual([entry(0).since, entry(0).was], ['2026-11-21T22:06:00.000Z', 'Day-To-Day']);
    assert.deepEqual([entry(30).since, entry(30).was], ['2026-11-21T22:06:00.000Z', '']);
    assert.ok(!entry(2), 'off the report');
    assert.ok(entry(1).since === '2026-11-21T15:00Z' && !('was' in entry(1)), 'the others as they were');
    // only a newer note: written at most every 15 minutes
    report.find(e => e.id === '3').shortComment = 'newer 3';
    assert.equal(await run('2026-11-21T22:09:00Z'), 'unchanged');
    assert.equal(await run('2026-11-21T22:21:00Z'), 'written');
    assert.equal(entry(3).shortComment, 'newer 3');
    assert.equal(entry(0).was, 'Day-To-Day', 'a change keeps its time and what it was');
    // nothing new for an hour: written anyway, so the copy's age says the watch is running
    assert.equal(await run('2026-11-21T23:18:00Z'), 'unchanged');
    assert.equal(await run('2026-11-21T23:21:00Z'), 'written');
    // the night (05:00-14:00 UTC): every 15 minutes
    const n = upstream.length;
    assert.equal(await run('2026-11-22T10:03:00Z'), 'off-peak');
    assert.equal(upstream.length, n, 'ESPN not asked');
    assert.equal(await run('2026-11-22T10:15:00Z'), 'written');
    // hockey: its own runs, a minute after basketball's
    assert.equal(await run('2026-11-22T15:00:00Z'), 'written', '(an hour on: the copy written anyway)');
    assert.equal(await run('2026-11-22T15:01:00Z', '1-59/3 * * * *'), 'written');
    assert.equal(upstream[upstream.length - 1], 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries');
    assert.ok(kept('hockey/nhl').list.length);

    // the page's answer: ESPN's shape, kept a minute for the data center
    now = Date.parse('2026-11-22T15:02:00Z');
    let r = await ask('/injuries/basketball/nba');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://leaguelayer.com');
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    const f = await r.json();
    assert.equal(f.injuries[0].injuries.length, 24);
    assert.ok(f.injuries[0].injuries.some(e => e.was === 'Day-To-Day'));
    const g = gets;
    await ask('/injuries/basketball/nba');
    assert.equal(gets, g, 'a second visitor: from the cache, KV not read');
    assert.equal((await ask('/injuries/basketball/nba', 'https://elsewhere.example')).status, 404);
    assert.equal((await ask('/injuries/basketball/nba', null)).status, 404);
    assert.equal((await ask('/injuries/football/nfl')).status, 404, 'not a sport it watches');

    // ESPN refusing: left alone 15 minutes, then 30..., logged once; the page's answer says so (the page reads ESPN's)
    espn = 403;
    assert.equal(await run('2026-11-22T15:03:00Z'), 'failed: answered 403');
    assert.equal(kept().fails, 1);
    now = Date.parse('2026-11-22T15:04:00Z');
    assert.equal((await ask('/injuries/basketball/nba')).status, 503);
    const m = upstream.length;
    assert.equal(await run('2026-11-22T15:15:00Z'), 'waiting');
    assert.equal(upstream.length, m, 'not asked while waiting');
    assert.equal(await run('2026-11-22T15:18:00Z'), 'failed: answered 403');
    assert.equal(kept().off, Date.parse('2026-11-22T15:48:00Z'), 'then 30 minutes');
    const logged = [...kv.keys()].filter(k => /^\d/.test(k)).map(k => JSON.parse(kv.get(k)).msg);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^Injury watch: ESPN's basketball\/nba report answered 403/);
    // answering again: written at once, back to normal
    espn = 200;
    assert.equal(await run('2026-11-22T15:48:00Z'), 'written');
    assert.ok(!kept().fails && !kept().off);
    // an answer nearly empty where the last had many: not believed
    const full = report;
    report = report.slice(0, 2);
    assert.equal(await run('2026-11-22T15:51:00Z'), 'failed: came back nearly empty');
    assert.equal(kept().list.length, 24, 'the last good copy kept');
    report = full;
    // an hour and a half without a write: the watch has stopped, the page reads ESPN's
    kv.set('watch:basketball/nba', JSON.stringify({ ...kept(), fails: 0, off: 0, at: Date.parse('2026-11-22T15:00:00Z') }));
    now = Date.parse('2026-11-22T16:40:00Z');
    assert.equal((await ask('/injuries/basketball/nba')).status, 503);
    // the error log's page lists errors only, not the watch's copies beside them
    const page = await (await ask('/errors?key=k')).text();
    assert.match(page, /1 reports/);
    assert.ok(!page.includes('undefined'), "a copy isn't read as an error");
    // not set up (no KV): nothing asked
    const o = upstream.length;
    assert.equal(await worker.scheduled({ cron: '*/3 * * * *', scheduledTime: Date.parse('2026-11-22T16:42:00Z') }, {}, { waitUntil: p => p }), undefined);
    assert.equal(upstream.length, o);
  } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; Date.now = realNow; }
});

test("the Worker's error log: the same error saved once every 6 hours, 10 reports a day at most, so a bug on every visit can't use up KV's writes", async () => {
  const worker = (await import('../worker/index.js')).default;
  const realCaches = globalThis.caches, realNow = Date.now;
  let now = Date.parse('2026-11-22T15:00:00Z');
  Date.now = () => now;
  const store = new Map();
  globalThis.caches = { default: {
    match: async r => { const e = store.get(r.url); return e && now < e.until ? e.res.clone() : undefined; },
    put: async (r, res) => { store.set(r.url, { res, until: now + 1e3 * +((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [0, 0])[1] }); },
    delete: async r => store.delete(r.url),
  } };
  const kv = new Map();
  const env = { SITE_ORIGINS: 'https://leaguelayer.com', ERRORS_KEY: 'k', ERRORS: {
    get: async (k, type) => (kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    put: async (k, v) => { kv.set(k, v); },
    list: async () => ({ keys: [...kv.keys()].sort().map(name => ({ name })), list_complete: true }),
  } };
  const send = async (msg, at = 'js/core.js:1', origin = 'https://leaguelayer.com') => {
    const res = await worker.fetch(new Request('https://api.leaguelayer.com/errors', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ msg, at, page: '#dashboard' }) }), env, { waitUntil: p => p });
    assert.equal(res.status, 204);
  };
  try {
    // one bug on every visit: saved once
    for (let i = 0; i < 50; i++) await send('x is not defined');
    assert.equal(kv.size, 1);
    // another error, or the same message from somewhere else: saved
    await send('y is not defined');
    await send('x is not defined', 'js/views.js:9');
    assert.equal(kv.size, 3);
    // six hours on, the same bug: saved again (the log's ×2: it's still happening)
    now += 6 * 36e5;
    await send('x is not defined');
    assert.equal(kv.size, 4);
    // a day's cap: 10 a day, whatever comes
    for (let i = 0; i < 20; i++) await send(`error ${i}`);
    assert.equal(kv.size, 10);
    // the next day (UTC): saved again
    now = Date.parse('2026-11-23T00:30:00Z');
    await send('z is not defined');
    assert.equal(kv.size, 11);
    // not the site's page: nothing
    await send('w', 'js/core.js:1', 'https://elsewhere.example');
    assert.equal(kv.size, 11);
    // the page says what ×N counts
    const page = await (await worker.fetch(new Request('https://api.leaguelayer.com/errors?key=k'), env, { waitUntil: p => p })).text();
    assert.match(page, /x is not defined<\/b> <span class="n">×2/);
    assert.match(page, /at most once every 6 hours/);
  } finally { globalThis.caches = realCaches; Date.now = realNow; }
});

test("the Worker's copies: one request rebuilds an old one, the others take it or wait for the new one, ESPN asked once", async () => {
  const worker = (await import('../worker/index.js')).default;
  const realFetch = globalThis.fetch, realCaches = globalThis.caches, realNow = Date.now;
  let now = Date.parse('2026-11-21T00:30:00Z'), espnUp = true, scoreboards = 0;
  Date.now = () => now;
  // Cloudflare's cache: an entry lasts its max-age, by the Worker's clock
  const store = new Map();
  globalThis.caches = { default: {
    match: async r => { const e = store.get(r.url); return e && now < e.until ? e.res.clone() : undefined; },
    put: async (r, res) => { store.set(r.url, { res, until: now + 1e3 * +((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/) || [0, 0])[1] }); },
    delete: async r => store.delete(r.url),
  } };
  // ESPN: today's scoreboard, no game on yet (a build is one request), answering after 40 ms
  globalThis.fetch = async u => {
    if (String(u).includes('/scoreboard')) scoreboards++;
    await new Promise(r => setTimeout(r, 40));
    return espnUp ? new Response(JSON.stringify({ day: { date: '2026-11-20' }, events: [] }), { headers: { 'Content-Type': 'application/json' } }) : new Response('{}', { status: 503 });
  };
  const env = { SITE_ORIGINS: 'https://leaguelayer.com' };
  const ask = async () => {
    const waits = [];
    const res = await worker.fetch(new Request('https://api.leaguelayer.com/live/basketball/nba', { headers: { Origin: 'https://leaguelayer.com' } }), env, { waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    return { status: res.status, at: res.status === 200 ? (await res.json()).at : null };
  };
  const crowd = n => Promise.all(Array.from({ length: n }, ask));
  const copyKey = 'https://api.leaguelayer.com/__live/basketball/nba';
  const markKey = new Request(`https://api.leaguelayer.com/__rebuilding/${encodeURIComponent(copyKey)}`);
  try {
    const t0 = now;
    assert.equal((await ask()).at, t0);
    assert.equal(scoreboards, 1);
    // 6 s on (past its 5): twenty at once. One rebuilds it; the others take the copy it replaces, at once
    now = t0 + 6e3;
    let got = await crowd(20);
    assert.equal(scoreboards, 2, 'ESPN asked once');
    assert.deepEqual([got.filter(g => g.at === now).length, got.filter(g => g.at === t0).length], [1, 19]);
    // 40 s on, the copy gone (pages that ask together: at a tip-off, then every 30 s): one rebuilds, the others wait for it
    now = t0 + 40e3;
    got = await crowd(20);
    assert.equal(scoreboards, 3, 'ESPN asked once');
    assert.ok(got.every(g => g.status === 200 && g.at === now), 'every one the new copy');
    // another machine in the data center rebuilding it (its mark in the cache, newer than the copy): the old copy...
    now = t0 + 46e3;
    await caches.default.put(markKey, new Response(String(now - 100), { headers: { 'Cache-Control': 'max-age=10' } }));
    assert.equal((await ask()).at, t0 + 40e3);
    assert.equal(scoreboards, 3, 'ESPN not asked');
    // ... and with none, its new one, once that machine has put it in
    store.delete(copyKey);
    setTimeout(() => caches.default.put(new Request(copyKey), new Response(JSON.stringify({ v: 1, at: now, scoreboard: { events: [] }, boxes: {} }), { headers: { 'Content-Type': 'application/json', 'X-Built': String(now), 'Cache-Control': 'max-age=15' } })), 300);
    assert.equal((await ask()).at, now);
    assert.equal(scoreboards, 3, 'ESPN not asked');
    store.delete(markKey.url);
    // ESPN down: the rebuild fails, those waiting for it try in turn (each an error: the page then asks ESPN itself)...
    now = t0 + 100e3;
    espnUp = false;
    got = await crowd(3);
    assert.ok(got.every(g => g.status === 502));
    assert.equal(await caches.default.match(new Request(copyKey)), undefined, 'nothing kept');
    // ... and nothing is left holding up the next one
    espnUp = true;
    const n = scoreboards, started = realNow();
    assert.equal((await ask()).status, 200);
    assert.equal(scoreboards, n + 1);
    assert.ok(realNow() - started < 200, `answered in ${realNow() - started} ms`);
  } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; Date.now = realNow; }
});
