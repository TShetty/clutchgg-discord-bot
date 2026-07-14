// Turn the bot's automatic posts on/off per tournament: match reminders,
// result cards, and the end-of-day summary.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { upsertDiscordLink } = require('../supabase');

const KINDS = {
  reminders: '⏰ 15-minute match reminders',
  results: '🏆 Auto-posted result cards',
  daily: '🌙 End-of-day summary',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Turn automatic posts on/off (reminders, result cards, end-of-day summary)')
    .addStringOption((o) =>
      o.setName('kind').setDescription('Which automatic post to toggle').addChoices(
        { name: '15-minute match reminders', value: 'reminders' },
        { name: 'auto result cards', value: 'results' },
        { name: 'end-of-day summary', value: 'daily' },
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

    if (!kind || !state) {
      const lines = Object.entries(KINDS).map(
        ([k, label]) => `${label}: **${prefs[k] === false ? 'off' : 'on'}**`
      );
      const embed = new EmbedBuilder()
        .setTitle('🔔 Notification settings')
        .setDescription(`${lines.join('\n')}\n\nToggle one: \`/notifications kind:<...> state:<on|off>\``)
        .setColor(0x00b0f4);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    prefs[kind] = state === 'on';
    await upsertDiscordLink({ ...ctx.link, prefs });
    await interaction.editReply(`✅ ${KINDS[kind]} are now **${state}** for this tournament.`);
  },
};
