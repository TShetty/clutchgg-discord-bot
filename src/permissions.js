// Authorization checks, per INSTRUCTIONS.md:
// - Superadmins come from the SUPERADMIN_DISCORD_IDS env var (comma-separated).
// - Organizers are Discord user IDs stored in tournament_discord_links for
//   their tournament. Every write command must pass one of these checks.
const { getDiscordLinkByGuild } = require('./supabase');

function superadminIds() {
  return (process.env.SUPERADMIN_DISCORD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSuperAdmin(userId) {
  return superadminIds().includes(userId);
}

// Resolve the tournament linked to the guild the command was used in, and
// whether the invoking user is an organizer of it (or a superadmin).
// Returns { link, tournamentId, isOrganizer } — link is null when the guild
// has no linked tournament.
async function resolveGuildTournament(interaction) {
  const link = interaction.guildId ? await getDiscordLinkByGuild(interaction.guildId) : null;
  const admin = isSuperAdmin(interaction.user.id);
  const organizer =
    admin || (!!link && (link.discord_user_ids || []).includes(interaction.user.id));
  return {
    link,
    tournamentId: link ? link.tournament_id : null,
    isOrganizer: organizer,
    isSuperAdmin: admin,
  };
}

module.exports = { isSuperAdmin, resolveGuildTournament };
