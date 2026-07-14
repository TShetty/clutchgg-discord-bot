const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl, computeRRStandings, textTable } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show current standings (round robin / group stage points table)'),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    // Same source priority as the website's standings tab: a round-robin
    // bracket wherever it lives (stage 1 or single-stage).
    const rrBrackets = [];
    if (t.stage1Bracket?.bracketType === 'roundrobin') rrBrackets.push({ label: 'Stage 1', bracket: t.stage1Bracket });
    if (t.generatedBracket?.bracketType === 'roundrobin') rrBrackets.push({ label: 'Standings', bracket: t.generatedBracket });

    if (rrBrackets.length === 0) {
      await interaction.editReply(
        `**${t.name}** has no points-based stage (round robin / groups). ` +
        'Elimination brackets advance by results — use `/bracket` to see progression.'
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 Standings — ${t.name}`)
      .setURL(tournamentUrl(t.id))
      .setColor(0x00b0f4)
      .setFooter({ text: 'Points = wins × points-per-win · tiebreak: round diff (same as website)' });

    for (const { label, bracket } of rrBrackets) {
      const rows = computeRRStandings(bracket.rounds ?? [], bracket.rrTeams ?? [], bracket.pointsPerWin);
      if (rows.length === 0) continue;
      const table = textTable(
        ['#', 'Team', 'P', 'W', 'L', 'Pts'],
        rows.map((r, i) => [i + 1, r.teamName.slice(0, 18), r.played, r.wins, r.losses, r.points])
      );
      embed.addFields({ name: label, value: '```\n' + table.slice(0, 1000) + '\n```' });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
