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
      '`/match-info match:<n>` — one match in full: maps, MVP, stream, clips',
      '`/next-match team:<name>` — a team\'s next match + recent form',
      '`/standings` — round robin / group stage points table',
      '`/top-players by:<acs|kd|kills>` — tournament stat leaders',
      '`/mvp` — the tournament MVP race (same scoring as the website)',
      '`/player name:<player>` — a player\'s card: team, role, stats, profile link',
      '`/compare player1:<a> player2:<b>` — two players\' stats side by side',
      '`/team-stats team:<name>` — a team\'s series/map record, round diff, placement',
      '`/head-to-head team1:<a> team2:<b>` — past meetings between two teams',
      '`/clips` — a match\'s highlight clips',
      '`/match-card match:<n>` — post the shareable match card image',
    ],
  },
  {
    name: '⚙️ Tournament setup (organizers)',
    lines: [
      '`/setup` — **guided setup wizard**: details form, bracket picker and click-to-seed slots — start here',
      '`/set-details` — edit description, dates, prize pool, max teams, status',
      '`/import-teams` — import teams from .xlsx (run without a file to get the template)',
      '`/update-roster` — add/rename/remove teams & players, set Riot IDs and roles',
      '`/set-bracket` — generate the bracket: single/double elimination or round robin',
      '`/assign-slot` — place teams into bracket slots (no options = list open slots)',
      '`/lock-tournament` — freeze all bot changes once setup is complete',
      '`/create-team-roles` — create a mentionable role per team so reminders can tag them',
    ],
  },
  {
    name: '🎮 Running matches (organizers)',
    lines: [
      '`/update-match` — set date, time, bo1/bo3/bo5, stream link, clips',
      '`/finish-match` — record a result; the score is validated against clutchgg.in data',
      '`/post` — publish upcoming matches / standings / top players / a result card to your tournament channel',
      '`/notifications` — turn each automatic post on/off (reminders, live, results, daily) — or everything at once',
      '`/report-issue` — flag wrong stats on the website to ClutchGG admins',
      '`/organizers` — list/add/remove who can run organizer commands',
      '`/use-tournament` — switch the active tournament when this server hosts several',
    ],
  },
  {
    name: '🚀 Getting started (new organizers)',
    lines: [
      '`/claim-tournament` — link YOUR server using the one-time claim code ClutchGG sent you. You become the organizer; then follow the posted setup guide.',
    ],
  },
  {
    name: '🤖 Automatic (no command needed)',
    lines: [
      '⏰ Reminder 15 minutes before each scheduled match (tags team roles if they exist)',
      '🔴 Live announcement with the stream link the moment a match starts',
      '🏆 Result card the moment a match finishes on clutchgg.in — score, MVP + stats, match link',
      '🌙 End-of-day summary with standings once all of a day\'s matches are done',
    ],
  },
  {
    name: '🔧 Superadmin',
    lines: [
      '`/link-tournament` — manually connect a tournament to a server (organizers + channels)',
      '`/generate-claim-code` — issue a one-time code so an organizer can self-link their server',
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
