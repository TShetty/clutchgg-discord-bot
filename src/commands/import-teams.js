// Import teams from an .xlsx file — identical columns and validation to the
// website importer. Run without a file to receive the template.
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { requireOrganizer, saveTournament } = require('../write-utils');
const { parseTeamsXlsx, toTournamentTeams, buildTemplateBuffer } = require('../excel-import');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import-teams')
    .setDescription('Import teams from an .xlsx file (run without a file to get the template)')
    .addAttachmentOption((o) =>
      o.setName('file').setDescription('Filled-in .xlsx — columns: Team Name, Player Name 1-7, Riot ID 1-7, Role 1-7')
    )
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('add: append to existing teams (default) · replace: wipe current teams first')
        .addChoices({ name: 'add to existing teams', value: 'add' }, { name: 'replace all teams', value: 'replace' })
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const file = interaction.options.getAttachment('file');
    if (!file) {
      const template = new AttachmentBuilder(buildTemplateBuffer(), { name: 'tournament_template.xlsx' });
      await interaction.editReply({
        content:
          '📄 Here\'s the import template. Fill it in and run `/import-teams file:<your file>`.\n' +
          '• **Team Name** — required\n' +
          '• **Player Name 1-5** — main roster (at least 1 required) · **6-7** optional subs\n' +
          '• **Riot ID** — optional, `name#tag`, used for pulling match stats\n' +
          '• **Role** — optional: igl, duelist, controller, sentinel, initiator\n' +
          '• Player photos are added on the website edit section, not via Excel.',
        files: [template],
      });
      return;
    }

    if (!/\.xlsx?$/i.test(file.name)) {
      await interaction.editReply('❌ Please upload an Excel file (`.xlsx`). Run `/import-teams` without a file to get the template.');
      return;
    }

    const res = await fetch(file.url);
    if (!res.ok) {
      await interaction.editReply('❌ Could not download the attachment from Discord. Please try again.');
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const { teams: parsed, errors, warnings } = parseTeamsXlsx(buffer);
    if (errors.length > 0) {
      await interaction.editReply(`❌ Import failed:\n${errors.map((e) => `• ${e}`).join('\n')}`);
      return;
    }
    if (parsed.length === 0) {
      await interaction.editReply('❌ No valid teams found in the file. Check the template format with `/import-teams` (no file).');
      return;
    }

    const mode = interaction.options.getString('mode') ?? 'add';
    const newTeams = toTournamentTeams(parsed);

    let skipped = [];
    let total = 0;
    await saveTournament(ctx.tournamentId, (t) => {
      const existing = mode === 'replace' ? [] : (t.teams ?? []);
      // Skip incoming teams whose name already exists (case-insensitive).
      const existingNames = new Set(existing.map((tm) => tm.name.trim().toLowerCase()));
      const additions = [];
      for (const tm of newTeams) {
        if (existingNames.has(tm.name.trim().toLowerCase())) skipped.push(tm.name);
        else additions.push(tm);
      }
      const max = t.event?.maxTeams;
      let capped = [...existing, ...additions];
      if (max && capped.length > max) {
        const over = capped.length - max;
        skipped.push(...capped.slice(max).map((tm) => `${tm.name} (over the ${max}-team limit)`));
        capped = capped.slice(0, max);
        void over;
      }
      t.teams = capped;
      total = capped.length;
      return t;
    });

    const imported = newTeams.length - skipped.length;
    const embed = new EmbedBuilder()
      .setTitle('✅ Teams imported')
      .setDescription(
        `**${imported}** team(s) ${mode === 'replace' ? 'imported (replaced previous list)' : 'added'} — tournament now has **${total}** teams.`
      )
      .setColor(0x22c55e)
      .setFooter({ text: 'Review with /teams · rosters with /roster' });
    if (skipped.length) embed.addFields({ name: 'Skipped (already exist / over limit)', value: skipped.join('\n').slice(0, 1024) });
    if (warnings.length) embed.addFields({ name: '⚠️ Warnings', value: warnings.join('\n').slice(0, 1024) });

    await interaction.editReply({ embeds: [embed] });
  },
};
