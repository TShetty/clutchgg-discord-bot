// Registers all slash commands from src/commands with Discord.
// Run after adding/changing any command definition: `npm run register`
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const guildId = process.env.DISCORD_GUILD_ID || '1121682578525663362';
const clientId = process.env.DISCORD_CLIENT_ID || '1526615994234310657';

const commands = [];
const commandsDir = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands: ${commands.map((c) => c.name).join(', ')}`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exitCode = 1;
  }
})();
