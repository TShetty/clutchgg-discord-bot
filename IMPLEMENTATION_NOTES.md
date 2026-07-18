# /update-score Implementation Guide

## STATUS: ✅ IMPLEMENTED (2026-07-17)

Files added:
- `src/riot-id.js` — shared Riot ID normalization (ported from website `riotId.ts`)
- `src/valorant-api.js` — HenrikDev API client (ported from website `valorantApi.ts`); calls `https://api.henrikdev.xyz/valorant` directly with `HENRIK_API_KEY`
- `src/scoreboard.js` — series/winner logic + Discord embed formatter (map name, per-team round score, per-player K/D/A · KD · ACS · ADR table)
- `src/commands/update-score.js` — the slash command (list mode + fetch/preview mode)
- `src/update-score-handler.js` — button handlers (`usc:` namespace) that commit and auto-advance
- Wired `usc:` into `bot.js` interaction router; added to `/help`

**Requires env var:** `HENRIK_API_KEY` (same key the website's proxy uses). Optional: `VALORANT_REGION` (default `ap`), `HENRIK_API_BASE`.

Verified by `scratchpad/update-score-test.js` — 28 checks (formatter, series/winner logic, mocked API pull with team-side mapping, append vs overwrite, bracket auto-advance).

### How it works
1. `/update-score` (no args) → lists scorable matches with their state (no stats / N maps in / done).
2. `/update-score match:<n> match_ids:<id1,id2,…>` → fetches each Valorant match id, shows a scoreboard preview embed + buttons.
   - **No existing maps:** one **Confirm & record stats** button.
   - **Existing maps present (BO3 partial):** **Add N as new map(s)** + **Overwrite from map 1** + **Cancel**.
3. On confirm: writes maps + player stats, computes series winner from map scores (BOn rule), sets `match.winner`, and calls `propagateWinner` to advance the bracket — all via `saveTournament`'s optimistic lock.

Pending pulls are cached in-memory (15-min TTL) keyed by reply message id, so confirm commits without a second API call. Bot restart between preview and confirm → token expires, organizer re-runs.

---

## Original Overview (design reference)
Build a Discord command to pull Valorant match stats from the API, display a scoreboard, auto-advance winners, and handle BO3 partial updates.

## Core Requirements

### 1. Match Lookup & API Pull
- **File**: `commands/update-score.js`
- **Input**: Match reference (numeric from `/matches` list or raw match ID)
- **API Call**: Mirror website's Valorant stat refresh logic from `TournamentCreation.tsx`
  - Endpoint: `/api/valorant/match/{matchId}` (or equivalent)
  - Returns: `playerStats` array with all maps of the match
  - Structure: `{ playerStats: [{ playerId, playerName, agent, map, kills, deaths, assists, acs, adr, roundsWon, ... }] }`
- **Guard**: Check `matchHasStats(match)` (in write-utils.js) — reject if already has stats (prevent overwrites without explicit flag)

### 2. Scoreboard Formatter
- **Display format** (embed with fields):
  - **Header**: Match name, tournament, status
  - **Per-Map Section** (one field per map or grouped):
    - Map name
    - Teams & round scores (e.g., "Team A 13-11 Team B")
    - Player table (max 4096 chars for embed):
      - Player Name | Team | K | D | A | ACS | ADR
      - Sorted by K/D or ACS (descending)
  - **Summary**: Current state (Map 1 done, Map 2 pending, etc.)
- **Constraints**: Discord embed limit 4096 chars per field → truncate or split if needed

### 3. BO3 Partial Update Logic
- **Scenario A**: Map 1 exists, Map 2 missing (BO3 in progress)
  - Detect: Pull API, check if `playerStats[0]` exists but `playerStats[1]` missing
  - Option 1: "Update Map 2" button → confirm and commit
  - Option 2: "Overwrite Map 1" button → re-pull and replace existing stats
  - Show: Org can see current state before choosing
  
- **Scenario B**: Map 1 missing (first-time pull or fresh match)
  - Detect: Pull API, no existing stats
  - Show all maps returned by API (typically 1-3 for BO3)
  - Button: "Confirm Stats" → commit all maps

- **Scenario C**: Full data available (all maps have stats)
  - Show: Scoreboard of all maps
  - Options: "Overwrite" or "Add as Map N" (if more maps exist)

### 4. Auto-Advance Winner
- **After stats committed**:
  - Find match in bracket (use `findMatch(tournament, matchId)`)
  - Determine winner (majority map wins for BO3, single map winner for BO1)
  - Call `propagateWinner(tournament, finishedMatch)` (in write-utils.js)
  - Find next bracket slot for winner:
    - Check `stage2Bracket` if exists (stage 1 winner advances to stage 2)
    - Otherwise check `generatedBracket` (single-stage tournament)
    - Use `winnerGoesTo` / `loserGoesTo` references to auto-fill next match
  - Auto-fill: `match.team1Id = winner.id`, `match.team1Name = winner.name`, `match.autoPopulated = true`

### 5. Confirmation Flow
- **Steps**:
  1. User runs `/update-score match:<ref>`
  2. Command fetches match data & pulls Valorant API
  3. Display scoreboard (map names, players, stats, team round scores)
  4. Show buttons:
     - For BO3 partial: "Update Map 2" / "Overwrite Map 1" / "Cancel"
     - For fresh: "Confirm Stats" / "Cancel"
     - For complete: "Overwrite" / "Add Map N" / "Cancel"
  5. User confirms
  6. Command commits stats, propagates winner, saves tournament
  7. Reply: "✅ Stats recorded. Team X advances to Stage 2" (or next bracket)

## Implementation Checklist

### Phase 1: Setup & Match Lookup
- [ ] Create `commands/update-score.js` with command definition
- [ ] Add slash command options:
  - `match` (string, required): Match reference (number or ID)
  - `confirm` (boolean, optional): Skip interactive flow (for repeats)
- [ ] Implement `findMatch()` call (reuse write-utils.js export)
- [ ] Guard: Check organizer access (`requireOrganizer`)
- [ ] Guard: Check tournament not locked

### Phase 2: Valorant API Pull
- [ ] Research website's API endpoint & call pattern
  - Location: `TournamentCreation.tsx` (search for "playerStats refresh" or API calls)
  - Capture: exact URL, request body, response structure
- [ ] Implement API call in `update-score.js`
- [ ] Parse response into scoreboard data structure
- [ ] Guard: Check `matchHasStats(match)` — reject if already pulled (unless `--force` flag)

### Phase 3: Scoreboard Formatter
- [ ] Build embed with map-by-map breakdown
- [ ] Format player table: Name | Team | K/D/A/ACS/ADR
- [ ] Handle long player lists (truncate or paginate)
- [ ] Show team round scores per map
- [ ] Respect 4096-char embed field limit

### Phase 4: BO3 Logic & State Detection
- [ ] Detect scenario: first-time, partial (map 1 done), or complete
- [ ] Implement logic:
  - `if (no stats exist)` → fresh pull flow
  - `if (map 1 exists && map 2 missing)` → partial update flow
  - `if (all maps exist)` → full data flow
- [ ] Show user the detected state in embed

### Phase 5: Button Interactions
- [ ] Create interaction handlers for:
  - `upd:confirm` (fresh stats)
  - `upd:map2` (add map 2)
  - `upd:map1ow` (overwrite map 1)
  - `upd:add<N>` (add map N)
  - `upd:cancel` (cancel flow)
- [ ] Each handler: validate state, commit stats, call `propagateWinner`, save tournament

### Phase 6: Auto-Advance Winner
- [ ] After stats confirmed:
  - Parse match result (BO3: majority maps, BO1: single match)
  - Call `propagateWinner(tournament, match)` to route through bracket
  - Update next bracket match slots with winner team
  - Save tournament via `saveTournament()`
- [ ] Reply: Show winner advancement info

### Phase 7: Testing & Edge Cases
- [ ] Test fresh BO3 pull (no prior stats)
- [ ] Test BO3 partial (map 1 done, add map 2)
- [ ] Test BO3 partial (overwrite map 1)
- [ ] Test single-stage bracket auto-advance
- [ ] Test two-stage bracket (winner → stage 2)
- [ ] Test rejected overwrites (already pulled stats, no `--force`)
- [ ] Test Discord embed truncation (very long player lists)

## File Locations & Imports

**Primary file**: `S:\work\clutchgg\clutchgg_n\ClutchGG-Discord-Bot\src\commands\update-score.js`

**Reusable functions** (already exported):
```js
// write-utils.js
const { findMatch, numberedMatchList, replaceMatch, propagateWinner, matchHasStats } = require('../write-utils');

// tournament-utils.js
const { realMatches, deriveScore } = require('../tournament-utils');
```

**Discord.js**:
```js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
```

## Key Constraints

1. **Website API Parity**: Match website's Valorant API call exactly (structure, endpoint, error handling)
2. **Embed Limits**: Max 4096 chars per field → plan for truncation on long player lists
3. **Concurrency**: Use `saveTournament()` with optimistic locking (handles races)
4. **BO3 State**: Detect map count from API response, not from match object (API is source of truth)
5. **Winner Propagation**: Scoped stage bracket IDs already handled by `propagateWinner()` — no extra work needed
6. **Organizer-only**: All mutations require organizer auth

## Notes for Later

- Website's stat refresh may use a different Valorant API (internal vs. official Riot API) — confirm endpoint before building
- Consider rate-limiting API calls if org reruns command multiple times
- BO3 logic assumes "best of 3 maps" — adjust if other formats supported (e.g., BO1, BO5)
- Auto-advance is fire-and-forget (no rollback) — stats are permanent once confirmed
