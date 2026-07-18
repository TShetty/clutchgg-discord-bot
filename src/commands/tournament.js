const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl, allBrackets, formatPrizePool } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Show this tournament\'s details — dates, prize pool, format, teams, status'),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${t.name}`)
      .setURL(tournamentUrl(t.id))
      .setColor(0xff4655);

    if (t.overview) embed.setDescription(t.overview.slice(0, 4000));

    embed.addFields({ name: 'Status', value: t.status ?? 'planning', inline: true });
    embed.addFields({ name: 'Teams', value: `${t.teams?.length ?? 0}${t.event?.maxTeams ? ` / ${t.event.maxTeams}` : ''}`, inline: true });

    if (t.event) {
      if (t.event.startDate) embed.addFields({ name: 'Start date', value: t.event.startDate, inline: true });
      embed.addFields({ name: 'Type', value: t.event.type ?? 'online', inline: true });
      if (t.event.location) embed.addFields({ name: 'Location', value: t.event.location, inline: true });

      const poolText = formatPrizePool(t.event.prizePool);
      if (poolText) embed.addFields({ name: '💰 Prize pool', value: poolText.slice(0, 1024), inline: false });
    }

    // Format/stages summary
    const stages = [];
    if (t.stage1Config) {
      const f = t.stage1Config.format;
      stages.push(`Stage 1: ${f === 'groupstage' ? 'Group Stage' : f} (${t.stage1Config.qualifiersCount} qualify)`);
    }
    if (t.stage2Format) stages.push(`Stage 2: ${t.stage2Format} elimination`);
    if (!stages.length) {
      const b = t.generatedBracket;
      if (b?.bracketType) stages.push(`${b.bracketType === 'roundrobin' ? 'Round Robin' : `${b.bracketType} elimination`}`);
    }
    if (stages.length) embed.addFields({ name: 'Format', value: stages.join('\n'), inline: false });

    const bracketCount = allBrackets(t).length;
    embed.setFooter({ text: bracketCount ? 'Bracket generated · use /bracket to view it' : 'No bracket yet' });

    await interaction.editReply({ embeds: [embed] });
  },
};
