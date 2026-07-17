// Shared helpers for write commands: website-parity guards, match lookup,
// organizer authorization, and safe read-modify-write of the tournament blob.
const { getTournamentRowById, updateTournamentIfUnchanged } = require('./supabase');
const { requireLinkedTournament } = require('./context');
const { realMatches, deriveScore, effectiveStatus, matchStartMs } = require('./tournament-utils');

// ── Ported guards (TournamentCreation.tsx) ───────────────────────────────────

// True once any map of a match has pulled Valorant stats — its structure is
// locked on the website, so the bot locks it too.
function matchHasStats(match) {
  if (Array.isArray(match.playerStats) && match.playerStats.length > 0) return true;
  return (match.maps ?? []).some(
    (m) => (Array.isArray(m.playerStats) && m.playerStats.length > 0) || !!m.matchId
  );
}

// Once begun (stats pulled anywhere, or scheduled start passed), the bracket
// TYPE can no longer change. Teams/players/statless matches stay editable.
function tournamentHasBegun(tournament) {
  const brackets = [
    tournament.generatedBracket,
    tournament.stage1Bracket,
    tournament.stage2Bracket,
    tournament.knockoutBracket,
  ];
  for (const b of brackets) {
    if (!b) continue;
    for (const m of b.rounds.flat()) {
      if (matchHasStats(m)) return true;
    }
  }
  const now = Date.now();
  for (const b of brackets) {
    if (!b) continue;
    for (const m of b.rounds.flat()) {
      if (m.date) {
        const t = matchStartMs(m.date, m.time);
        if (!Number.isNaN(t) && t <= now) return true;
      }
    }
  }
  // The nominal start date only locks the bracket TYPE once a bracket exists.
  // Before any bracket is generated there is nothing to lock, so a start date
  // that is merely today/past must not block creating the first bracket.
  const hasBracket = brackets.some((b) => b);
  if (hasBracket && tournament.event?.startDate) {
    const t = matchStartMs(tournament.event.startDate, '00:00');
    if (!Number.isNaN(t) && t <= now) return true;
  }
  return false;
}

// ── Bot-side helpers ─────────────────────────────────────────────────────────

// Entry gate for every write command: linked guild + organizer + not locked.
// Replies with the reason and returns null when the caller may not proceed.
async function requireOrganizer(interaction) {
  const ctx = await requireLinkedTournament(interaction);
  if (!ctx) return null;
  if (!ctx.isOrganizer) {
    await interaction.editReply('⛔ Only this tournament\'s organizers can use this command. Ask a ClutchGG superadmin to add you via `/link-tournament`.');
    return null;
  }
  if (ctx.link.locked && !ctx.isSuperAdmin) {
    await interaction.editReply('🔒 This tournament is locked (`/lock-tournament`). Changes via the bot are disabled.');
    return null;
  }
  return ctx;
}

// Save with optimistic-locked read-modify-write: re-fetch the latest blob,
// apply `mutate`, and persist ONLY if nobody wrote in between (updated_at
// unchanged). On a lost race we re-read and re-apply the mutation, so a website
// edit or a concurrent command can never be silently clobbered (INSTRUCTIONS.md
// reliability rule). `mutate` must be a pure function of the blob — it may run
// more than once.
async function saveTournament(tournamentId, mutate, { retries = 4 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const row = await getTournamentRowById(tournamentId);
    if (!row) throw new Error('Tournament disappeared while saving');
    const updated = mutate(row.data) ?? row.data;
    const ok = await updateTournamentIfUnchanged(updated, row.updatedAt);
    if (ok) return updated;
    // Someone else wrote first — brief backoff, then re-read and retry.
    await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
  }
  throw new Error('Could not save — the tournament kept changing underneath. Please run the command again.');
}

// Find a match by its /matches list number (1-based over realMatches, the same
// ordering every command shows) or by raw match id.
function findMatch(tournament, ref) {
  const items = realMatches(tournament);
  const byId = items.find(({ match }) => match.id === ref);
  if (byId) return byId;
  const n = parseInt(ref, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= items.length) return items[n - 1];
  return null;
}

