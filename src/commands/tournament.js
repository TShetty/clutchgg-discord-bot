const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl, allBrackets } = require('../tournament-utils');

// Same currency symbols as the website (TournamentCreation.tsx).
const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

// Mirrors formatPrize on the website: prepend symbol only for bare numbers.
function formatPrize(value, currency) {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (!/^\d/.test(v)) return v;
  return `${CURRENCY_SYMBOLS[currency ?? 'INR']}${v}`;
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;

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

      const pool = t.event.prizePool;
      if (pool && (pool.total || pool.places?.length)) {
        const parts = [];
        if (pool.total) parts.push(`**Total: ${formatPrize(pool.total, pool.currency)}**`);
        for (const place of pool.places ?? []) {
          parts.push(`${ordinal(place.position)}: ${formatPrize(place.prize, pool.currency)}`);
        }
        embed.addFields({ name: '💰 Prize pool', value: parts.join('\n').slice(0, 1024), inline: false });
      }
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
