const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { tournamentUrl, deriveScore, effectiveStatus, computeRRStandings, textTable } = require('../tournament-utils');

// Round naming, mirroring the website (api/match-meta.ts roundLabel).
function roundName(idx, total, prefix) {
  const fromEnd = total - 1 - idx;
  const base = fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semi Finals' : fromEnd === 2 ? 'Quarter Finals' : `Round ${idx + 1}`;
  return prefix ? `${prefix} ${base}` : base;
}

const STATUS_ICON = { completed: '✅', live: '🔴', upcoming: '🕐' };

function matchLine(m) {
  const { s1, s2 } = deriveScore(m);
  const status = effectiveStatus(m);
  const score = status === 'upcoming' ? 'vs' : `${s1}:${s2}`;
  const when = m.date ? ` · ${m.date}${m.time ? ` ${m.time}` : ''}` : '';
  return `${STATUS_ICON[status]} ${m.team1Name || 'TBD'} **${score}** ${m.team2Name || 'TBD'}${when}`;
}

// Render one bracket into embed fields (round-robin gets a standings table).
function renderBracket(embed, label, bracket) {
  if (bracket.bracketType === 'roundrobin') {
    const standings = computeRRStandings(bracket.rounds ?? [], bracket.rrTeams ?? [], bracket.pointsPerWin);
    const rows = standings.map((r, i) => [i + 1, r.teamName.slice(0, 18), `${r.wins}-${r.losses}`, r.points]);
    embed.addFields({
      name: `${label} — Round Robin`,
      value: '```\n' + textTable(['#', 'Team', 'W-L', 'Pts'], rows).slice(0, 1000) + '\n```',
    });
    const matches = (bracket.rounds ?? []).flat();
    const pending = matches.filter((m) => effectiveStatus(m) !== 'completed').length;
    if (matches.length) {
      embed.addFields({ name: `${label} progress`, value: `${matches.length - pending}/${matches.length} matches played` });
    }
    return;
  }

  const rounds = (bracket.rounds ?? []).filter((r) => r.length > 0);
  const sectionOf = (r) => r[0]?.bracketSection ?? 'winners';
  const isDouble = rounds.flat().some((m) => m.bracketSection === 'losers');
  const winners = rounds.filter((r) => sectionOf(r) === 'winners');
  const losers = rounds.filter((r) => sectionOf(r) === 'losers');
  const finals = rounds.filter((r) => sectionOf(r) === 'grand-final');

  winners.forEach((round, i) => {
    embed.addFields({
      name: `${label} · ${roundName(i, winners.length, isDouble ? 'WB' : '')}`,
      value: round.map(matchLine).join('\n').slice(0, 1024) || '—',
    });
  });
  losers.forEach((round, i) => {
    embed.addFields({
      name: `${label} · ${roundName(i, losers.length, 'LB')}`,
      value: round.map(matchLine).join('\n').slice(0, 1024) || '—',
    });
  });
  for (const round of finals) {
    embed.addFields({ name: `${label} · Grand Final`, value: round.map(matchLine).join('\n').slice(0, 1024) || '—' });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bracket')
    .setDescription('Show the tournament bracket with current results'),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;

    const brackets = [];
    if (t.stage1Bracket) brackets.push({ label: t.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1', bracket: t.stage1Bracket });
    if (t.stage2Bracket) brackets.push({ label: 'Stage 2', bracket: t.stage2Bracket });
    if (t.generatedBracket) brackets.push({ label: 'Bracket', bracket: t.generatedBracket });
    if (t.knockoutBracket) brackets.push({ label: 'Knockout', bracket: t.knockoutBracket });

    if (brackets.length === 0) {
      await interaction.editReply(`**${t.name}** has no bracket yet. An organizer can generate one on the website (or \`/set-bracket\`, coming soon).`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🗂️ Bracket — ${t.name}`)
      .setURL(tournamentUrl(t.id))
      .setColor(0xff4655)
      .setFooter({ text: '✅ done · 🔴 live · 🕐 upcoming — full view on clutchgg.in' });

    for (const { label, bracket } of brackets) {
      renderBracket(embed, label, bracket);
      if (embed.data.fields?.length >= 24) break; // Discord max 25 fields
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
