const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');

// Same roles as the website (TournamentCreation.tsx PlayerRole).
const ROLE_EMOJI = { igl: '🧠', duelist: '⚔️', controller: '🌫️', sentinel: '🛡️', initiator: '⚡' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription("Show a team's players (name, Riot ID, role)")
    .addStringOption((o) =>
      o
        .setName('team')
        .setDescription('Team name (partial match works, e.g. "velo" finds "Velocity Gaming")')
        .setRequired(true)
    ),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const query = interaction.options.getString('team').trim().toLowerCase();
    const teams = t.teams ?? [];
    const team =
      teams.find((tm) => tm.name.toLowerCase() === query) ||
      teams.find((tm) => tm.name.toLowerCase().includes(query));

    if (!team) {
      const names = teams.map((tm) => `• ${tm.name}`).join('\n') || '(no teams yet)';
      await interaction.editReply(`❌ No team matching **${query}**. Teams in this tournament:\n${names}`);
      return;
    }

    const players = team.players ?? [];
    const lines = players.map((p) => {
      const role = p.role ? ` ${ROLE_EMOJI[p.role] ?? ''} ${p.role.toUpperCase()}` : '';
      const riot = p.riotId ? ` · \`${p.riotId}\`` : '';
      return `**${p.name}**${role}${riot}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`👥 ${team.name}`)
      .setDescription(lines.join('\n') || 'No players on this roster yet.')
      .setFooter({ text: `${players.length} players · ${t.name}` })
      .setColor(0x00b0f4);
    if (team.description) embed.addFields({ name: 'About', value: team.description.slice(0, 1024) });

    await interaction.editReply({ embeds: [embed] });
  },
};
