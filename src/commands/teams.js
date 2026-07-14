const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('teams')
    .setDescription('List all teams registered in this tournament'),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const teams = t.teams ?? [];
    if (teams.length === 0) {
      await interaction.editReply(
        `**${t.name}** has no teams yet. An organizer can add them with \`/import-teams\` (coming soon) or on the website.`
      );
      return;
    }

    const lines = teams.map((team, i) => `**${i + 1}.** ${team.name} — ${team.players?.length ?? 0} players`);
    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Teams — ${t.name}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${teams.length}${t.event?.maxTeams ? `/${t.event.maxTeams}` : ''} teams · use /roster to see a team's players` })
      .setURL(tournamentUrl(t.id))
      .setColor(0x00b0f4);

    await interaction.editReply({ embeds: [embed] });
  },
};
