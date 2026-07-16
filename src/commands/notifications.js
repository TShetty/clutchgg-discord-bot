// Turn the bot's automatic posts on/off per tournament — each kind
// individually, or all of them at once. Most kinds default ON; auto-finish is
// opt-in (defaults OFF) because it writes results without a human in the loop.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { upsertDiscordLink } = require('../supabase');

// key → { label, defaultOn }
const KINDS = {
  reminders: { label: '⏰ 15-minute match reminders', defaultOn: true },
  live: { label: '🔴 Live-match announcements (when a match starts)', defaultOn: true },
  results: { label: '🏆 Auto-posted result cards', defaultOn: true },
  morning: { label: '☀️ Morning "today\'s matches" post', defaultOn: true },
  daily: { label: '🌙 End-of-day summary', defaultOn: true },
  nudges: { label: '👋 Organizer DM when a match is 3h+ past start with no result', defaultOn: true },
  autofinish: { label: '🤖 Auto-record winners when clutchgg.in map data decides a match', defaultOn: false },
};

const isOn = (prefs, k) => (prefs[k] === undefined ? KINDS[k].defaultOn : prefs[k] === true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Turn automatic posts on/off — reminders, live, results, daily posts, nudges, auto-finish')
    .addStringOption((o) =>
      o.setName('kind').setDescription('Which automatic post to toggle (or everything at once)').addChoices(
        { name: '15-minute match reminders', value: 'reminders' },
        { name: 'live-match announcements', value: 'live' },
        { name: 'auto result cards', value: 'results' },
        { name: 'morning schedule post', value: 'morning' },
        { name: 'end-of-day summary', value: 'daily' },
        { name: 'unfinished-match DM nudges', value: 'nudges' },
        { name: 'auto-finish decided matches', value: 'autofinish' },
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
        ([k, meta]) => `${meta.label}: **${isOn(prefs, k) ? 'on' : 'off'}**${!meta.defaultOn && prefs[k] === undefined ? ' (opt-in)' : ''}`
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
        Object.values(KINDS).map((meta) => meta.label).join('\n')
      );
      return;
    }

    prefs[kind] = on;
    await upsertDiscordLink({ ...ctx.link, prefs });
    const extra = kind === 'autofinish' && on
      ? '\n-# The bot will record the winner and advance the bracket the moment the website\'s map data decides a match — same validation as /finish-match, no typing needed.'
      : '';
    await interaction.editReply(`✅ ${KINDS[kind].label} is now **${state}** for this tournament.${extra}`);
  },
};
