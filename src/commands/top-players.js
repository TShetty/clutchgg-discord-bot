const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl, aggregatePlayerStats, textTable } = require('../tournament-utils');

const METRICS = {
  acs: { label: 'ACS (avg combat score)', sort: (a, b) => b.acs - a.acs, col: (r) => r.acs },
  kd: { label: 'K/D ratio', sort: (a, b) => b.kd - a.kd, col: (r) => r.kd },
  kills: { label: 'Total kills', sort: (a, b) => b.kills - a.kills, col: (r) => r.kills },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top-players')
    .setDescription('Tournament stat leaders — ranked by ACS, K/D, or kills')
    .addStringOption((o) =>
      o
        .setName('by')
        .setDescription('Which stat to rank players by (default: ACS)')
        .addChoices(
          { name: 'ACS — average combat score', value: 'acs' },
          { name: 'K/D — kill/death ratio', value: 'kd' },
          { name: 'Kills — total kills', value: 'kills' },
        )
    ),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;
    const metricKey = interaction.options.getString('by') ?? 'acs';
    const metric = METRICS[metricKey];

    const rows = aggregatePlayerStats(t).filter((r) => r.maps > 0);
    if (rows.length === 0) {
      await interaction.editReply(`No player stats recorded yet in **${t.name}** — stats appear once matches have data pulled.`);
      return;
    }

    rows.sort(metric.sort);
    const top = rows.slice(0, 10);
    const table = textTable(
      ['#', 'Player', 'Team', metricKey.toUpperCase(), 'K', 'D', 'A'],
      top.map((r, i) => [i + 1, r.playerName.slice(0, 16), (r.teamName || '—').slice(0, 12), metric.col(r), r.kills, r.deaths, r.assists])
    );

    const embed = new EmbedBuilder()
      .setTitle(`🎯 Top players by ${metric.label} — ${t.name}`)
      .setDescription('```\n' + table.slice(0, 4000) + '\n```')
      .setURL(tournamentUrl(t.id))
      .setColor(0xff4655)
      .setFooter({ text: `Across ${rows.length} players with recorded stats` });

    await interaction.editReply({ embeds: [embed] });
  },
};
