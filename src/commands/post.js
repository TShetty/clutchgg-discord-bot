// Post a public announcement embed to one of the tournament's configured
// channels (set in /link-tournament): upcoming matches, standings, top
// players, or a finished match's result card.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, numberedMatchList, deriveScore } = require('../write-utils');
const { matchUrl, tournamentUrl, computeRRStandings, textTable, aggregatePlayerStats, realMatches } = require('../tournament-utils');

function upcomingEmbed(t) {
  const items = realMatches(t)
    .filter(({ status }) => status === 'upcoming')
    .sort((a, b) => `${a.match.date ?? '9999'}T${a.match.time ?? ''}`.localeCompare(`${b.match.date ?? '9999'}T${b.match.time ?? ''}`))
    .slice(0, 10);
  if (items.length === 0) return null;
  const lines = items.map(({ stage, match: m }) =>
    `[**${m.team1Name}** vs **${m.team2Name}**](${matchUrl(m.id)})\n└ ${stage} · ${m.date ? `${m.date}${m.time ? ` ${m.time}` : ''}` : 'TBD'}${m.format ? ` · ${m.format.toUpperCase()}` : ''}`
  );
  return new EmbedBuilder()
    .setTitle(`🗓️ Upcoming matches — ${t.name}`)
    .setDescription(lines.join('\n\n').slice(0, 4000))
    .setURL(tournamentUrl(t.id))
    .setColor(0x00b0f4)
    .setFooter({ text: 'Follow every match live on clutchgg.in' });
}

function standingsEmbed(t) {
  const rr = t.stage1Bracket?.bracketType === 'roundrobin' ? t.stage1Bracket
    : t.generatedBracket?.bracketType === 'roundrobin' ? t.generatedBracket : null;
  if (!rr) return null;
  const rows = computeRRStandings(rr.rounds ?? [], rr.rrTeams ?? [], rr.pointsPerWin);
  if (!rows.length) return null;
  const table = textTable(
    ['#', 'Team', 'P', 'W', 'L', 'Pts'],
    rows.map((r, i) => [i + 1, r.teamName.slice(0, 18), r.played, r.wins, r.losses, r.points])
  );
  return new EmbedBuilder()
    .setTitle(`📊 Standings — ${t.name}`)
    .setDescription('```\n' + table.slice(0, 4000) + '\n```')
    .setURL(tournamentUrl(t.id))
    .setColor(0x00b0f4);
}

function topPlayersEmbed(t) {
  const rows = aggregatePlayerStats(t).filter((r) => r.maps > 0).sort((a, b) => b.acs - a.acs).slice(0, 10);
  if (!rows.length) return null;
  const table = textTable(
    ['#', 'Player', 'Team', 'ACS', 'K', 'D', 'A'],
    rows.map((r, i) => [i + 1, r.playerName.slice(0, 16), (r.teamName || '—').slice(0, 12), r.acs, r.kills, r.deaths, r.assists])
  );
  return new EmbedBuilder()
    .setTitle(`🎯 Top players — ${t.name}`)
    .setDescription('```\n' + table.slice(0, 4000) + '\n```')
    .setURL(tournamentUrl(t.id))
    .setColor(0xff4655);
}

function resultEmbed(t, item) {
  const m = item.match;
  const { s1, s2 } = deriveScore(m);
  const winnerName = s1 > s2 ? m.team1Name : m.team2Name;
  return new EmbedBuilder()
    .setTitle(`🏆 ${m.team1Name} ${s1} : ${s2} ${m.team2Name}`)
    .setDescription(`**${winnerName}** takes the ${item.stage} match!\n[Full stats, maps and round-by-round →](${matchUrl(m.id)})`)
    .setURL(matchUrl(m.id))
    .setColor(0x22c55e)
    .setFooter({ text: t.name });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post an announcement to the tournament channel (upcoming matches, standings, result…)')
    .addStringOption((o) =>
      o.setName('what').setDescription('What to post').setRequired(true).addChoices(
        { name: 'upcoming matches', value: 'upcoming' },
        { name: 'standings table', value: 'standings' },
        { name: 'top players', value: 'top-players' },
        { name: 'match result (needs match number)', value: 'result' },
      )
    )
    .addIntegerOption((o) => o.setName('match').setDescription('For "match result": the completed match number (see /matches show:completed)').setMinValue(1))
    .addStringOption((o) =>
      o.setName('channel').setDescription('Which configured channel (default: announce)').addChoices(
        { name: 'announce', value: 'announce' },
        { name: 'schedule', value: 'schedule' },
        { name: 'results', value: 'results' },
      )
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const t = ctx.tournament;
    const what = interaction.options.getString('what');
    const channelKey = interaction.options.getString('channel') ?? (what === 'result' ? 'results' : what === 'upcoming' ? 'schedule' : 'announce');

    const channelId = ctx.link.channels?.[channelKey] ?? ctx.link.channels?.announce;
    if (!channelId) {
      await interaction.editReply('❌ No channel configured — a superadmin sets channels via `/link-tournament`.');
      return;
    }

    let embed = null;
    if (what === 'upcoming') embed = upcomingEmbed(t);
    else if (what === 'standings') embed = standingsEmbed(t);
    else if (what === 'top-players') embed = topPlayersEmbed(t);
    else if (what === 'result') {
      const n = interaction.options.getInteger('match');
      if (n == null) {
        const done = numberedMatchList(t, (it) => it.status === 'completed');
        const lines = done.map((it) => {
          const { s1, s2 } = deriveScore(it.match);
          return `**${it.n}.** ${it.match.team1Name} ${s1}:${s2} ${it.match.team2Name} — ${it.stage}`;
        });
        await interaction.editReply(
          lines.length
            ? `Which result? Re-run with \`match:<n>\`:\n${lines.join('\n').slice(0, 3800)}`
            : 'No completed matches to post yet.'
        );
        return;
      }
      const done = numberedMatchList(t, (it) => it.status === 'completed');
      const item = done.find((it) => it.n === n);
      if (!item) {
        await interaction.editReply(`❌ Match ${n} isn't a completed match — run \`/post what:result\` (no match) to see the list.`);
        return;
      }
      embed = resultEmbed(t, item);
    }

    if (!embed) {
      await interaction.editReply(`Nothing to post yet for **${what}** (no data).`);
      return;
    }

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      await interaction.editReply(`❌ Can't access <#${channelId}> — check the bot has permission to view and send messages there.`);
      return;
    }
    await channel.send({ embeds: [embed] });
    await interaction.editReply(`✅ Posted to <#${channelId}>.`);
  },
};
