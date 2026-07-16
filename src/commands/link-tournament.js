// Superadmin-only: link a tournament (by website tournament ID) to this
// Discord server — its organizer Discord IDs and the channels the bot posts
// to. This is the bootstrap for tournaments created before the registration
// form collected Discord IDs, and the fix-up tool if anything changes.
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { isSuperAdmin } = require('../permissions');
const { getTournamentById, getDiscordLink, upsertDiscordLink } = require('../supabase');

// Accept "<@123>, <@456>" mentions or raw IDs separated by spaces/commas.
function parseUserIds(raw) {
  return [...raw.matchAll(/\d{15,21}/g)].map((m) => m[0]);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link-tournament')
    .setDescription('(Superadmin) Link a ClutchGG tournament to this Discord server and its organizers')
    .addStringOption((o) =>
      o
        .setName('tournament_id')
        .setDescription('The tournament ID from the website (the ID in the tournament page URL)')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('organizers')
        .setDescription('Discord users who can run organizer commands — mention them or paste their IDs')
        .setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName('announce_channel')
        .setDescription('Channel for general tournament announcements (match results, standings)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName('schedule_channel')
        .setDescription('Optional separate channel for match schedules and reminders (defaults to announce channel)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption((o) =>
      o
        .setName('results_channel')
        .setDescription('Optional separate channel for match results (defaults to announce channel)')
        .addChannelTypes(ChannelType.GuildText)
    ),
  ephemeral: true,
  async execute(interaction) {
    if (!isSuperAdmin(interaction.user.id)) {
      await interaction.editReply('⛔ Only a ClutchGG superadmin can link tournaments.');
      return;
    }
    if (!interaction.guildId) {
      await interaction.editReply('This command must be used inside the tournament\'s Discord server.');
      return;
    }

    const tournamentId = interaction.options.getString('tournament_id').trim();
    const organizerIds = parseUserIds(interaction.options.getString('organizers'));
    const announce = interaction.options.getChannel('announce_channel');
    const schedule = interaction.options.getChannel('schedule_channel') || announce;
    const results = interaction.options.getChannel('results_channel') || announce;

    if (organizerIds.length === 0) {
      await interaction.editReply(
        '❌ No valid Discord users found in `organizers`. Mention them (e.g. `@name @name`) or paste their numeric IDs.'
      );
      return;
    }

    // Every chosen channel must belong to THIS guild (defensive — the picker
    // already enforces it, but the bot must never post to a foreign server).
    const foreign = [announce, schedule, results].find((c) => c.guildId && c.guildId !== interaction.guildId);
    if (foreign) {
      await interaction.editReply('❌ All channels must be in THIS server.');
      return;
    }

    const tournament = await getTournamentById(tournamentId);
    if (!tournament) {
      await interaction.editReply(
        `❌ No tournament with ID \`${tournamentId}\` found on the website. Check the ID in the tournament page URL and try again.`
      );
      return;
    }

    const existing = await getDiscordLink(tournamentId);
    await upsertDiscordLink({
      tournament_id: tournamentId,
      discord_user_ids: organizerIds,
      discord_guild_id: interaction.guildId,
      channels: {
        announce: announce.id,
        schedule: schedule.id,
        results: results.id,
      },
      claim_code: null, // manual link supersedes any outstanding claim code
      is_active: true,
    });

    const embed = new EmbedBuilder()
      .setTitle(existing ? '🔗 Tournament link updated' : '🔗 Tournament linked')
      .setDescription(`**${tournament.name}** is now linked to this server.`)
      .addFields(
        { name: 'Organizers', value: organizerIds.map((id) => `<@${id}>`).join(' '), inline: false },
        { name: 'Announcements', value: `<#${announce.id}>`, inline: true },
        { name: 'Schedule', value: `<#${schedule.id}>`, inline: true },
        { name: 'Results', value: `<#${results.id}>`, inline: true }
      )
      .setColor(0x00b0f4);

    await interaction.editReply({ embeds: [embed] });
  },
};
