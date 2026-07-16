// Record a match result — ALWAYS validated against the website's data
// (Rule 4 in INSTRUCTIONS.md): when map scores exist on clutchgg.in, the
// organizer's claimed score must match them exactly; the website wins.
// Run without options to list matches awaiting a result.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament, numberedMatchList, replaceMatch, propagateWinner, deriveScore } = require('../write-utils');
const { isMatchDecidedByMaps, matchUrl } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('finish-match')
    .setDescription('Record a match result — validated against clutchgg.in data (no options = list pending)')
    .addIntegerOption((o) => o.setName('match').setDescription('Match number from the pending list this command shows').setMinValue(1))
    .addStringOption((o) => o.setName('score').setDescription('Series score, first team first — e.g. 2-1 means team 1 won 2 maps to 1'))
    .addBooleanOption((o) =>
      o.setName('no_stats_override').setDescription('Allow finishing a match that has NO map data on the website yet (use with care)')
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const matchNo = interaction.options.getInteger('match');
    const scoreRaw = interaction.options.getString('score');

    // Pending = both teams real, no winner recorded yet.
    const pendingFilter = (it) => !it.match.winner && it.status !== 'upcoming';

    if (matchNo == null || !scoreRaw) {
      const items = numberedMatchList(ctx.tournament, pendingFilter);
      if (items.length === 0) {
        await interaction.editReply('No matches are awaiting a result. (Only live/played matches without a recorded winner appear here.)');
        return;
      }
      const lines = items.map((it) => {
        const { s1, s2 } = deriveScore(it.match);
        const site = isMatchDecidedByMaps(it.match) ? ` · website shows ${s1}:${s2}` : ' · no map data on website yet';
        return `**${it.n}.** ${it.match.team1Name} vs ${it.match.team2Name} — ${it.stage}${site}`;
      });
      const embed = new EmbedBuilder()
        .setTitle('🏁 Matches awaiting a result')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(0x00b0f4)
        .setFooter({ text: 'Finish one: /finish-match match:<n> score:2-1 (first team\'s maps first)' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const sm = scoreRaw.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!sm) {
      await interaction.editReply('❌ `score` must look like `2-1` or `2:1` (first team\'s map wins first).');
      return;
    }
    const claimed = { s1: parseInt(sm[1], 10), s2: parseInt(sm[2], 10) };
    if (claimed.s1 === claimed.s2) {
      await interaction.editReply('❌ A series can\'t end in a draw — one team must have more map wins.');
      return;
    }
    const override = interaction.options.getBoolean('no_stats_override') ?? false;

    let failMsg = null;
    let summary = null;
    let matchId = null;
    await saveTournament(ctx.tournamentId, (t) => {
      const items = numberedMatchList(t, pendingFilter);
      const item = items.find((it) => it.n === matchNo);
      if (!item) { failMsg = `Match ${matchNo} isn't awaiting a result — run \`/finish-match\` with no options to see the list.`; return t; }
      const m = { ...item.match };

      const site = deriveScore(m);
      const hasMapData = (m.maps ?? []).length > 0;

      // Rule 4: website data always wins.
      if (hasMapData) {
        if (!isMatchDecidedByMaps(m)) {
          failMsg =
            `The website's map data for **${m.team1Name} vs ${m.team2Name}** currently shows **${site.s1}:${site.s2}** — the series isn't decided yet. ` +
            'Pull/enter the remaining map results on the website first, then finish the match.';
          return t;
        }
        if (site.s1 !== claimed.s1 || site.s2 !== claimed.s2) {
          failMsg =
            `Score mismatch — you said **${claimed.s1}:${claimed.s2}**, but clutchgg.in has **${site.s1}:${site.s2}** for ` +
            `**${m.team1Name} vs ${m.team2Name}**. Please double-check the score. The website's data is the source of truth; ` +
            'if the website is wrong, fix the map results there (or `/report-issue`).';
          return t;
        }
      } else if (!override) {
        failMsg =
          `**${m.team1Name} vs ${m.team2Name}** has no map data on the website yet, so there's nothing to validate your score against. ` +
          'Either enter the map results on the website first (recommended — keeps stats), or re-run with `no_stats_override:true` to record just the series winner.';
        return t;
      }

      m.winner = claimed.s1 > claimed.s2 ? m.team1Id : m.team2Id;
      matchId = m.id;

      let updated = replaceMatch(t, m);
      propagateWinner(updated, m);

      const winnerName = claimed.s1 > claimed.s2 ? m.team1Name : m.team2Name;
      summary =
        `**${m.team1Name} ${claimed.s1} : ${claimed.s2} ${m.team2Name}** — ${item.stage}\n` +
        `🏆 Winner: **${winnerName}**${hasMapData ? ' (validated against website map data ✅)' : ' (recorded without map data ⚠️)'}\n` +
        'Bracket advanced automatically.';
      return updated;
    });

    if (failMsg) await interaction.editReply(`❌ ${failMsg}`);
    else {
      const embed = new EmbedBuilder()
        .setTitle('✅ Match finished')
        .setDescription(summary)
        .setURL(matchUrl(matchId))
        .setColor(0x22c55e)
        .setFooter({ text: 'View: /bracket · share the result: /post' });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
