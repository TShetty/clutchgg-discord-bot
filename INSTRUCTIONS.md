# ClutchGG Discord Bot — Development Instructions

These rules govern ALL feature work on this bot. Read this file before adding or
changing any command. The bot exists so tournament organizers can run their
tournament from Discord without logging into the clutchgg.in admin portal.

---

## Rule 1: Website parity is mandatory

Every edit/update option the bot exposes must be **exactly** the same set of
options the website gives a tournament organizer — no more, no fewer, no
renamed values.

The website is the source of truth. Before building a command, read the
corresponding website types/components in the main repo
(`s:\work\clutchgg\clutchgg_n\clutchgg`):

| Bot command area           | Website source of truth                                      |
|----------------------------|--------------------------------------------------------------|
| Tournament details         | `src/app/components/TournamentCreation.tsx` — `Tournament`, `TournamentEvent`, `PrizePool` (currencies: INR/USD/EUR/GBP, INR default) |
| Teams & rosters            | `TeamInTournament`, `TournamentPlayer` (roles: igl, duelist, controller, sentinel, initiator) |
| Excel team import          | `src/app/utils/excelImportUtils.ts` — columns: Team Name, Player Name 1-7 (1-5 mandatory), Riot ID 1-7 (optional, "name#tag"), Role 1-7 (optional). **Photos are NOT imported via Excel** — same rule as website: photos are uploaded from the website edit section only. |
| Brackets                   | `BracketGenerated`, `Stage1Config` — stage 1 formats: single / double / roundrobin / groupstage; stage 2 formats: single / double; qualifiersCount, pointsPerWin (default 3), teamsQualifyingPerGroup |
| Matches                    | `BracketMatch` — format bo1/bo3/bo5, date (YYYY-MM-DD), time (HH:MM), streamUrl (YouTube), clips[] |
| Match locking              | `matchHasStats()` — a match with pulled Valorant stats cannot have its structure edited |
| Tournament begun/locking   | `tournamentHasBegun()` — once begun, bracket TYPE cannot change; teams/players/statless matches stay editable |
| Storage                    | Supabase `tournaments_blob` table — one JSON blob per tournament (`{ id, data, updated_at }`), read/written whole |

If the website adds/changes an option, the bot must be updated to match. If a
bot feature needs an option the website doesn't have, the option must be added
to the website FIRST (or explicitly rejected).

## Rule 2: Commands must be self-explanatory

Organizers are not developers. Every slash command must have:

- A clear `description` on the command AND on every option/parameter.
- Ephemeral help output for wrong usage that explains what the command does,
  what it needs, and an example.
- A `/help` command listing every command grouped by category (setup, teams,
  bracket, matches, stats, notifications) with a one-line explanation of each.
- Confirmation embeds after every write showing exactly what changed.
- Error messages that say what to fix, not just "failed".

## Rule 3: The new-tournament workflow is sacred

When a tournament is created (registration approved on the website), the bot
walks the organizer through setup **in this order** — each step gated on the
previous:

1. **DM the organizer Discord IDs** from the registration form: "your
   tournament is created" + website tournament link.
2. **Channel setup** — ask for the tournament's Discord server; read its
   channels and let the organizer pick where the bot posts (single channel or
   split: schedule channel, results channel). Store per-purpose channel IDs.
3. **`/set-tournament-details`** — description, prize pool (total, currency,
   per-place breakdown), start date, max teams, event type, number of stages.
4. **`/import-teams`** — bot provides the .xlsx template (same columns as
   website import), organizer uploads the filled file.
5. **Bracket generation** — `/set-bracket` with the same options as the
   website for stage 1 (and stage 2 when two-stage). Show a bracket visual on
   success, then let the organizer fill slots with teams.
6. **Match setup** — assign teams to slots, set date/time, stream link,
   bo1/bo3/bo5 per match. Show the updated bracket after all matches are set.
