// Create a mentionable Discord role for every registered team so the bot's
// 15-minute reminders can tag the right players (reminderCard looks up roles
// by team name). Skips roles that already exist. Organizer-only.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireLinkedTournament } = require('../context');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('create-team-roles')
    .setDescription('Create a mentionable role per team so match reminders can tag them'),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    if (!ctx.isOrganizer) {
      await interaction.editReply('⛔ Only organizers can create team roles.');
      return;
    }

    const teams = (ctx.tournament.teams ?? []).filter((tm) => tm.name?.trim());
    if (!teams.length) {
      await interaction.editReply('No teams registered yet — import them first with `/import-teams`.');
      return;
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply(
        '❌ I don\'t have the **Manage Roles** permission in this server. ' +
        'Grant it to the bot\'s role in Server Settings → Roles, then run this again.'
      );
      return;
    }

    const existing = await interaction.guild.roles.fetch();
    const created = [];
    const skipped = [];
    const failed = [];
    for (const team of teams) {
      const name = team.name.trim();
      if (existing.find((r) => r.name.toLowerCase() === name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      try {
        await interaction.guild.roles.create({
          name,
          mentionable: true,
          reason: `ClutchGG team role for ${ctx.tournament.name}`,
        });
        created.push(name);
      } catch (e) {
        failed.push(`${name} (${e.message})`);
      }
    }

    const lines = [];
    if (created.length) lines.push(`✅ Created **${created.length}** role${created.length === 1 ? '' : 's'}: ${created.join(', ')}`);
    if (skipped.length) lines.push(`⏭️ Already existed: ${skipped.join(', ')}`);
    if (failed.length) lines.push(`❌ Failed: ${failed.join(', ')}`);
    lines.push(
      '\nNext: assign each role to that team\'s players (Server Settings → Members, or right-click a member → Roles). ' +
      'Match reminders will then tag the two teams playing.'
    );
    await interaction.editReply(lines.join('\n').slice(0, 3900));
  },
};
