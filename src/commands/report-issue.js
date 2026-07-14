// Report wrong stats/data on the website to the ClutchGG superadmins.
// DMs every configured superadmin with the report and its context.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report-issue')
    .setDescription('Report wrong stats or data on the website to the ClutchGG admins')
    .addStringOption((o) =>
      o.setName('issue').setDescription('What\'s wrong? Include the match/player and what the correct value should be').setRequired(true)
    )
    .addStringOption((o) => o.setName('link').setDescription('clutchgg.in link to the affected page (optional but helps a lot)')),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;

    const issue = interaction.options.getString('issue');
    const link = interaction.options.getString('link');

    const superadmins = (process.env.SUPERADMIN_DISCORD_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (superadmins.length === 0) {
      await interaction.editReply('❌ No superadmins are configured to receive reports. (Env var `SUPERADMIN_DISCORD_IDS` is empty.)');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🚨 Issue report')
      .setDescription(issue.slice(0, 4000))
      .addFields(
        { name: 'Tournament', value: `${ctx.tournament.name} (\`${ctx.tournamentId}\`)`, inline: true },
        { name: 'Reported by', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
        ...(link ? [{ name: 'Link', value: link, inline: false }] : []),
      )
      .setTimestamp(new Date())
      .setColor(0xef4444);

    let delivered = 0;
    for (const id of superadmins) {
      try {
        const user = await interaction.client.users.fetch(id);
        await user.send({ embeds: [embed] });
        delivered++;
      } catch (e) {
        console.error(`[report-issue] Could not DM superadmin ${id}:`, e.message);
      }
    }

    if (delivered === 0) {
      await interaction.editReply('❌ Could not deliver the report (superadmins may have DMs closed). Please contact ClutchGG support directly.');
    } else {
      await interaction.editReply(`✅ Report sent to ${delivered} admin(s). They\'ll look into it — thanks for flagging!`);
    }
  },
};
