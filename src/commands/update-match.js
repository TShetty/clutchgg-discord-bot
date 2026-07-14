// Update a match's schedule/broadcast details — date, time, format (bo1/3/5),
// stream link, highlight clips. Same fields as the website's match editor.
// Run without options to list matches that can be updated.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament, numberedMatchList, matchHasStats, replaceMatch } = require('../write-utils');
const { matchUrl } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-match')
    .setDescription('Set a match\'s date, time, format, stream link or clips (no options = list matches)')
    .addIntegerOption((o) => o.setName('match').setDescription('Match number from the list this command shows').setMinValue(1))
    .addStringOption((o) => o.setName('date').setDescription('Match date, YYYY-MM-DD'))
    .addStringOption((o) => o.setName('time').setDescription('Start time, 24h HH:MM (e.g. 18:30)'))
    .addStringOption((o) =>
      o.setName('format').setDescription('Series format').addChoices(
        { name: 'best of 1', value: 'bo1' },
        { name: 'best of 3', value: 'bo3' },
        { name: 'best of 5', value: 'bo5' },
      )
    )
    .addStringOption((o) => o.setName('stream').setDescription('Live stream / VOD YouTube link'))
    .addStringOption((o) => o.setName('clip_title').setDescription('Title for a highlight clip to add (needs clip_url too)'))
    .addStringOption((o) => o.setName('clip_url').setDescription('YouTube link of the highlight clip')),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const matchNo = interaction.options.getInteger('match');

    // List mode: matches still awaiting play (not completed).
    if (matchNo == null) {
      const items = numberedMatchList(ctx.tournament, (it) => it.status !== 'completed');
      if (items.length === 0) {
        await interaction.editReply('All matches are completed — nothing to schedule. Use `/finish-match` for results.');
        return;
      }
      const lines = items.map((it) =>
        `**${it.n}.** ${it.match.team1Name} vs ${it.match.team2Name} — ${it.stage}` +
        `${it.match.date ? ` · ${it.match.date}${it.match.time ? ` ${it.match.time}` : ''}` : ' · unscheduled'}` +
        `${it.match.format ? ` · ${it.match.format.toUpperCase()}` : ''}`
      );
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Matches you can update')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(0x00b0f4)
        .setFooter({ text: 'Update one: /update-match match:<n> date:2026-08-01 time:18:30 format:bo3 stream:<url>' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const date = interaction.options.getString('date');
    const time = interaction.options.getString('time');
    const format = interaction.options.getString('format');
    const stream = interaction.options.getString('stream');
    const clipTitle = interaction.options.getString('clip_title');
    const clipUrl = interaction.options.getString('clip_url');

    if ([date, time, format, stream, clipTitle, clipUrl].every((v) => v == null)) {
      await interaction.editReply('Nothing to update — provide at least one of: date, time, format, stream, clip_title+clip_url.');
      return;
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await interaction.editReply('❌ `date` must be YYYY-MM-DD.');
      return;
    }
    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      await interaction.editReply('❌ `time` must be 24h HH:MM (e.g. `18:30`).');
      return;
    }
    if ((clipTitle && !clipUrl) || (clipUrl && !clipTitle)) {
      await interaction.editReply('❌ To add a clip provide BOTH `clip_title` and `clip_url`.');
      return;
    }

    let failMsg = null;
    let summary = null;
    let matchId = null;
    await saveTournament(ctx.tournamentId, (t) => {
      const items = numberedMatchList(t, (it) => it.status !== 'completed');
      const item = items.find((it) => it.n === matchNo);
      if (!item) { failMsg = `Match ${matchNo} isn't in the updatable list — run \`/update-match\` with no options to see it.`; return t; }
      const m = { ...item.match };

      const changes = [];
      if (date) { m.date = date; changes.push(`date → ${date}`); }
      if (time) { m.time = time; changes.push(`time → ${time}`); }
      if (format) {
        if (matchHasStats(m)) { failMsg = 'This match has pulled stats — its format is locked (website rule). Date/time/stream are still editable.'; return t; }
        m.format = format;
        changes.push(`format → ${format.toUpperCase()}`);
      }
      if (stream) { m.streamUrl = stream; changes.push('stream link set'); }
      if (clipTitle && clipUrl) {
        m.clips = m.clips ?? [];
        m.clips.push({ id: `clip-${Date.now()}`, title: clipTitle, url: clipUrl });
        changes.push(`clip added: ${clipTitle}`);
      }

      matchId = m.id;
      summary = `**${m.team1Name} vs ${m.team2Name}** (${item.stage})\n${changes.map((c) => `• ${c}`).join('\n')}`;
      return replaceMatch(t, m);
    });

    if (failMsg) await interaction.editReply(`❌ ${failMsg}`);
    else {
      const embed = new EmbedBuilder()
        .setTitle('✅ Match updated')
        .setDescription(summary)
        .setURL(matchUrl(matchId))
        .setColor(0x22c55e)
        .setFooter({ text: 'Live on clutchgg.in' });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
