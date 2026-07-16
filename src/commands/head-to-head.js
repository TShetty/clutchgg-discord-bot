// Past meetings between two teams in this tournament — series tally, map
// tally, and every meeting with its score and stage.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { realMatches, deriveScore, matchUrl } = require('../tournament-utils');

function resolveTeam(t, q) {
  const s = q.trim().toLowerCase();
  return (t.teams ?? []).find((tm) => tm.name.toLowerCase() === s)
    || (t.teams ?? []).find((tm) => tm.name.toLowerCase().includes(s))
    || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('head-to-head')
    .setDescription('Past meetings between two teams in this tournament')
    .addStringOption((o) => o.setName('team1').setDescription('First team name (partial match works)').setRequired(true))
    .addStringOption((o) => o.setName('team2').setDescription('Second team name (partial match works)').setRequired(true)),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const q1 = interaction.options.getString('team1');
    const q2 = interaction.options.getString('team2');
    const team1 = resolveTeam(t, q1);
    const team2 = resolveTeam(t, q2);
    const missing = [!team1 && q1, !team2 && q2].filter(Boolean);
    if (missing.length) {
      const names = (t.teams ?? []).map((tm) => `• ${tm.name}`).join('\n') || '(no teams)';
      await interaction.editReply(`❌ No team matching ${missing.map((m) => `**${m}**`).join(' or ')}. Teams:\n${names}`);
      return;
    }
    if (team1.id === team2.id) {
      await interaction.editReply('Those are the same team — pick two different teams.');
      return;
    }

    const meetings = realMatches(t).filter(({ match: m }) =>
      (m.team1Id === team1.id && m.team2Id === team2.id) || (m.team1Id === team2.id && m.team2Id === team1.id)
    );
    if (!meetings.length) {
      await interaction.editReply(`**${team1.name}** and **${team2.name}** haven't met in this tournament (yet).`);
      return;
    }

    let series1 = 0, series2 = 0, maps1 = 0, maps2 = 0;
    const lines = meetings.map(({ match: m, stage, status }) => {
      const t1First = m.team1Id === team1.id;
      const { s1, s2 } = deriveScore(m);
      const [a, b] = t1First ? [s1, s2] : [s2, s1];
      if (status === 'completed') {
        if (a > b) series1++; else if (b > a) series2++;
        maps1 += a;
        maps2 += b;
        return `${a > b ? '🟩' : '🟥'} **${a} : ${b}** — ${stage} · [match →](${matchUrl(m.id)})`;
      }
      const when = m.date ? `${m.date}${m.time ? ` ${m.time}` : ''}` : 'time TBD';
      return `${status === 'live' ? '🔴 **LIVE now**' : `🕐 Upcoming (${when})`} — ${stage} · [match →](${matchUrl(m.id)})`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ ${team1.name} vs ${team2.name}`)
      .setDescription(
        `**Series: ${series1} – ${series2}** · Maps: ${maps1} – ${maps2}\n` +
        `-# Results shown from ${team1.name}'s side\n\n` +
        lines.join('\n').slice(0, 3500)
      )
      .setColor(0xff4655)
      .setFooter({ text: t.name });

    await interaction.editReply({ embeds: [embed] });
  },
};
