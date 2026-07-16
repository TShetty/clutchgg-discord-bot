// Post the generated head-to-head match card image (the same 1200×630 card
// crawlers get via /api/og/match) as a shareable embed, on demand.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { numberedMatchList, deriveScore } = require('../write-utils');
const { matchUrl, SITE } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match-card')
    .setDescription('Post the shareable match card image (no options = list matches)')
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
      await interaction.editReply(`❌ No match number ${n} — run \`/match-card\` without options to see the list.`);
      return;
    }
    const m = item.match;
    const { s1, s2 } = deriveScore(m);

    const embed = new EmbedBuilder()
      .setTitle(`${m.team1Name} ${item.status === 'upcoming' ? 'vs' : `${s1} : ${s2}`} ${m.team2Name}`)
      .setURL(matchUrl(m.id))
      .setImage(`${SITE}/api/og/match?id=${encodeURIComponent(m.id)}`)
      .setColor(0xff4655)
      .setFooter({ text: `${t.name} · ${item.stage}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
