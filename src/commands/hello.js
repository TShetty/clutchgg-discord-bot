const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Say hello to the bot'),
  async execute(interaction) {
    await interaction.editReply(`👋 Hello ${interaction.user.username}!`);
  },
};