7. **Offer to post** the upcoming-matches announcement (with real website
   match links) to the chosen tournament channel.
8. **Suggest all commands** with explanations of what each does.

`/lock-tournament` is only executable once details + teams + bracket + initial
matchups all exist.

## Rule 4: Match results are validated against the website — always

When an organizer reports a result (`/finish-match` or any score input):

1. The bot fetches the website's latest recommended/actual match data for that
   match (Valorant API-pulled stats where present).
2. The organizer's claimed score is compared against it.
3. On mismatch: do NOT save. Reply asking the organizer to re-check the score
   and try again, showing what the website has.
4. Only matches that are pending stat updates are offered in the
   "which match to finish/update" pickers.

The website's pulled data always wins over a manually-typed score.

---

## Authorization model

- `tournament_discord_links` maps tournament_id → organizer Discord user IDs +
  guild + purpose-tagged channel IDs + is_active + one-time claim_code.
- Onboarding paths (both end with a linked server):
  1. **Self-service (preferred):** approval poller issues a one-time claim
     code and DMs it to superadmins → organizer runs `/claim-tournament` in
     THEIR server → becomes first organizer, code is consumed. Superadmins can
     mint codes manually with `/generate-claim-code` (`relink:true` to move a
     linked tournament).
  2. **Manual:** superadmin runs `/link-tournament` inside the target server.
- A guild may host MULTIPLE tournaments. Commands act on the ACTIVE link
  (`is_active`, most-recently-updated as fallback); organizers switch with
  `/use-tournament`. Never assume one-link-per-guild (`.maybeSingle()` on the
  guild query is a bug).
- Organizers self-manage their team via `/organizers add/remove/list` — the
  last organizer cannot be removed (except by a superadmin).
- Every write command checks `interaction.user.id` against the active link.
  Non-organizers get a polite ephemeral refusal. `/report-issue` is
  organizer-only with a 10-minute per-user cooldown (DM-spam guard).
- Commands are registered GLOBALLY (`npm run register`) so new organizer
  servers get them; `--guild` registers to the dev guild for instant testing.
- The bot uses the Supabase service_role key (Railway env var only — NEVER in
  git) and enforces authorization itself; it does not impersonate organizer
  auth accounts.
- Superadmin Discord IDs are configured via env var (`SUPERADMIN_DISCORD_IDS`).

## Reliability rules (learned the hard way)

- ALWAYS `deferReply()` first in every command handler, then `editReply()`.
  Never use a bare `reply()` — the 3s window is too tight on real networks.
- Warm up the REST pool at startup (`client.application.fetch()`).
- Tournament blob writes must be read-modify-write on the latest data and
  should re-read after write to confirm.

## Command catalog (target state)

Setup: /set-tournament-details, /import-teams, /set-bracket, /lock-tournament, /create-team-roles, /link-tournament (superadmin)
Teams: /list-teams, /team-roster, /update-roster
Info:  /get-tournament-details, /get-bracket, /upcoming-matches, /live-matches, /today-matches, /player, /compare, /team-stats, /head-to-head, /clips, /match-card
Match: /update-match-details, /finish-match
Stats: /pull-stats (acs/kdr/kills), /post-stats, /tournament-standing, /post-standing
Misc:  /help, /report-issue (notifies superadmin via Discord/email about wrong stats)

Notifications (automatic — each kind toggleable per tournament via
`/notifications`, individually or all at once):
- 15 minutes before a scheduled match → post to schedule channel, tag team
  roles if available.
- Match start time passes → live announcement to schedule channel with the
  stream link + live scoreboard link (10-minute grace window; never fires for
  long-past matches or on restart).
- Match finished on website → post result card to results channel: website
  match link, score, MVP name + stats, and a UNIQUE stat-based flavor line
  (varied templates keyed off the actual performance — never the same message
  twice in a row).
- All of a day's matches complete → post the day's standings/group table.
