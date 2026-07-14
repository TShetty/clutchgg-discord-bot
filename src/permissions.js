// Authorization checks, per INSTRUCTIONS.md:
// - Superadmins come from the SUPERADMIN_DISCORD_IDS env var (comma-separated).
// - Organizers are Discord user IDs stored in tournament_discord_links for
//   their tournament. Every write command must pass one of these checks.
// - A guild can host multiple linked tournaments; commands act on the ACTIVE
//   one (is_active, switched via /use-tournament).
const { getDiscordLinksByGuild } = require('./supabase');

function superadminIds() {
  return (process.env.SUPERADMIN_DISCORD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSuperAdmin(userId) {
  return superadminIds().includes(userId);
}

// Which of a guild's links commands should act on: the active one; if several
// are marked active (or none), the most recently updated wins. Links list is
// already newest-first.
function pickActiveLink(links) {
  if (links.length === 0) return null;
  if (links.length === 1) return links[0];
  return links.find((l) => l.is_active) ?? links[0];
}

// Resolve the tournament linked to the guild the command was used in, and
// whether the invoking user is an organizer of it (or a superadmin).
// `allLinks` carries every tournament linked to the guild so commands can
// offer /use-tournament when there's more than one.
async function resolveGuildTournament(interaction) {
  const links = interaction.guildId ? await getDiscordLinksByGuild(interaction.guildId) : [];
  const link = pickActiveLink(links);
  const admin = isSuperAdmin(interaction.user.id);
  const organizer =
    admin || (!!link && (link.discord_user_ids || []).includes(interaction.user.id));
  return {
    link,
    allLinks: links,
    tournamentId: link ? link.tournament_id : null,
    isOrganizer: organizer,
    isSuperAdmin: admin,
  };
}

module.exports = { isSuperAdmin, resolveGuildTournament, pickActiveLink };
