// "When do we play next?" — a team's next scheduled match plus recent form
// (the same W/L form dots the website shows, via teamForm in
// tournamentDerive.ts).
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { realMatches, deriveScore, matchUrl } = require('../tournament-utils');

// tournamentDerive.ts teamForm port: last N completed series for one team.
function teamForm(matches, teamId, n = 3) {
  const out = [];
  for (const { match: m, status } of matches) {
    if (status !== 'completed') continue;
    const isT1 = m.team1Id === teamId;
    const isT2 = m.team2Id === teamId;
    if (!isT1 && !isT2) continue;
    const { s1, s2 } = deriveScore(m);
    if (s1 === s2) continue;
    out.push({ won: isT1 ? s1 > s2 : s2 > s1, opponent: isT1 ? m.team2Name : m.team1Name });
  }
  return out.slice(-n);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('next-match')
    .setDescription("A team's next match and recent form")
    .addStringOption((o) => o.setName('team').setDescription('Team name (partial match works)').setRequired(true)),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const q = interaction.options.getString('team').trim().toLowerCase();
    const team = (t.teams ?? []).find((tm) => tm.name.toLowerCase() === q)
      || (t.teams ?? []).find((tm) => tm.name.toLowerCase().includes(q));
    if (!team) {
      const names = (t.teams ?? []).map((tm) => `• ${tm.name}`).join('\n') || '(no teams)';
      await interaction.editReply(`❌ No team matching **${q}**. Teams:\n${names}`);
      return;
    }

    const items = realMatches(t);
    const teamMatches = items.filter(({ match: m }) => m.team1Id === team.id || m.team2Id === team.id);
    const next = teamMatches
      .filter(({ status }) => status !== 'completed')
      .sort((a, b) => `${a.match.date ?? '9999'}T${a.match.time ?? ''}`.localeCompare(`${b.match.date ?? '9999'}T${b.match.time ?? ''}`))[0];

    const embed = new EmbedBuilder().setTitle(`📅 ${team.name}`).setColor(0x00b0f4).setFooter({ text: t.name });

    if (next) {
      const m = next.match;
      const opponent = m.team1Id === team.id ? m.team2Name : m.team1Name;
      embed.setDescription(
        `**Next up: vs ${opponent}**\n` +
        `${next.stage} · ${m.date ? `${m.date}${m.time ? ` ${m.time}` : ''}` : 'time TBD'}${m.format ? ` · ${m.format.toUpperCase()}` : ''}` +
        `${next.status === 'live' ? '\n🔴 **This match is LIVE right now!**' : ''}\n` +
        `${m.streamUrl ? `📺 [Stream](${m.streamUrl}) · ` : ''}[Match page →](${matchUrl(m.id)})`
      );
    } else {
      embed.setDescription(`No upcoming matches scheduled for **${team.name}**.`);
    }

    const form = teamForm(teamMatches, team.id, 5);
    if (form.length) {
      embed.addFields({
        name: 'Recent form',
        value: form.map((f) => `${f.won ? '🟩 W' : '🟥 L'} vs ${f.opponent}`).join('\n'),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
