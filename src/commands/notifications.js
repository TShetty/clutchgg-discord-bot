// Turn the bot's automatic posts on/off per tournament — each kind
// individually, or all of them at once: match reminders, live announcements,
// result cards, and the end-of-day summary.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { upsertDiscordLink } = require('../supabase');

const KINDS = {
  reminders: '⏰ 15-minute match reminders',
  live: '🔴 Live-match announcements (when a match starts)',
  results: '🏆 Auto-posted result cards',
  daily: '🌙 End-of-day summary',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Turn automatic posts on/off — reminders, live announcements, result cards, daily summary')
    .addStringOption((o) =>
      o.setName('kind').setDescription('Which automatic post to toggle (or everything at once)').addChoices(
        { name: '15-minute match reminders', value: 'reminders' },
        { name: 'live-match announcements', value: 'live' },
        { name: 'auto result cards', value: 'results' },
        { name: 'end-of-day summary', value: 'daily' },
        { name: 'everything (all of the above)', value: 'all' },
      )
    )
    .addStringOption((o) =>
      o.setName('state').setDescription('on or off').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    if (!ctx.isOrganizer) {
      await interaction.editReply('⛔ Only organizers can change notification settings.');
      return;
    }

    const kind = interaction.options.getString('kind');
    const state = interaction.options.getString('state');
    const prefs = { ...(ctx.link.prefs ?? {}) };

    // No kind+state → show current settings and how to change them.
    if (!kind || !state) {
      const lines = Object.entries(KINDS).map(
        ([k, label]) => `${label}: **${prefs[k] === false ? 'off' : 'on'}**`
      );
      const embed = new EmbedBuilder()
        .setTitle('🔔 Notification settings')
        .setDescription(
          `${lines.join('\n')}\n\n` +
          'Toggle one: `/notifications kind:<...> state:<on|off>`\n' +
          'Toggle all: `/notifications kind:everything state:<on|off>`'
        )
        .setColor(0x00b0f4);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const on = state === 'on';
    if (kind === 'all') {
      for (const k of Object.keys(KINDS)) prefs[k] = on;
      await upsertDiscordLink({ ...ctx.link, prefs });
      await interaction.editReply(
        `✅ **All** automatic posts are now **${state}** for this tournament:\n` +
        Object.values(KINDS).map((label) => `${label}`).join('\n')
      );
      return;
    }

    prefs[kind] = on;
    await upsertDiscordLink({ ...ctx.link, prefs });
    await interaction.editReply(`✅ ${KINDS[kind]} are now **${state}** for this tournament.`);
  },
};
