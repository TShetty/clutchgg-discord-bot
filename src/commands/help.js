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
    name: '⚙️ Tournament setup (organizers)',
    lines: [
      '`/set-details` — edit description, dates, prize pool, max teams, status',
      '`/import-teams` — import teams from .xlsx (run without a file to get the template)',
      '`/update-roster` — add/rename/remove teams & players, set Riot IDs and roles',
      '`/set-bracket` — generate the bracket: single/double elimination or round robin',
      '`/assign-slot` — place teams into bracket slots (no options = list open slots)',
      '`/lock-tournament` — freeze all bot changes once setup is complete',
    ],
  },
  {
    name: '🎮 Running matches (organizers)',
    lines: [
      '`/update-match` — set date, time, bo1/bo3/bo5, stream link, clips',
      '`/finish-match` — record a result; the score is validated against clutchgg.in data',
      '`/post` — publish upcoming matches / standings / top players / a result card to your tournament channel',
      '`/report-issue` — flag wrong stats on the website to ClutchGG admins',
    ],
  },
  {
    name: '🔧 Superadmin',
    lines: [
      '`/link-tournament` — connect a ClutchGG tournament to this server: organizers + posting channels',
    ],
  },
  {
    name: '🚧 Coming soon',
    lines: [
      'Automatic 15-minute match reminders, auto-posted result cards with MVP callouts, end-of-day standings.',
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
