// Self-service onboarding: an organizer links THEIR OWN server using the
// one-time claim code that ClutchGG issued for their tournament — no
// superadmin needs to join the server. The claimer becomes the first
// organizer (they can add teammates with /organizers add).
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getLinkByClaimCode, getTournamentById, upsertDiscordLink } = require('../supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim-tournament')
    .setDescription('Link YOUR tournament to this server using the claim code ClutchGG gave you')
    .addStringOption((o) => o.setName('tournament_id').setDescription('Your tournament ID (in your tournament page URL)').setRequired(true))
    .addStringOption((o) => o.setName('code').setDescription('The one-time claim code you received from ClutchGG').setRequired(true))
    .addChannelOption((o) =>
      o.setName('announce_channel').setDescription('Channel for announcements (results, standings)').addChannelTypes(ChannelType.GuildText).setRequired(true)
    )
    .addChannelOption((o) =>
      o.setName('schedule_channel').setDescription('Optional separate channel for schedules & reminders').addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption((o) =>
      o.setName('results_channel').setDescription('Optional separate channel for results').addChannelTypes(ChannelType.GuildText)
    ),
  ephemeral: true,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.editReply('Run this inside your tournament\'s Discord server.');
      return;
    }
    const tournamentId = interaction.options.getString('tournament_id').trim();
    const code = interaction.options.getString('code').trim();

    const link = await getLinkByClaimCode(tournamentId, code);
    if (!link) {
      await interaction.editReply(
        '❌ That tournament ID + code combination isn\'t valid. Check both against what ClutchGG sent you — codes are one-time and case-sensitive. ' +
        'If it keeps failing, contact ClutchGG support.'
      );
      return;
    }
    if (link.discord_guild_id) {
      await interaction.editReply('❌ This tournament is already linked to a server. Ask a ClutchGG superadmin if it needs to be moved.');
      return;
    }

    const tournament = await getTournamentById(tournamentId);
    if (!tournament) {
      await interaction.editReply(`❌ Tournament \`${tournamentId}\` no longer exists on the website.`);
      return;
    }

    const announce = interaction.options.getChannel('announce_channel');
    const schedule = interaction.options.getChannel('schedule_channel') || announce;
    const results = interaction.options.getChannel('results_channel') || announce;

    await upsertDiscordLink({
      ...link,
      discord_guild_id: interaction.guildId,
      discord_user_ids: [interaction.user.id],
      channels: { announce: announce.id, schedule: schedule.id, results: results.id },
      claim_code: null, // one-time use
      is_active: true,
    });

    const embed = new EmbedBuilder()
      .setTitle(`🔗 ${tournament.name} claimed!`)
      .setDescription(
        `You (<@${interaction.user.id}>) are now this tournament's organizer on Discord.\n\n` +
        `• Add co-organizers: \`/organizers add\`\n` +
        `• The setup guide will be posted in <#${announce.id}> shortly.\n` +
        `• \`/help\` explains every command.`
      )
      .setColor(0x22c55e);
    await interaction.editReply({ embeds: [embed] });
  },
};
