// Guided onboarding — one command that walks the organizer through the whole
// setup with forms, dropdowns and buttons instead of separate slash commands.
// Detects what's already done and resumes at the right step. See src/wizard.js.
const { SlashCommandBuilder } = require('discord.js');
const { requireOrganizer } = require('../write-utils');
const { renderStep } = require('../wizard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Guided tournament setup — details, teams, bracket and seeding, step by step'),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    await interaction.editReply(renderStep(ctx.tournament));
  },
};
