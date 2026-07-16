// Captain self-registration — any server member registers their team via a
// popup form; organizers approve/reject with one click. An alternative to the
// Excel import (/import-teams), not a replacement. See src/registration.js.
const { SlashCommandBuilder } = require('discord.js');
const { registrationModal } = require('../registration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register-team')
    .setDescription('Register YOUR team for this tournament — you become its captain (organizer approves)'),
  // Modals must be the FIRST response to an interaction, so bot.js must not
  // auto-defer this command.
  noDefer: true,
  async execute(interaction) {
    await interaction.showModal(registrationModal());
  },
};
