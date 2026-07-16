// A player's tournament card — team, role, Riot ID, aggregated stats and a
// link to their clutchgg.in profile page.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { findPlayer, allPlayerNames, playerTotals, playerUrl } = require('../player-stats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription("A player's card — team, role, stats and profile link")
    .addStringOption((o) =>
      o.setName('name').setDescription('Player name or Riot ID (partial match works)').setRequired(true)
    ),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const q = interaction.options.getString('name');
    const hit = findPlayer(t, q);
    if (!hit) {
      const names = allPlayerNames(t).slice(0, 50).join('\n') || '(no players yet)';
      await interaction.editReply(`❌ No player matching **${q}**. Try a few players:\n${names}`);
      return;
    }
    const { team, player } = hit;
    const s = playerTotals(t, player);

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${player.name}`)
      .setURL(playerUrl(t.id, player.id))
      .setColor(0xff4655)
      .setFooter({ text: t.name });

    embed.addFields({ name: 'Team', value: team.name, inline: true });
    if (player.role) embed.addFields({ name: 'Role', value: player.role.toUpperCase(), inline: true });
    if (player.riotId) embed.addFields({ name: 'Riot ID', value: `\`${player.riotId}\``, inline: true });

    if (s.maps > 0) {
      embed.addFields({
        name: `Tournament stats (${s.maps} map${s.maps === 1 ? '' : 's'})`,
        value:
          `**${s.kills}/${s.deaths}/${s.assists}** K/D/A · **${s.kd}** K/D · **${s.acs}** avg ACS` +
          `${s.adr !== null ? ` · **${s.adr}** ADR` : ''}` +
          `${s.fk || s.fd ? `\nFirst kills: **${s.fk}** · First deaths: **${s.fd}**` : ''}` +
          `${s.topAgents.length ? `\nAgents: ${s.topAgents.join(', ')}` : ''}`,
      });
    } else {
      embed.addFields({ name: 'Tournament stats', value: 'No played maps with stats yet.' });
    }

    embed.addFields({ name: '🔗 Full profile', value: playerUrl(t.id, player.id) });
    await interaction.editReply({ embeds: [embed] });
  },
};
