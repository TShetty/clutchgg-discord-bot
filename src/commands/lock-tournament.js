// Lock the tournament against further bot changes. Only allowed once setup is
// actually complete: details + teams + bracket + initial matchups all exist.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { upsertDiscordLink } = require('../supabase');
const { isTeamSlotName, allBrackets } = require('../tournament-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock-tournament')
    .setDescription('Lock (or unlock) all bot-side changes — only when setup is complete')
    .addStringOption((o) =>
      o.setName('action').setDescription('lock or unlock').setRequired(true)
        .addChoices({ name: 'lock', value: 'lock' }, { name: 'unlock', value: 'unlock' })
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    if (!ctx.isOrganizer) {
      await interaction.editReply('⛔ Only this tournament\'s organizers can lock/unlock it.');
      return;
    }
    const action = interaction.options.getString('action');
    const t = ctx.tournament;

    if (action === 'unlock') {
      await upsertDiscordLink({ ...ctx.link, locked: false });
      await interaction.editReply('🔓 Tournament unlocked — bot write commands are enabled again.');
      return;
    }

    // Prerequisites for locking (point 16 of the spec).
    const problems = [];
    if (!t.overview && !t.event?.startDate) problems.push('Tournament details not set — `/set-details`');
    if ((t.teams ?? []).length < 2) problems.push('Fewer than 2 teams imported — `/import-teams`');
    const brackets = allBrackets(t);
    if (brackets.length === 0) problems.push('No bracket generated — `/set-bracket`');
    for (const { label, bracket } of brackets) {
      const r0 = bracket.rounds?.[0] ?? [];
      const open = r0.filter((m) => isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name)).length;
      if (open > 0) problems.push(`${label}: ${open} round-1 slot(s) still empty — \`/assign-slot\``);
    }

    if (problems.length > 0) {
      await interaction.editReply(
        `❌ Can't lock yet — setup is incomplete:\n${problems.map((p) => `• ${p}`).join('\n')}`
      );
      return;
    }

    await upsertDiscordLink({ ...ctx.link, locked: true });
    const embed = new EmbedBuilder()
      .setTitle('🔒 Tournament locked')
      .setDescription(
        'All bot write commands (`/set-details`, `/import-teams`, `/update-roster`, `/set-bracket`, `/assign-slot`, `/update-match`, `/finish-match`) are now disabled.\n' +
        'Unlock anytime with `/lock-tournament action:unlock`.'
      )
      .setColor(0xf59e0b);
    await interaction.editReply({ embeds: [embed] });
  },
};
