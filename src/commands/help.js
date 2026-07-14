const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Grouped command reference. Update when commands are added (Rule 2 in
// INSTRUCTIONS.md: every command must be discoverable and self-explanatory).
const SECTIONS = [
  {
    name: '📋 Tournament info (anyone can use)',
    lines: [
      '`/tournament` — details: dates, prize pool, format, status',
      '`/teams` — all registered teams',
      '`/roster team:<name>` — a team\'s players, Riot IDs and roles',
      '`/bracket` — the bracket with current results',
      '`/matches show:<upcoming|live|today|completed>` — match list with website links',
      '`/standings` — round robin / group stage points table',
      '`/top-players by:<acs|kd|kills>` — tournament stat leaders',
    ],
  },
  {
    name: '🔧 Setup (superadmin)',
    lines: [
      '`/link-tournament` — connect a ClutchGG tournament to this server: who the organizers are and where the bot posts',
    ],
  },
  {
    name: '🚧 Coming soon (organizers)',
    lines: [
      'Tournament setup, team import (.xlsx), roster edits, bracket generation, match updates, finishing matches with score validation, posting results & standings to your channels, automatic match reminders and result announcements.',
    ],
  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What this bot does and how to use every command'),
  ephemeral: true,
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 ClutchGG Tournament Bot')
      .setDescription(
        'Run your ClutchGG tournament from Discord — look up teams, brackets, matches and stats without opening the admin portal. Data always matches clutchgg.in.'
      )
      .setColor(0xff4655);
    for (const s of SECTIONS) {
      embed.addFields({ name: s.name, value: s.lines.join('\n') });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
