// Registers all slash commands from src/commands with Discord.
//
// Default: GLOBAL registration — commands appear in every server the bot is
// invited to (required for organizer self-service; takes up to ~1 hour to
// propagate). The dev guild's per-guild copies are cleared to avoid duplicate
// entries in the command picker.
//
// `node register-commands.js --guild` registers to the dev guild only
// (instant, for local testing of new commands).
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const guildId = process.env.DISCORD_GUILD_ID || '1121682578525663362';
const clientId = process.env.DISCORD_CLIENT_ID || '1526615994234310657';
const guildOnly = process.argv.includes('--guild');

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
    if (guildOnly) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅ Registered to dev guild ${guildId} (instant).`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      // Clear guild-scoped duplicates so the picker doesn't show each command twice.
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      console.log('✅ Registered GLOBALLY (may take up to ~1 hour to appear everywhere; dev-guild duplicates cleared).');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exitCode = 1;
  }
})();
