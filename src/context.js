// Resolves "which tournament does this Discord server belong to" for commands.
// Every guild-scoped command starts here; replies with a friendly setup hint
// when the server hasn't been linked yet (returns null in that case).
const { resolveGuildTournament } = require('./permissions');
const { getTournamentById } = require('./supabase');

async function requireLinkedTournament(interaction) {
  if (!interaction.guildId) {
    await interaction.editReply('This command only works inside a tournament\'s Discord server.');
    return null;
  }
  const ctx = await resolveGuildTournament(interaction);
  if (!ctx.link) {
    await interaction.editReply(
      '❌ This server isn\'t linked to a ClutchGG tournament yet.\n' +
      'A ClutchGG superadmin needs to run `/link-tournament` here first.'
    );
    return null;
  }
  const tournament = await getTournamentById(ctx.tournamentId);
  if (!tournament) {
    await interaction.editReply(
      `❌ The linked tournament (\`${ctx.tournamentId}\`) no longer exists on the website. Ask a superadmin to re-run \`/link-tournament\`.`
    );
    return null;
  }
  return { ...ctx, tournament };
}

module.exports = { requireLinkedTournament };
