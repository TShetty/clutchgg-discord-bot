const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is online and responding'),
  async execute(interaction) {
    await interaction.editReply('🏓 Pong!');
  },
};
