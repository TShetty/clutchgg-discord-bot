// Shared helpers for write commands: website-parity guards, match lookup,
// organizer authorization, and safe read-modify-write of the tournament blob.
const { getTournamentById, upsertTournament } = require('./supabase');
const { requireLinkedTournament } = require('./context');
const { realMatches, deriveScore, effectiveStatus } = require('./tournament-utils');

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
        const t = new Date(`${m.date}T${m.time || '00:00'}`).getTime();
        if (!Number.isNaN(t) && t <= now) return true;
      }
    }
  }
  if (tournament.event?.startDate) {
    const t = new Date(`${tournament.event.startDate}T00:00`).getTime();
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

// Save with read-modify-write: re-fetch latest blob, apply `mutate` to it, and
// persist — so we never clobber website edits made since the command started.
async function saveTournament(tournamentId, mutate) {
  const latest = await getTournamentById(tournamentId);
  if (!latest) throw new Error('Tournament disappeared while saving');
  const updated = mutate(latest) ?? latest;
  await upsertTournament(updated);
  return updated;
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
  deriveScore,
  effectiveStatus,
};