// Numbered match list (the numbers findMatch accepts).
function numberedMatchList(tournament, filter) {
  const items = realMatches(tournament);
  return items
    .map((item, i) => ({ n: i + 1, ...item }))
    .filter((item) => (filter ? filter(item) : true));
}

// Winner propagation, mirroring the website's bracket routing: put the winner
// (and loser, for double-elim) into the slot the match's routing points at.
// Used by /finish-match and by the poller's auto-finish.
function propagateWinner(t, finished) {
  const winnerIsT1 = finished.winner === finished.team1Id;
  const winner = { id: finished.winner, name: winnerIsT1 ? finished.team1Name : finished.team2Name };
  const loser = { id: winnerIsT1 ? finished.team2Id : finished.team1Id, name: winnerIsT1 ? finished.team2Name : finished.team1Name };

  // Single-elim id convention: match_<round>_<index> with winner_<round>_<index>
  // placeholder team ids. Stage brackets carry a `<tournamentId>__` scope prefix
  // on the MATCH id (website parity) while the placeholder team ids stay
  // unscoped, so parse the id's tail rather than the whole string.
  const se = !finished.winnerGoesTo ? /(?:^|__)match_(\d+)_(\d+)$/.exec(finished.id) : null;

  const apply = (b) => {
    if (!b) return;
    for (const m of b.rounds.flat()) {
      if (finished.winnerGoesTo?.matchId === m.id) {
        if (finished.winnerGoesTo.slot === 1) { m.team1Id = winner.id; m.team1Name = winner.name; }
        else { m.team2Id = winner.id; m.team2Name = winner.name; }
        m.autoPopulated = true;
      }
      if (finished.loserGoesTo?.matchId === m.id) {
        if (finished.loserGoesTo.slot === 1) { m.team1Id = loser.id; m.team1Name = loser.name; }
        else { m.team2Id = loser.id; m.team2Name = loser.name; }
        m.autoPopulated = true;
      }
      if (se) {
        const [, r, i] = se;
        if (m.team1Id === `winner_${r}_${i}`) { m.team1Id = winner.id; m.team1Name = winner.name; }
        if (m.team2Id === `winner_${r}_${i}`) { m.team2Id = winner.id; m.team2Name = winner.name; }
      }
    }
  };
  // Propagate only inside the bracket that owns the finished match — every
  // single-elim bracket shares the same winner_<r>_<i> placeholder ids, so
  // applying across all brackets would leak a stage 1 winner into stage 2
  // (the website's propagateMatchInBracket is per-bracket for the same reason).
  const brackets = [t.generatedBracket, t.stage1Bracket, t.stage2Bracket, t.knockoutBracket];
  const owner = brackets.find((b) => b && b.rounds.flat().some((m) => m.id === finished.id));
  if (owner) apply(owner);
  else brackets.forEach(apply); // legacy fallback: unknown id — old behavior
}

// Replace a match by id across every bracket (applyMatchToTournament port).
function replaceMatch(tournament, updatedMatch) {
  const replaceIn = (b) =>
    b ? { ...b, rounds: b.rounds.map((r) => r.map((m) => (m.id === updatedMatch.id ? updatedMatch : m))) } : b;
  return {
    ...tournament,
    generatedBracket: replaceIn(tournament.generatedBracket),
    stage1Bracket: replaceIn(tournament.stage1Bracket),
    stage2Bracket: replaceIn(tournament.stage2Bracket),
    knockoutBracket: replaceIn(tournament.knockoutBracket),
  };
}

module.exports = {
  matchHasStats,
  tournamentHasBegun,
  requireOrganizer,
  saveTournament,
  findMatch,
  numberedMatchList,
  replaceMatch,
  propagateWinner,
  deriveScore,
  effectiveStatus,
};
