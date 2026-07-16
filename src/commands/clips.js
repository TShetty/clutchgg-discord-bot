// A match's clips (highlights added by the organizer on the website).
// No options → lists only the matches that actually have clips.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { numberedMatchList, deriveScore } = require('../write-utils');
const { matchUrl } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clips')
    .setDescription("A match's highlight clips (no options = list matches that have clips)")
    .addIntegerOption((o) => o.setName('match').setDescription('Match number from the list this command shows').setMinValue(1)),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;
    const n = interaction.options.getInteger('match');

    const items = numberedMatchList(t);

    if (n == null) {
      const withClips = items.filter((it) => it.match.clips?.length);
      if (!withClips.length) {
        await interaction.editReply('No matches have clips yet. Organizers add clips with `/update-match`.');
        return;
      }
      const lines = withClips.map((it) => {
        const { s1, s2 } = deriveScore(it.match);
        const score = it.status === 'upcoming' ? 'vs' : `${s1}:${s2}`;
        return `**${it.n}.** ${it.match.team1Name} ${score} ${it.match.team2Name} — ${it.match.clips.length} clip${it.match.clips.length === 1 ? '' : 's'}`;
      });
      await interaction.editReply(`Matches with clips — re-run with \`match:<n>\`:\n${lines.join('\n').slice(0, 3800)}`);
      return;
    }

    const item = items.find((it) => it.n === n);
    if (!item) {
      await interaction.editReply(`❌ No match number ${n} — run \`/clips\` without options to see the list.`);
      return;
    }
    const m = item.match;
    if (!m.clips?.length) {
      await interaction.editReply(`**${m.team1Name} vs ${m.team2Name}** has no clips yet. Organizers add them with \`/update-match\`.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎬 Clips — ${m.team1Name} vs ${m.team2Name}`)
      .setURL(matchUrl(m.id))
      .setDescription(m.clips.map((c) => `▶️ [${c.title}](${c.url})`).join('\n').slice(0, 3800))
      .setColor(0xff4655)
      .setFooter({ text: `${t.name} · ${item.stage}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
