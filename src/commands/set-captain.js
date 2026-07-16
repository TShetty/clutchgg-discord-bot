// Link a Discord user to a team as its captain — for Excel-imported teams
// (which have no captain) or when a captain joins the server after their team
// was registered. Also hands them the team role if it exists (or creates it).
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireOrganizer, saveTournament } = require('../write-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-captain')
    .setDescription('Assign a Discord user as a team\'s captain (and give them the team role)')
    .addStringOption((o) => o.setName('team').setDescription('Team name (partial match works)').setRequired(true))
    .addUserOption((o) => o.setName('user').setDescription('The Discord member who captains this team').setRequired(true)),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const q = interaction.options.getString('team').trim().toLowerCase();
    const user = interaction.options.getUser('user');

    let teamName = null;
    let failMsg = null;
    await saveTournament(ctx.tournamentId, (t) => {
      const team = (t.teams ?? []).find((tm) => tm.name.toLowerCase() === q)
        ?? (t.teams ?? []).find((tm) => tm.name.toLowerCase().includes(q));
      if (!team) {
        failMsg = `No team matching **${q}** — check \`/teams\`.`;
        return t;
      }
      team.captainDiscordId = user.id;
      teamName = team.name;
      return t;
    });
    if (failMsg) {
      await interaction.editReply(`❌ ${failMsg}`);
      return;
    }

    // Hand over (or create) the team role so reminders ping them.
    let roleNote = '';
    try {
      if (interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        const roles = await interaction.guild.roles.fetch();
        let role = roles.find((r) => r.name.toLowerCase() === teamName.toLowerCase() && !r.managed);
        if (!role) role = await interaction.guild.roles.create({ name: teamName, mentionable: true, reason: 'ClutchGG team captain assigned' });
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member) { await member.roles.add(role); roleNote = `\nThey've been given the ${role} role.`; }
      } else {
        roleNote = '\n(No Manage Roles permission — the team role couldn\'t be assigned.)';
      }
    } catch (e) {
      console.error('[SET-CAPTAIN] role step failed:', e.message);
    }

    await interaction.editReply(`✅ <@${user.id}> is now the captain of **${teamName}**.${roleNote}`);
  },
};
