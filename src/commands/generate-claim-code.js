// Superadmin: issue a one-time claim code for a tournament so its organizer
// can self-link their own server with /claim-tournament — no superadmin visit
// needed. Send the code to the organizer privately (email / DM).
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('node:crypto');
const { isSuperAdmin } = require('../permissions');
const { getTournamentById, getDiscordLink, upsertDiscordLink } = require('../supabase');

// 16 random bytes (~22 base64url chars) so the code can't be brute-forced even
// without the per-user attempt limit in /claim-tournament.
const newCode = () => crypto.randomBytes(16).toString('base64url');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('generate-claim-code')
    .setDescription('(Superadmin) Issue a one-time code an organizer uses to link their own server')
    .addStringOption((o) => o.setName('tournament_id').setDescription('The tournament ID from the website').setRequired(true))
    .addBooleanOption((o) =>
      o.setName('relink').setDescription('Tournament already linked to a server: unlink it and issue a fresh code')
    ),
  ephemeral: true,
  async execute(interaction) {
    if (!isSuperAdmin(interaction.user.id)) {
      await interaction.editReply('⛔ Superadmin only.');
      return;
    }
    const tournamentId = interaction.options.getString('tournament_id').trim();
    const relink = interaction.options.getBoolean('relink') ?? false;

    const tournament = await getTournamentById(tournamentId);
    if (!tournament) {
      await interaction.editReply(`❌ No tournament with ID \`${tournamentId}\` on the website.`);
      return;
    }

    const existing = await getDiscordLink(tournamentId);
    if (existing?.discord_guild_id && !relink) {
      await interaction.editReply(
        `❌ **${tournament.name}** is already linked to a server. Re-run with \`relink:true\` to unlink it and issue a fresh code (its organizer list and channels reset on claim).`
      );
      return;
    }

    const code = newCode();
    await upsertDiscordLink({
      tournament_id: tournamentId,
      discord_user_ids: relink ? [] : (existing?.discord_user_ids ?? []),
      discord_guild_id: null,
      channels: {},
      claim_code: code,
      is_active: true,
      locked: false,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎟️ Claim code for ${tournament.name}`)
      .setDescription(
        `\`\`\`\n${code}\n\`\`\`\n` +
        'Send this to the organizer **privately**. In THEIR server they run:\n' +
        `\`/claim-tournament tournament_id:${tournamentId} code:${code} announce_channel:#channel\`\n\n` +
        'The code is one-time — it\'s consumed on claim. Whoever claims becomes the first organizer.'
      )
      .setColor(0x00b0f4);
    await interaction.editReply({ embeds: [embed] });
  },
};
