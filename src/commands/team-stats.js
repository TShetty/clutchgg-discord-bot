// Aggregate team stats — series and map record, round difference, current
// placement. All derived from the same blob data the website shows.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { realMatches, deriveScore, tournamentUrl } = require('../tournament-utils');
const { computePlacement } = require('../mvp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team-stats')
    .setDescription("A team's record — series & map wins, round diff, placement")
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

    const completed = realMatches(t).filter(
      ({ match: m, status }) => status === 'completed' && (m.team1Id === team.id || m.team2Id === team.id)
    );

    let seriesW = 0, seriesL = 0, mapW = 0, mapL = 0, roundsFor = 0, roundsAgainst = 0;
    for (const { match: m } of completed) {
      const isT1 = m.team1Id === team.id;
      const { s1, s2 } = deriveScore(m);
      const [mine, theirs] = isT1 ? [s1, s2] : [s2, s1];
      if (mine > theirs) seriesW++; else if (theirs > mine) seriesL++;
      mapW += mine;
      mapL += theirs;
      for (const mp of m.maps ?? []) {
        const [rf, ra] = isT1 ? [mp.team1Score ?? 0, mp.team2Score ?? 0] : [mp.team2Score ?? 0, mp.team1Score ?? 0];
        roundsFor += rf;
        roundsAgainst += ra;
      }
    }

    const played = seriesW + seriesL;
    const winRate = played > 0 ? Math.round((seriesW / played) * 100) : null;
    const placement = computePlacement(t, team.id);

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${team.name}`)
      .setURL(tournamentUrl(t.id))
      .setColor(0x00b0f4)
      .setFooter({ text: t.name });

    if (placement) embed.addFields({ name: 'Placement', value: placement, inline: true });
    embed.addFields(
      { name: 'Series', value: played ? `**${seriesW}–${seriesL}**${winRate !== null ? ` (${winRate}% win rate)` : ''}` : 'No completed matches yet', inline: true },
      { name: 'Maps', value: mapW + mapL > 0 ? `**${mapW}–${mapL}**` : '—', inline: true },
    );
    if (roundsFor + roundsAgainst > 0) {
      const diff = roundsFor - roundsAgainst;
      embed.addFields({
        name: 'Rounds',
        value: `${roundsFor} won · ${roundsAgainst} lost (${diff >= 0 ? '+' : ''}${diff})`,
        inline: true,
      });
    }

    const roster = (team.players ?? []).map((p) => `${p.name}${p.role ? ` (${p.role})` : ''}`).join(', ');
    if (roster) embed.addFields({ name: 'Roster', value: roster.slice(0, 1024) });

    await interaction.editReply({ embeds: [embed] });
  },
};
