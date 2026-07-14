// Full detail card for one match: maps, scores, MVP, stream and clips —
// everything the match page shows, in Discord form.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { numberedMatchList, deriveScore } = require('../write-utils');
const { matchUrl } = require('../tournament-utils');
const { matchMvp } = require('../mvp');

const STATUS_LABEL = { completed: '✅ Completed', live: '🔴 LIVE', upcoming: '🕐 Upcoming' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match-info')
    .setDescription('Everything about one match — maps, scores, MVP, stream, clips (no options = list)')
    .addIntegerOption((o) => o.setName('match').setDescription('Match number from the list this command shows').setMinValue(1)),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;
    const n = interaction.options.getInteger('match');

    const items = numberedMatchList(t);
    if (n == null) {
      if (!items.length) {
        await interaction.editReply('No matches in the bracket yet.');
        return;
      }
      const lines = items.map((it) => {
        const { s1, s2 } = deriveScore(it.match);
        const score = it.status === 'upcoming' ? 'vs' : `${s1}:${s2}`;
        return `**${it.n}.** ${it.match.team1Name} ${score} ${it.match.team2Name} — ${it.stage}`;
      });
      await interaction.editReply(`Which match? Re-run with \`match:<n>\`:\n${lines.join('\n').slice(0, 3800)}`);
      return;
    }

    const item = items.find((it) => it.n === n);
    if (!item) {
      await interaction.editReply(`❌ No match number ${n} — run \`/match-info\` without options to see the list.`);
      return;
    }
    const m = item.match;
    const { s1, s2 } = deriveScore(m);

    const embed = new EmbedBuilder()
      .setTitle(`${m.team1Name} ${item.status === 'upcoming' ? 'vs' : `${s1} : ${s2}`} ${m.team2Name}`)
      .setURL(matchUrl(m.id))
      .setColor(item.status === 'live' ? 0xe11d48 : item.status === 'completed' ? 0x22c55e : 0x00b0f4)
      .setFooter({ text: `${t.name} · ${item.stage}` });

    embed.addFields({ name: 'Status', value: STATUS_LABEL[item.status], inline: true });
    if (m.date) embed.addFields({ name: 'Scheduled', value: `${m.date}${m.time ? ` ${m.time}` : ''}`, inline: true });
    if (m.format) embed.addFields({ name: 'Format', value: m.format.toUpperCase(), inline: true });

    const maps = (m.maps ?? []).filter((mp) => mp.mapName || mp.team1Score || mp.team2Score);
    if (maps.length) {
      embed.addFields({
        name: 'Maps',
        value: maps.map((mp) => `**${mp.mapName || 'Map'}** — ${m.team1Name} ${mp.team1Score} : ${mp.team2Score} ${m.team2Name}`).join('\n').slice(0, 1024),
      });
    }

    const mvp = matchMvp(t, m);
    if (mvp) {
      embed.addFields({
        name: '⭐ Match MVP',
        value: `**${mvp.name}** (${mvp.teamName})${mvp.agent ? ` · ${mvp.agent}` : ''} — ${mvp.kills}/${mvp.deaths}/${mvp.assists}, ${mvp.acs} ACS`,
      });
    }
    if (m.streamUrl) embed.addFields({ name: '📺 Stream / VOD', value: m.streamUrl, inline: false });
    if (m.clips?.length) {
      embed.addFields({
        name: '🎬 Clips',
        value: m.clips.map((c) => `[${c.title}](${c.url})`).join('\n').slice(0, 1024),
      });
    }
    embed.addFields({ name: '🔗 Match page', value: matchUrl(m.id) });

    await interaction.editReply({ embeds: [embed] });
  },
};
