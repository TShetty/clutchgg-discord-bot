// When a server hosts more than one linked tournament, pick which one all
// commands act on. Run without options to see the list.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveGuildTournament } = require('../permissions');
const { getTournamentById, upsertDiscordLink } = require('../supabase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use-tournament')
    .setDescription('Switch which linked tournament the bot commands act on in this server')
    .addStringOption((o) => o.setName('tournament_id').setDescription('The tournament to make active (ID from the list this command shows)')),
  ephemeral: true,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.editReply('This command only works inside a server.');
      return;
    }
    const ctx = await resolveGuildTournament(interaction);
    if (ctx.allLinks.length === 0) {
      await interaction.editReply('❌ No tournaments are linked to this server yet (`/claim-tournament` or superadmin `/link-tournament`).');
      return;
    }
    if (!ctx.isOrganizer) {
      await interaction.editReply('⛔ Only organizers can switch the active tournament.');
      return;
    }

    const chosen = interaction.options.getString('tournament_id')?.trim();
    if (!chosen) {
      const lines = [];
      for (const l of ctx.allLinks) {
        const t = await getTournamentById(l.tournament_id);
        lines.push(`${l.tournament_id === ctx.tournamentId ? '➡️' : '▫️'} **${t?.name ?? '(deleted)'}** — \`${l.tournament_id}\`${l.locked ? ' 🔒' : ''}`);
      }
      const embed = new EmbedBuilder()
        .setTitle('🎛️ Linked tournaments in this server')
        .setDescription(`${lines.join('\n')}\n\nSwitch: \`/use-tournament tournament_id:<id>\``)
        .setColor(0x00b0f4);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const target = ctx.allLinks.find((l) => l.tournament_id === chosen);
    if (!target) {
      await interaction.editReply(`❌ \`${chosen}\` isn't linked to this server — run \`/use-tournament\` with no options to see the list.`);
      return;
    }

    for (const l of ctx.allLinks) {
      await upsertDiscordLink({ ...l, is_active: l.tournament_id === chosen });
    }
    const t = await getTournamentById(chosen);
    await interaction.editReply(`✅ All commands in this server now act on **${t?.name ?? chosen}**.`);
  },
};
