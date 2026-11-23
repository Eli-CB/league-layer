# Plan Ahead: js/matchups.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/matchups.js.

- matchups: the Plan Ahead tab (`#week`, was Matchups; opens on next period, else the week picked: `planAheadWeek`, `ui.weekChosen`), schedule dots (a game on now: `.dots i.live`, flashing green while he's in it, the owner's ask, never red; a flashing ring until he checks in; listed Out, the red ring; the week underway follows tonight's games, `weekTabLive` in live.js), stat tables, tooltips. The opponent's injured reserve (`state.opp.il`, `oppIlIds`/`oppActive` in nba.js) sits in the board's IR row (tag "IR"; `IL` inside the code), never on their bench or in their projection. A finished week (its last day before today) shows nothing to plan (no suggestions, pickups or
  live odds): its real result and lineups, bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore`
  in history), and what was projected going in beside what happened (below), else one line saying why not (`pastNote` in
  `viewWeek`: the last night's box scores not in yet, with `fillWeekFromEspn` asked meanwhile; no matchup; a league whose past lineups aren't read: ESPN football, Yahoo)

## Rules settled with the owner (keep them)
- A finished week, the owner's ask (Nov 23, 2026; it replaced "never a projection"): a scoreboard (the final, Won/Lost in the
  gauge's place, "Projected going in" under it), a Lineups board with Per game / Week total (`ui.pastMode`, its own stored
  choice) and a VAL column (FP in points leagues), and "Against their averages" (better / worse than usual, missed games).
  All from data already loaded, nothing saved (the owner weighs anything that costs requests): `weekVsAverages` (history.js)
  gives each player his team's games while starting, the days he missed, his averages from this season's games before the
  week (fewer than 3: his season's now) and their projection; the team's adds up for `compareCats`. Per game shades how he
  played against those averages, Week total against the projection, so missed games count (`pastZ`); a bench player is
  measured on the games he played. It isn't the projection the site showed then (who was listed Out isn't known): saving
  that, or keeping football's past Sleeper projections in the daily file, would be new data, the owner's call.
  Its players' FG%/FT% take two places like this week's board; the Week total and Projected rows three (they decide the category).
- Weekly lineups lock when the week starts, so the lineup people are setting is next week's: Fantrax leagues with weekly
  lineups also load next period's rosters (`L.nextRosters`, one more request; the daily job too), and the Matchups tab
  shows them on next week (`withViewedTeam(viewWeek, true)`, `nextRosterPeriod()`, `fxTeamSide(tid, period)`). Every
  other tab and the saved lineup stay on this week's.
- A new period becomes this period at its first game, not at midnight (the owner's ask, Nov 23, 2026: people set Monday's
  lineups up to the evening's tip-off, and "next period" had already moved on): `weekStartAt` asks `weekBegun` (nba.js),
  which reads `periodFirstGame` (Fantrax's lock, its first tip-off; else ESPN's scoreboard; else 7 PM ET; ESPN's, Sleeper's
  and Yahoo's midnight "lock" is a placeholder, skipped). Before it, Plan Ahead opens on the new period as Next period, its
  lineups open, and the Matchup tab still shows the period just played, as Fantrax does. `lockTime` is the same moment.
  Until then the week's notes give that time as the deadline, "lineups lock today 5:00 PM" (the owner's ask, Nov 23, 2026:
  `fxWeekNotes`, `lockWhen`; `periodLock`/`periodKickoff` say whether it's known), "~" before it when it's the 7 PM ET guess.
  A week turning with Plan Ahead open loads the new week's real opponent (`planAheadWeek`).
- No title row (the owner's pick from mockups, Nov 23, 2026): the week's picker, ‹ its name › (a menu of every week) with
  its days under, sits across the scoreboard under the win chance, a half-circle gauge (`weekPicker`, `.sb-week`, `winGauge`).
  With no scoreboard (a finished week, roto, no opponent yet) it heads the card shown instead, so the week can always be
  changed (`top` in `viewWeek`). The week's notes (lineups locked, whose rosters) end the scoreboard's last line (`.sb-foot`).
- Each side's starter games sit beside its score, a chip like the Matchup tab's (the number alone on a phone; never in football):
  the owner's pick, Nov 23, 2026, for the empty room between the scores and the gauge, over the categories each side is favored
  in or each team's record. Yours counts the lineup the score is for, the suggested one (`gamesChip` in `viewWeek`).
- Another team picked in place of the real opponent says so in one line across the top of the scoreboard (`fxOppNote`,
  `.sb-hypo`: "Hypothetical", Back to the real one), never under the opponent's menu: there it took two or three lines on a
  phone and pushed that side's score down (the owner found it clunky, Nov 23, 2026).
- A period longer than a week (the NBA Cup's, the All-Star break's) draws each player's schedule dots a row a week (`.dots.wk`,
  `dayDots`), at every width: 14 in a line ran the games count into the opponent's column on a phone (Nov 23, 2026).
- On a desktop the Schedule view's bubbles carry each day's opponent ("@ORL" away), the days over them in the head, beside the
  name instead of under it (the owner's pick from mockups, Nov 23, 2026: the room between a name and his dots was empty; a
  narrower tab was turned down). By the card's own width (`@container board`, 1084 px; phones keep the dots), never in a period
  longer than a week, and only with a data file that has the opponents (`vs`, docs/data.md): `dayCells`, `boardHead`, `vsOn`.
  The opponent opens his team's card (`teamBtn`); a game to come has a grey outline, green only once played (the owner's ask,
  Nov 23, 2026: the team says there's a game; a back-to-back is in its tip, Out keeps its red ring). Bubbles are 40 px: at 36
  "@GSW" touched the outline, and the 1084 px gives the names back the room the extra width took.
- The Lineups board's Per game and Week total show FG% and FT% to two places, ".49", players and Projected week alike (the owner's
  ask, Nov 20, 2026: `fmtPct(n, 2)`); the Categories table and the tips keep three.
