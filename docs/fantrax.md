# Fantrax: js/fantrax.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/fantrax.js or anything that asks Fantrax.

- fantrax: `fxGet` (retries/backoff), `fxGetAll`, `fetchFantraxLeague`, league cache (`getLeague`, 6h; past that drawn as kept and read again behind the page, `readLeagueBehind`), shared
  player list/ADP (`fxPlayerLists`: read from the daily job's `data/fantrax.json`, `data/nhl/fantrax.json`, Fantrax itself only when that's missing or over 2 days old), scoring (`fxScoring`: points or categories), keepers (`keepersOf`), name matching
  (`matchPlayers`), which site an ID is on (`leagueSourceOf`, `parseLeagueId`, `sourceName`), `getJson` (shared retries)

## Rules settled with the owner (keep them)
- Fantrax: minimize requests. League data cached on the device, read again from its site now and then, and ↻ Reload by hand (gear menu, or the
  Matchup tab's stamp; no ↻ Reload within 2 minutes of the league's last read: `RELOAD_COOL`, `reloadWait`, the menu says "read just now").
  How often is `READ_PACE` (fantrax.js), a row per site (Nov 24, 2026, the owner's ask: so a site that questions the requests can be turned
  down alone; raise minutes or set false there, nothing else): `open` (30 min: opening the page or picking the league, an older copy is
  drawn and read again behind it, `leagueStale`; the site's own league too, `siteLeagueStale`), `back` (5 min: back on the page after 1+
  minute away, `backReadDue`), `start` (10-20 minutes before a matchup period's first game and 2-6 minutes after) and `daily` (the same
  around each game day's first game in a daily-lineup league, `dayFirstGame`; football's week is its periods). Each page reads at its own
  random moment in each window (`autoReload.spread`, Nov 2026: a site's worth of visitors mustn't reach Fantrax in the same minute, its busiest)
  (`checkAutoReload`, actions.js: Fantrax starts a period at its first tip-off, else ESPN's scoreboard, else 7 PM ET; only when the
  league was read before that moment; checked once a minute and on coming back to the page), so the lock's lineups and the new
  period show without a manual Reload. A read asks only for what can change: a finished draft (`state` 'completed') and week 1's
  rosters come from the copy kept here (fetchFantraxLeague's `kept`), so a read is 3-4 requests. A read that brings nothing new
  (`res.same`, `leagueSig`) leaves the page as it is (no `changed('league')`, no redraw: only the stamp's time moves, `stampNow`), and
  an automatic one that fails is quiet until the copy is past `LEAGUE_OLD_MS` (6 h). Weekly rosters fetched once per finished period. Shared player list/ADP: never from each browser (Nov 20, 2026: thousands of
  visitors each asking Fantrax for the same large lists daily, all from leaguelayer.com, is what gets a site noticed); the daily job saves them.

## Gotchas
- The page never waits on a league it has kept (Nov 21, 2026): one past `READ_PACE`'s open minutes is drawn from the device and read again
  behind it (`readLeagueBehind`, opening the page or picking it in the league menu; if its site fails, the copy stays and a toast says its age).
  Waiting made a day's first visit ~4 s: a Fantrax league is 4-5 requests one after another. Every league goes this way; basketball's site
  league (hockey and football have none) is drawn from the daily file and read behind it once it's older than the open minutes and made yours. Reads of one league share one request (`leagueReads`).
- Fantrax rate limits answer 200 OK with `{ error: { code: 'RATE_LIMITED', message: '... at most once every 5 seconds per
  IP address.' } }` (getDraftResults: 5 s): `getJson` waits what it says and asks again; a draft that still doesn't come
  marks the league `draftFailed` (not kept on the device; Draft tab offers Try again), never "no draft".
- `getTeamRosters` with no period answers the new period from midnight ET, hours before it starts at its first game (its
  `startDate`, e.g. 7 PM ET): weekly leagues then ask for the period before as this week's and keep the new one as
  `nextRosters`, the same two requests (`fetchFantraxLeague`, and `fantrax()` in update_data.py). Read as this week's, the
  Matchup tab drew the week just played with next week's lineups (Nov 23, 2026).
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
- Private Fantrax leagues load like any other, with no login (checked Nov 22, 2026 with the owner's test league "testest" `ywhrlx6smwsawar4`,
  "Allow public to view league" off): the public API (`fxea/general/`) ignores that setting. Only Fantrax's internal API (`fxpa/req`) and its
  league pages want a login, for every league. Never ask visitors for a Fantrax cookie: nothing needs one, and a browser couldn't send it anyway (`Access-Control-Allow-Origin: *`).
