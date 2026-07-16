// Head-to-head player comparison — the two players' aggregated tournament
// stats side by side, same numbers as the website's stats page.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { textTable } = require('../tournament-utils');
const { findPlayer, allPlayerNames, playerTotals, playerUrl } = require('../player-stats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare two players\' tournament stats side by side')
    .addStringOption((o) => o.setName('player1').setDescription('First player name or Riot ID').setRequired(true))
    .addStringOption((o) => o.setName('player2').setDescription('Second player name or Riot ID').setRequired(true)),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const q1 = interaction.options.getString('player1');
    const q2 = interaction.options.getString('player2');
    const hit1 = findPlayer(t, q1);
    const hit2 = findPlayer(t, q2);
    const missing = [!hit1 && q1, !hit2 && q2].filter(Boolean);
    if (missing.length) {
      const names = allPlayerNames(t).slice(0, 50).join('\n') || '(no players yet)';
      await interaction.editReply(
        `❌ No player matching ${missing.map((m) => `**${m}**`).join(' or ')}. Try a few players:\n${names}`
      );
      return;
    }
    if (hit1.player.id === hit2.player.id) {
      await interaction.editReply('Those are the same player — pick two different players to compare.');
      return;
    }

    const s1 = playerTotals(t, hit1.player);
    const s2 = playerTotals(t, hit2.player);
    const p1 = hit1.player.name;
    const p2 = hit2.player.name;

    // Winner marker per row so the comparison reads at a glance.
    const row = (label, v1, v2, higherWins = true) => {
      const a = v1 ?? 0, b = v2 ?? 0;
      const mark = a === b ? ['', ''] : (a > b) === higherWins ? ['◄', ''] : ['', '►'];
      return [label, `${v1 ?? '—'} ${mark[0]}`.trim(), `${mark[1]} ${v2 ?? '—'}`.trim()];
    };
    const table = textTable(
      ['Stat', p1.slice(0, 14), p2.slice(0, 14)],
      [
        row('Maps', s1.maps, s2.maps),
        row('Kills', s1.kills, s2.kills),
        row('Deaths', s1.deaths, s2.deaths, false),
        row('Assists', s1.assists, s2.assists),
        row('K/D', s1.kd, s2.kd),
        row('ACS', s1.acs, s2.acs),
        ...(s1.adr !== null || s2.adr !== null ? [row('ADR', s1.adr, s2.adr)] : []),
        ...(s1.fk || s2.fk ? [row('First kills', s1.fk, s2.fk)] : []),
      ]
    );

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ ${p1} vs ${p2}`)
      .setDescription(
        `**${p1}** (${hit1.team.name}) vs **${p2}** (${hit2.team.name})\n` +
        '```\n' + table.slice(0, 3500) + '\n```\n' +
        `[${p1}'s profile →](${playerUrl(t.id, hit1.player.id)}) · [${p2}'s profile →](${playerUrl(t.id, hit2.player.id)})`
      )
      .setColor(0xff4655)
      .setFooter({ text: t.name });

    await interaction.editReply({ embeds: [embed] });
  },
};
