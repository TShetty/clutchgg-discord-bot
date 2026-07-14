// Tournament MVP standings — the same weighted model the website uses
// (ACS, rating, ADR, KAST, entry impact, stage weight, placement bonus).
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { calculateTournamentMvpRankings } = require('../mvp');
const { tournamentUrl, textTable } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mvp')
    .setDescription('Tournament MVP race — same weighted scoring model as clutchgg.in'),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const rankings = calculateTournamentMvpRankings(t);
    if (rankings.length === 0) {
      await interaction.editReply(
        `No MVP standings yet in **${t.name}** — players need recorded map stats (min. maps played) to qualify.`
      );
      return;
    }

    const top = rankings.slice(0, 10);
    const leader = top[0];
    const table = textTable(
      ['#', 'Player', 'Team', 'Score', 'ACS', 'Maps'],
      top.map((r, i) => [i + 1, r.name.slice(0, 16), (r.teamName || '—').slice(0, 12), r.mvpScore.toFixed(1), Math.round(r.weightedACS), r.mapsPlayed])
    );

    const embed = new EmbedBuilder()
      .setTitle(`👑 MVP race — ${t.name}`)
      .setDescription(
        `Current leader: **${leader.name}** (${leader.teamName}) with **${leader.mvpScore.toFixed(1)}**/100\n\n` +
        '```\n' + table.slice(0, 3500) + '\n```'
      )
      .setURL(tournamentUrl(t.id))
      .setColor(0xfacc15)
      .setFooter({ text: 'Scored on ACS, rating, ADR, KAST, entry impact, stage weight & placement — same as the website' });

    await interaction.editReply({ embeds: [embed] });
  },
};
