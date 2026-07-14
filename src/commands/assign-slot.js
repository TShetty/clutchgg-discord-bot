// Fill a bracket slot with a team — the bot equivalent of the website's
// "Select Team" dropdown on round-1 matches (changeTeamOpponent in
// bracketUtils.ts). Run without options to see the open slots.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament, matchHasStats } = require('../write-utils');
const { isTeamSlotName } = require('../tournament-utils');

function bracketOf(t, stage) {
  if (stage === 'stage1') return { field: 'stage1Bracket', b: t.stage1Bracket };
  if (stage === 'stage2') return { field: 'stage2Bracket', b: t.stage2Bracket };
  // default: whichever single bracket exists
  if (t.generatedBracket) return { field: 'generatedBracket', b: t.generatedBracket };
  if (t.stage1Bracket) return { field: 'stage1Bracket', b: t.stage1Bracket };
  return { field: 'generatedBracket', b: undefined };
}

// Open (assignable) slots: round-0 matches still carrying placeholder names.
function openSlots(b) {
  const out = [];
  if (!b?.rounds?.length) return out;
  const r0 = b.rounds[0] ?? [];
  r0.forEach((m, i) => {
    if (isTeamSlotName(m.team1Name)) out.push({ matchIndex: i, slot: 1, match: m });
    if (isTeamSlotName(m.team2Name)) out.push({ matchIndex: i, slot: 2, match: m });
  });
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assign-slot')
    .setDescription('Put a team into a bracket slot (run with no options to list open slots)')
    .addIntegerOption((o) => o.setName('match').setDescription('Round-1 match number (from the open-slots list)').setMinValue(1))
    .addIntegerOption((o) => o.setName('slot').setDescription('Which side of the match: 1 (top) or 2 (bottom)').setMinValue(1).setMaxValue(2))
    .addStringOption((o) => o.setName('team').setDescription('Team name to place (partial match works)'))
    .addStringOption((o) =>
      o.setName('stage').setDescription('Which bracket (only needed for two-stage events)')
        .addChoices({ name: 'stage 1', value: 'stage1' }, { name: 'stage 2', value: 'stage2' })
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const stage = interaction.options.getString('stage');
    const matchNo = interaction.options.getInteger('match');
    const slotNo = interaction.options.getInteger('slot');
    const teamQuery = interaction.options.getString('team');

    // List mode
    if (matchNo == null || slotNo == null || !teamQuery) {
      const { b } = bracketOf(ctx.tournament, stage);
      if (!b) {
        await interaction.editReply('❌ No bracket yet — generate one with `/set-bracket` first.');
        return;
      }
      const slots = openSlots(b);
      if (slots.length === 0) {
        await interaction.editReply('✅ All bracket slots are filled. View with `/bracket`.');
        return;
      }
      const lines = slots.map(
        (s) => `Match **${s.matchIndex + 1}** slot **${s.slot}** — currently *${s.slot === 1 ? s.match.team1Name : s.match.team2Name}* (vs ${s.slot === 1 ? s.match.team2Name : s.match.team1Name})`
      );
      const placed = new Set();
      for (const m of b.rounds[0] ?? []) { placed.add(m.team1Id); placed.add(m.team2Id); }
      const unplaced = (ctx.tournament.teams ?? []).filter((tm) => !placed.has(tm.id)).map((tm) => tm.name);
      const embed = new EmbedBuilder()
        .setTitle('🧩 Open bracket slots')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(0x00b0f4)
        .setFooter({ text: 'Fill one: /assign-slot match:<n> slot:<1|2> team:<name>' });
      if (unplaced.length) embed.addFields({ name: 'Teams not yet placed', value: unplaced.join(', ').slice(0, 1024) });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let failMsg = null;
    let summary = null;
    await saveTournament(ctx.tournamentId, (t) => {
      const { b } = bracketOf(t, stage);
      if (!b) { failMsg = 'No bracket yet — `/set-bracket` first.'; return t; }
      const r0 = b.rounds[0] ?? [];
      const m = r0[matchNo - 1];
      if (!m) { failMsg = `Match ${matchNo} doesn't exist in round 1 (1-${r0.length}).`; return t; }
      if (matchHasStats(m)) { failMsg = 'This match already has pulled stats — its teams are locked (website rule).'; return t; }

      const team = (t.teams ?? []).find((tm) => tm.name.toLowerCase() === teamQuery.trim().toLowerCase())
        || (t.teams ?? []).find((tm) => tm.name.toLowerCase().includes(teamQuery.trim().toLowerCase()));
      if (!team) { failMsg = `No team matching **${teamQuery}** — check \`/teams\`.`; return t; }

      // Edge case: team already placed somewhere in round 1.
      for (const other of r0) {
        if ((other.team1Id === team.id || other.team2Id === team.id) && other !== m) {
          failMsg = `**${team.name}** is already placed in match ${r0.indexOf(other) + 1}. Remove/replace it there first.`;
          return t;
        }
      }
      if ((slotNo === 1 ? m.team2Id : m.team1Id) === team.id) {
        failMsg = `**${team.name}** is already in the other slot of this match.`;
        return t;
      }

      const prev = slotNo === 1 ? m.team1Name : m.team2Name;
      if (slotNo === 1) { m.team1Id = team.id; m.team1Name = team.name; }
      else { m.team2Id = team.id; m.team2Name = team.name; }
      m.needsAssignment = isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name);

      b.customizationHistory = b.customizationHistory ?? [];
      b.customizationHistory.push({
        timestamp: new Date().toISOString(),
        changes: `Changed ${slotNo === 1 ? 'first' : 'second'} team in round 1, match ${matchNo}: ${prev} → ${team.name}`,
      });

      summary = `Match **${matchNo}** slot **${slotNo}**: ${isTeamSlotName(prev) ? 'empty' : `**${prev}**`} → **${team.name}**\nNow: **${m.team1Name}** vs **${m.team2Name}**`;
      return t;
    });

    if (failMsg) await interaction.editReply(`❌ ${failMsg}`);
    else {
      const embed = new EmbedBuilder().setTitle('✅ Slot assigned').setDescription(summary).setColor(0x22c55e)
        .setFooter({ text: 'See remaining open slots: /assign-slot (no options) · view: /bracket' });
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
