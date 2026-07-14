require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, MessageFlags } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Load every command module in src/commands. Each exports:
//   data     — SlashCommandBuilder (name, description, options)
//   execute  — async (interaction) => void  (reply via editReply; already deferred)
//   ephemeral — optional, defer as ephemeral (admin/private commands)
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  if (command?.data?.name && typeof command.execute === 'function') {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[BOT] Skipping ${file}: missing data or execute`);
  }
}
console.log(`[BOT] Loaded ${client.commands.size} commands: ${[...client.commands.keys()].join(', ')}`);

client.on('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  client.user.setActivity('matches 🎮', { type: 'WATCHING' });

  // Warm up the REST connection pool so the first real interaction reply
  // doesn't pay the cold TLS/DNS handshake cost against Discord's 3s window.
  try {
    await client.application.fetch();
    console.log('[BOT] REST connection warmed up');
  } catch (e) {
    console.error('[BOT] Warm-up call failed:', e.message);
  }

  // Automatic notifications (result cards, reminders, end-of-day, onboarding).
  // Requires DB credentials; skipped cleanly when they're absent (local dev).
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    require('./src/notifications').start(client);
  } else {
    console.warn('[BOT] Notifications disabled — missing Supabase env vars');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[BOT] Unknown command: ${interaction.commandName}`);
    return;
  }

  console.log(`[INTERACTION] /${interaction.commandName} by ${interaction.user.tag} in guild ${interaction.guildId}`);

  // Defer immediately — 15-minute edit window instead of the 3s initial-reply
  // window, so slow network round-trips never cause "Unknown interaction".
  try {
    await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
  } catch (error) {
    console.error(`[BOT] Failed to defer /${interaction.commandName}:`, error.message);
    return;
  }

  try {
    await command.execute(interaction);
    console.log(`[BOT] /${interaction.commandName} completed`);
  } catch (error) {
    console.error(`[BOT] Error in /${interaction.commandName}:`, error);
    try {
      await interaction.editReply('⚠️ Something went wrong running this command. Please try again — if it keeps failing, contact ClutchGG support.');
    } catch (e) {
      console.error('[BOT] Failed to send error reply:', e.message);
    }
  }
});

client.on('error', (error) => console.error('Discord client error:', error));
client.on('warn', (warn) => console.warn('Discord warning:', warn));
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

console.log('[BOT] Starting bot with token:', process.env.DISCORD_TOKEN ? '✓ Found' : '✗ Missing');
client.login(process.env.DISCORD_TOKEN);
