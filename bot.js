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

// Discord's hard limits on a reply. A command that overflows these throws
// "Invalid Form Body ... BASE_TYPE_MAX_LENGTH"; we trim to avoid it entirely.
const MAX_CONTENT = 2000;
const MAX_EMBED_DESC = 4096;
const MAX_EMBED_FIELD = 1024;
const ELLIPSIS = '\n…(truncated)';

const trimStr = (s, max) =>
  typeof s === 'string' && s.length > max ? s.slice(0, max - ELLIPSIS.length) + ELLIPSIS : s;

// Clamp every string in a reply payload to Discord's limits so no command can
// ever fail with a length error, whatever data the tournament holds.
function clampPayload(payload) {
  if (typeof payload === 'string') return trimStr(payload, MAX_CONTENT);
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.content) payload.content = trimStr(payload.content, MAX_CONTENT);
  for (const embed of payload.embeds ?? []) {
    // discord.js EmbedBuilder keeps its raw object under .data
    const e = embed?.data ?? embed;
    if (!e || typeof e !== 'object') continue;
    if (e.description) e.description = trimStr(e.description, MAX_EMBED_DESC);
    for (const f of e.fields ?? []) {
      if (f?.value) f.value = trimStr(f.value, MAX_EMBED_FIELD);
    }
  }
  return payload;
}

// Turn a thrown error into one short, actionable line for the user.
function friendlyError(error) {
  const msg = error?.rawError?.message || error?.message || 'Unknown error';
  // Discord form-body validation (length, bad URL, empty field, etc.)
  if (/Invalid Form Body/i.test(msg) || error?.code === 50035) {
    if (/MAX_LENGTH/i.test(JSON.stringify(error?.rawError ?? msg))) {
      return '⚠️ That result was too long to show in full. Ask ClutchGG support to shorten it, or try a narrower query.';
    }
    return '⚠️ Discord rejected the response format. Please report this to ClutchGG support.';
  }
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) {
    return '⚠️ Couldn\'t reach the ClutchGG servers. Please try again in a moment.';
  }
  if (/permission/i.test(msg)) {
    return '⚠️ I\'m missing a Discord permission needed for this. Check the bot\'s role settings.';
  }
  // Fallback: generic message only. The full error (which may contain DB
  // internals, IDs, or stack detail) goes to the logs — never to the user.
  return '⚠️ Something went wrong running this command. Please try again — if it keeps failing, contact ClutchGG support.';
}

client.on('interactionCreate', async (interaction) => {
  // Component interactions (buttons, select menus, modals), routed by
  // customId namespace: "wiz:" → /setup wizard, "reg:" → team registration.
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const handler = interaction.customId?.startsWith('wiz:') ? require('./src/wizard')
      : interaction.customId?.startsWith('reg:') ? require('./src/registration')
      : null;
    if (!handler) return;
    try {
      await handler.handle(interaction);
    } catch (error) {
      console.error(`[WIZARD] Error handling ${interaction.customId}:`, error);
      try {
        const payload = { content: friendlyError(error), embeds: [], components: [] };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch (e) {
        console.error('[WIZARD] Failed to send error reply:', e.message);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[BOT] Unknown command: ${interaction.commandName}`);
    return;
  }

  console.log(`[INTERACTION] /${interaction.commandName} by ${interaction.user.tag} in guild ${interaction.guildId}`);

  // Defer immediately — 15-minute edit window instead of the 3s initial-reply
  // window, so slow network round-trips never cause "Unknown interaction".
  // Commands that open a modal (noDefer) must respond with it FIRST, so they
  // skip the defer and manage their own replies.
  if (!command.noDefer) {
    try {
      await interaction.deferReply(command.ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
    } catch (error) {
      console.error(`[BOT] Failed to defer /${interaction.commandName}:`, error.message);
      return;
    }
  }

  // Wrap editReply so EVERY command's replies are auto-clamped to Discord's
  // limits — no command needs to slice() its own strings.
  const rawEditReply = interaction.editReply.bind(interaction);
  interaction.editReply = (payload) => rawEditReply(clampPayload(payload));

  try {
    await command.execute(interaction);
    console.log(`[BOT] /${interaction.commandName} completed`);
  } catch (error) {
    console.error(`[BOT] Error in /${interaction.commandName}:`, error);
    try {
      if (interaction.deferred || interaction.replied) await rawEditReply(friendlyError(error));
      else await interaction.reply({ content: friendlyError(error), flags: MessageFlags.Ephemeral });
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
