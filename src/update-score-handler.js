// Button handlers for /update-score (customId namespace "usc:"), routed from
// bot.js. Holds a short-lived in-memory cache of pending pulls so the confirm
// step commits the already-fetched stats without a second Valorant API call.
//
// The cache is process-local and ephemeral by design: if the bot restarts
// between preview and confirm, the token expires and the organizer simply
// re-runs the command. The durable write goes through saveTournament's
// optimistic lock, so a concurrent website/bot edit can never be clobbered.
const { EmbedBuilder } = require('discord.js');
const { saveTournament, replaceMatch, propagateWinner } = require('./write-utils');
const { matchUrl } = require('./tournament-utils');
const { seriesResult } = require('./scoreboard');

// token → { tournamentId, matchId, append, overwrite, ... , expiresAt }
const pending = new Map();
const TTL_MS = 15 * 60 * 1000; // matches Discord's interaction edit window

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k);
}

// Store a pending pull and return its token (the reply message id, unique per
// interaction). Called by the command after fetching.
async function putPending(interaction, data) {
  sweep();
  // The deferred/edited reply's message id is a stable, unique key.
  const msg = await interaction.fetchReply().catch(() => null);
  const token = msg?.id ?? `${interaction.id}`;
  pending.set(token, { ...data, expiresAt: Date.now() + TTL_MS });
  return token;
}

// Commit the chosen map set to the match, compute the winner, advance the bracket.
async function commit(interaction, token, mode) {
  const entry = pending.get(token);
  if (!entry) {
    await interaction.editReply({
      content: '⌛ This score preview expired (or the bot restarted). Please run `/update-score` again.',
      embeds: [], components: [],
    });
    return;
  }
  pending.delete(token); // one-shot: prevent double-commit on a double click

  const maps = mode === 'append' ? entry.append : entry.overwrite;

  let failMsg = null;
  let summary = null;
  let committedMatchId = entry.matchId;

  await saveTournament(entry.tournamentId, (t) => {
    // Locate the match fresh in the current blob (it may have moved/changed).
    let target = null;
    for (const b of [t.generatedBracket, t.stage1Bracket, t.stage2Bracket, t.knockoutBracket]) {
      if (!b) continue;
      for (const m of b.rounds.flat()) if (m.id === entry.matchId) target = m;
    }
    if (!target) { failMsg = 'That match no longer exists in the tournament. It may have been regenerated.'; return t; }

    const updated = { ...target, maps };
    // First map's player stats also sit at match level (website parity).
    const firstWithStats = maps.find((m) => m.playerStats && m.playerStats.length > 0);
    updated.playerStats = firstWithStats?.playerStats ?? target.playerStats;

    const res = seriesResult(updated);
    if (res.decided) updated.winner = res.winnerId;

    let nt = replaceMatch(t, updated);
    if (res.decided) propagateWinner(nt, updated);

    const t1 = target.team1Name;
    const t2 = target.team2Name;
    const winnerName = res.decided ? (res.winnerId === target.team1Id ? t1 : t2) : null;
    summary =
      `**${t1} ${res.s1} : ${res.s2} ${t2}**\n` +
      `${maps.filter((m) => m.playerStats?.length || m.team1Score || m.team2Score).length} map(s) recorded with player stats.\n` +
      (res.decided ? `🏆 Winner: **${winnerName}** — bracket advanced automatically.` : 'ℹ️ Series not decided yet — add remaining maps when they\'re played.');
    committedMatchId = target.id;
    return nt;
  });

  if (failMsg) {
    await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle('✅ Stats recorded')
    .setURL(matchUrl(committedMatchId))
    .setDescription(summary)
    .setColor(0x22c55e)
    .setFooter({ text: 'View: /bracket · scoreboard: /match-info · share: /post' });
  await interaction.editReply({ content: '', embeds: [embed], components: [] });
}

// Router (bot.js dispatches customIds starting with "usc:").
async function handle(interaction) {
  const [, action, token] = interaction.customId.split(':');

  if (action === 'cancel') {
    await interaction.update({ content: '❌ Cancelled — nothing was recorded.', embeds: [], components: [] });
    return;
  }
  if (action === 'append' || action === 'overwrite') {
    // Acknowledge fast (defer the component update) then commit + edit.
    await interaction.deferUpdate();
    await commit(interaction, token, action);
    return;
  }
}

module.exports = { handle, putPending };
