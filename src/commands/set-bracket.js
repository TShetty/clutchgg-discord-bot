// Generate the tournament bracket — same options and generators as the
// website (bracketUtils.ts): single / double elimination (empty slots you
// then fill with /assign-slot) or round robin (auto-filled schedule).
// Two-stage events: generate stage 1 and stage 2 separately.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament, tournamentHasBegun } = require('../write-utils');
const { generateSingleElimination, generateDoubleElimination, generateRoundRobin, scopeBracketIds } = require('../bracket-gen');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-bracket')
    .setDescription('Generate the bracket (single/double elimination or round robin)')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Bracket format — same options as the website')
        .setRequired(true)
        .addChoices(
          { name: 'single elimination', value: 'single' },
          { name: 'double elimination', value: 'double' },
          { name: 'round robin (everyone plays everyone)', value: 'roundrobin' },
        )
    )
    .addStringOption((o) =>
      o
        .setName('stage')
        .setDescription('Which stage this bracket is for (default: single-stage tournament)')
        .addChoices(
          { name: 'single-stage tournament', value: 'main' },
          { name: 'stage 1 (qualifying stage)', value: 'stage1' },
          { name: 'stage 2 (playoffs)', value: 'stage2' },
        )
    )
    .addIntegerOption((o) =>
      o.setName('qualifiers').setDescription('Stage 1 only: how many teams qualify to stage 2').setMinValue(2).setMaxValue(64)
    )
    .addIntegerOption((o) =>
      o.setName('points_per_win').setDescription('Round robin only: league points per match win (default 3)').setMinValue(1).setMaxValue(10)
    )
    .addIntegerOption((o) =>
      o.setName('slots').setDescription('Elimination only: force bracket size (e.g. 8/16), even if fewer teams imported yet').setMinValue(2).setMaxValue(128)
    )
    .addBooleanOption((o) =>
      o.setName('overwrite').setDescription('Required to replace an existing bracket for this stage — this deletes its matches')
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const type = interaction.options.getString('type');
    const stage = interaction.options.getString('stage') ?? 'main';
    const qualifiers = interaction.options.getInteger('qualifiers');
    const pointsPerWin = interaction.options.getInteger('points_per_win');
    const slots = interaction.options.getInteger('slots');
    const overwrite = interaction.options.getBoolean('overwrite') ?? false;

    if (stage === 'stage2' && type === 'roundrobin') {
      await interaction.editReply('❌ Stage 2 must be an elimination format (single or double) — same rule as the website.');
      return;
    }

    let failMsg = null;
    let summary = null;

    await saveTournament(ctx.tournamentId, (t) => {
      const teams = t.teams ?? [];

      // Edge case: no/too few teams.
      if (teams.length < 2 && !slots) {
        failMsg = `Only ${teams.length} team(s) imported. Import teams first (\`/import-teams\`) or pass \`slots\` to pre-generate an empty bracket.`;
        return t;
      }

      // Edge case: tournament already begun → bracket type locked (website rule).
      const field = stage === 'stage1' ? 'stage1Bracket' : stage === 'stage2' ? 'stage2Bracket' : 'generatedBracket';
      if (t[field] && tournamentHasBegun(t)) {
        failMsg = 'The tournament has already begun (stats pulled or start time passed) — the bracket type can no longer be changed. This matches the website rule.';
        return t;
      }

      // Edge case: existing bracket needs explicit overwrite.
      if (t[field] && !overwrite) {
        failMsg = `A ${stage === 'main' ? '' : `${stage} `}bracket already exists. Re-run with \`overwrite:true\` to replace it (its matches and any schedule on them are discarded).`;
        return t;
      }

      // Stage 1 qualifiers requirement.
      if (stage === 'stage1') {
        if (!qualifiers) {
          failMsg = 'Stage 1 needs `qualifiers` — how many teams advance to stage 2 (e.g. `qualifiers:4`).';
          return t;
        }
        if (qualifiers >= teams.length && !slots) {
          failMsg = `qualifiers (${qualifiers}) must be smaller than the number of teams (${teams.length}).`;
          return t;
        }
      }

      // Round robin needs the actual team list (auto-populated schedule).
      if (type === 'roundrobin' && teams.length < 2) {
        failMsg = 'Round robin needs at least 2 imported teams — it schedules real teams, there are no empty slots.';
        return t;
      }

      const bracket =
        type === 'single' ? generateSingleElimination(teams, slots ?? undefined)
        : type === 'double' ? generateDoubleElimination(teams, slots ?? undefined)
        : generateRoundRobin(teams);

      if (type === 'roundrobin' && pointsPerWin) bracket.pointsPerWin = pointsPerWin;

      // Website parity: stage brackets get id-scoped so stage 1 / stage 2 match
      // ids never collide (the website resolves stage matches by id, stage 1
      // first). The main single-stage bracket stays unscoped, as on the website.
      t[field] = stage === 'main' ? bracket : scopeBracketIds(bracket, t.id);
      if (stage === 'stage1') {
        t.tournamentType = 'group';
        t.stage1Config = {
          format: type,
          qualifiersCount: qualifiers,
          ...(pointsPerWin ? { pointsPerWin } : {}),
        };
      } else if (stage === 'stage2') {
        t.tournamentType = 'group';
        t.stage2Format = type;
      }

      const matchCount = bracket.rounds.flat().length;
      const slotInfo = type === 'roundrobin'
        ? `${bracket.rounds.length} rounds, ${matchCount} matches — teams auto-placed.`
        : `${matchCount} matches. Round 1 slots are empty — fill them with \`/assign-slot\`.`;
      summary = `**${type === 'roundrobin' ? 'Round Robin' : type === 'single' ? 'Single Elimination' : 'Double Elimination'}** bracket generated for ${stage === 'main' ? 'the tournament' : stage}.\n${slotInfo}`;
      return t;
    });

    if (failMsg) {
      await interaction.editReply(`❌ ${failMsg}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Bracket generated')
      .setDescription(summary)
      .setColor(0x22c55e)
      .setFooter({ text: 'View it with /bracket · assign teams with /assign-slot · schedule with /update-match' });
    await interaction.editReply({ embeds: [embed] });
  },
};
