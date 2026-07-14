// Organizer team self-management: list / add / remove who can run organizer
// commands for the active tournament. Superadmins always retain access.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { upsertDiscordLink } = require('../supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('organizers')
    .setDescription('Manage who can run organizer commands for this tournament')
    .addSubcommand((s) => s.setName('list').setDescription('Show the current organizer team'))
    .addSubcommand((s) =>
      s.setName('add').setDescription('Give someone organizer access')
        .addUserOption((o) => o.setName('user').setDescription('The Discord user to add').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Remove someone\'s organizer access')
        .addUserOption((o) => o.setName('user').setDescription('The Discord user to remove').setRequired(true))
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const sub = interaction.options.getSubcommand();
    const current = ctx.link.discord_user_ids ?? [];

    if (sub === 'list') {
      const embed = new EmbedBuilder()
        .setTitle(`👥 Organizers — ${ctx.tournament.name}`)
        .setDescription(current.length ? current.map((id) => `• <@${id}>`).join('\n') : '(none yet)')
        .setColor(0x00b0f4)
        .setFooter({ text: 'Organizers can run every setup and match command for this tournament' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!ctx.isOrganizer) {
      await interaction.editReply('⛔ Only current organizers (or a superadmin) can change the organizer team.');
      return;
    }

    const user = interaction.options.getUser('user');
    if (user.bot) {
      await interaction.editReply('❌ Bots can\'t be organizers.');
      return;
    }

    if (sub === 'add') {
      if (current.includes(user.id)) {
        await interaction.editReply(`<@${user.id}> is already an organizer.`);
        return;
      }
      await upsertDiscordLink({ ...ctx.link, discord_user_ids: [...current, user.id] });
      await interaction.editReply(`✅ <@${user.id}> can now run organizer commands for **${ctx.tournament.name}**.`);
      return;
    }

    // remove
    if (!current.includes(user.id)) {
      await interaction.editReply(`<@${user.id}> isn't an organizer.`);
      return;
    }
    const remaining = current.filter((id) => id !== user.id);
    if (remaining.length === 0 && !ctx.isSuperAdmin) {
      await interaction.editReply('❌ You can\'t remove the last organizer — add a replacement first, or ask a superadmin.');
      return;
    }
    await upsertDiscordLink({ ...ctx.link, discord_user_ids: remaining });
    await interaction.editReply(`✅ Removed <@${user.id}> from **${ctx.tournament.name}**'s organizer team.`);
  },
};
