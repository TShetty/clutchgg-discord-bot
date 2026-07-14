require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

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
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`\n[INTERACTION] Command: ${interaction.commandName}, User: ${interaction.user.tag}`);

  // Defer immediately — this gives us Discord's 15-minute edit window instead
  // of the 3s initial-reply window, so a slow network round-trip (which our
  // connection to Discord occasionally hits) doesn't cause "Unknown interaction".
  try {
    await interaction.deferReply();
  } catch (error) {
    console.error('Failed to defer interaction (likely already expired):', error.message);
    return;
  }

  try {
    if (interaction.commandName === 'ping') {
      await interaction.editReply('🏓 Pong!');
    } else if (interaction.commandName === 'hello') {
      await interaction.editReply(`👋 Hello ${interaction.user.username}!`);
    } else {
      console.log(`Unknown command: ${interaction.commandName}`);
      await interaction.editReply('Unknown command.');
    }
    console.log(`${interaction.commandName} command sent successfully`);
  } catch (error) {
    console.error('Error handling interaction:', error);
    try {
      await interaction.editReply('There was an error executing this command!');
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
});

client.on('error', error => console.error('Discord client error:', error));
client.on('warn', warn => console.warn('Discord warning:', warn));

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

console.log('[BOT] Starting bot with token:', process.env.DISCORD_TOKEN ? '✓ Found' : '✗ Missing');
client.login(process.env.DISCORD_TOKEN);
