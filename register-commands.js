require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  {
    name: 'ping',
    description: 'Replies with pong!',
  },
  {
    name: 'hello',
    description: 'Says hello to you',
  },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    // Replace these with your actual IDs
    const guildId = '1121682578525663362';
    const clientId = '1526615994234310657';

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();
