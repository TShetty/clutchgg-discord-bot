// Pull Valorant match stats from the API and record them on a tournament match,
// exactly like the website's per-match "Fetch Match Stats" flow. Shows the
// scoreboard (map, players, K/D/ACS, team round scores) for review, then on
// confirm writes the maps + player stats, computes the series winner, and
// auto-advances the bracket.
//
// BO3/BO5: pass one Valorant match id PER MAP played so far. If some maps are
// already recorded, the command detects it and offers to add the new map(s),
// overwrite, or update in place — nothing is written until the organizer picks.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { requireOrganizer, numberedMatchList, deriveScore } = require('../write-utils');
const { matchUrl } = require('../tournament-utils');
const { buildMatchResultFromId, DEFAULT_REGION } = require('../valorant-api');
const { maxMapsFor, mapIsPopulated, mapFields, seriesResult } = require('../scoreboard');
const { putPending } = require('../update-score-handler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-score')
    .setDescription('Pull Valorant match stats onto a match (no options = list matches you can score)')
    .addIntegerOption((o) =>
      o.setName('match').setDescription('Match number from the list this command shows').setMinValue(1)
    )
    .addStringOption((o) =>
      o
        .setName('match_ids')
        .setDescription('Valorant match ID(s), one per map played — comma or space separated (e.g. map1id,map2id)')
    )
    .addStringOption((o) =>
      o.setName('region').setDescription('Valorant region for the lookup (default ap)').addChoices(
        { name: 'Asia-Pacific (ap)', value: 'ap' },
        { name: 'North America (na)', value: 'na' },
        { name: 'Europe (eu)', value: 'eu' },
        { name: 'Korea (kr)', value: 'kr' },
      )
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const matchNo = interaction.options.getInteger('match');
    const idsRaw = interaction.options.getString('match_ids');

    // Matches with both real teams — the ones you can attach stats to. We don't
    // require a missing winner here: BO3 partial updates target a match that may
    // already have map 1 recorded.
    const scorable = (it) => it.status !== 'upcoming';

    // ── List mode ──────────────────────────────────────────────────────────
    if (matchNo == null || !idsRaw) {
      const items = numberedMatchList(ctx.tournament, scorable);
      if (items.length === 0) {
        await interaction.editReply('No live/played matches to score yet. Matches appear here once both teams are assigned and their scheduled time is near.');
        return;
      }
      const teamNameById = new Map((ctx.tournament.teams ?? []).map((t) => [t.id, t.name]));
      const lines = items.map((it) => {
        const { s1, s2 } = deriveScore(it.match);
        const fmt = (it.match.format ?? 'bo3').toUpperCase();
        const played = (it.match.maps ?? []).filter(mapIsPopulated).length;
        const state = it.match.winner ? `✅ done ${s1}:${s2}` : played > 0 ? `▶ ${played} map(s) in` : '⏳ no stats yet';
        return `**${it.n}.** ${it.match.team1Name} vs ${it.match.team2Name} — ${it.stage} · ${fmt} · ${state}`;
      });
      const embed = new EmbedBuilder()
        .setTitle('📊 Score a match')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(0x00b0f4)
        .setFooter({ text: 'Run: /update-score match:<n> match_ids:<valorant-id-per-map>   (BO3 → id1,id2,id3)' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── Fetch mode ─────────────────────────────────────────────────────────
    const items = numberedMatchList(ctx.tournament, scorable);
    const item = items.find((it) => it.n === matchNo);
    if (!item) {
      await interaction.editReply(`Match ${matchNo} isn't in the list — run \`/update-score\` with no options to see valid numbers.`);
      return;
    }
    const match = item.match;
    const region = interaction.options.getString('region') || DEFAULT_REGION;

    const ids = idsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const maxMaps = maxMapsFor(match.format);
    if (ids.length === 0) {
      await interaction.editReply('❌ Provide at least one Valorant match ID.');
      return;
    }
    if (ids.length > maxMaps) {
      await interaction.editReply(`❌ This match is ${(match.format ?? 'bo3').toUpperCase()} — at most ${maxMaps} map ID(s). You gave ${ids.length}.`);
      return;
    }

    // Resolve rosters for side-mapping (riotId preferred, else display name).
    const teamsById = new Map((ctx.tournament.teams ?? []).map((t) => [t.id, t]));
    const team1 = teamsById.get(match.team1Id);
    const team2 = teamsById.get(match.team2Id);
    if (!team1 || !team2) {
      await interaction.editReply('❌ One of this match\'s teams isn\'t in the roster — assign both teams before pulling stats.');
      return;
    }
    const team1Roster = (team1.players ?? []).map((p) => p.riotId || p.name);
    const team2Roster = (team2.players ?? []).map((p) => p.riotId || p.name);

    await interaction.editReply(`⏳ Pulling ${ids.length} map(s) from the Valorant API (region **${region}**)… this can take a few seconds.`);

    // Fetch each map id sequentially with a small gap (rate-limit friendly).
    const fetched = [];
    const failures = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const result = await buildMatchResultFromId(ids[i], team1Roster, team2Roster, match.team1Id, match.team2Id);
        fetched.push(result);
      } catch (e) {
        failures.push({ id: ids[i], error: e instanceof Error ? e.message : 'fetch failed' });
      }
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }

    if (fetched.length === 0) {
      const detail = failures.map((f) => `• \`${f.id}\` — ${f.error}`).join('\n');
      await interaction.editReply(`❌ Couldn't fetch any of the maps:\n${detail}`);
      return;
    }

    // Existing recorded maps on this match (what's already stored).
    const existingMaps = (match.maps ?? []).filter(mapIsPopulated);
    const teamNameById = new Map((ctx.tournament.teams ?? []).map((t) => [t.id, t.name]));

    // Build the PREVIEW match: existing maps followed by the freshly fetched ones,
    // capped at maxMaps. This is what "Add as new map(s)" would commit.
    const appended = [...existingMaps, ...fetched].slice(0, maxMaps);
    // And the OVERWRITE preview: fetched maps replace everything from map 1.
    const overwritten = fetched.slice(0, maxMaps);

    const previewMatchAppend = { ...match, maps: appended };
    const previewMatchOverwrite = { ...match, maps: overwritten };

    // Warn if the roster side-match was weak for any fetched map (< 2 per team).
    const weak = fetched.filter((f) => (f._mapping?.team1Matches ?? 0) < 2 || (f._mapping?.team2Matches ?? 0) < 2);

    // Stash both candidate results so the confirm handler can commit without a
    // second API round-trip. Keyed by the reply message id.
    const token = await putPending(interaction, {
      tournamentId: ctx.tournamentId,
      matchId: match.id,
      format: match.format ?? 'bo3',
      append: appended,
      overwrite: overwritten,
      fetchedCount: fetched.length,
      hadExisting: existingMaps.length,
    });

    // Compose the review embed.
    const resAppend = seriesResult(previewMatchAppend);
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${match.team1Name} vs ${match.team2Name}`)
      .setURL(matchUrl(match.id))
      .setColor(0x00b0f4)
      .setDescription(
        `${item.stage} · **${(match.format ?? 'bo3').toUpperCase()}** · region **${region}**\n` +
        (existingMaps.length
          ? `⚠️ This match already has **${existingMaps.length} map(s)** recorded. Choose how to apply the ${fetched.length} pulled map(s) below.`
          : `Pulled **${fetched.length} map(s)**. Review the scoreboard, then confirm.`)
      );

    // Show the scoreboard for whichever preview is the "primary" choice:
    // append when there were existing maps, else just the fetched maps.
    const previewForDisplay = existingMaps.length ? previewMatchAppend : previewMatchOverwrite;
    for (const f of mapFields(previewForDisplay.maps, previewForDisplay, teamNameById)) {
      embed.addFields(f);
    }

    const notes = [];
    if (resAppend.decided) {
      const winnerName = resAppend.winnerId === match.team1Id ? match.team1Name : match.team2Name;
      notes.push(`🏆 Series would be decided: **${winnerName}** (${resAppend.s1}:${resAppend.s2}) — bracket will advance on confirm.`);
    } else {
      notes.push(`ℹ️ Series not yet decided (${resAppend.s1}:${resAppend.s2}) — you can add remaining maps later.`);
    }
    if (weak.length) notes.push(`⚠️ Weak roster match on ${weak.length} map(s) — some players may be mis-assigned. Verify names above.`);
    if (failures.length) notes.push(`⚠️ ${failures.length} ID(s) failed and were skipped: ${failures.map((f) => `\`${f.id}\``).join(', ')}`);
    if (notes.length) embed.addFields({ name: '​', value: notes.join('\n').slice(0, 1024) });

    // Buttons depend on whether existing maps were present.
    const row = new ActionRowBuilder();
    if (existingMaps.length) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`usc:append:${token}`).setLabel(`➕ Add ${fetched.length} as new map(s)`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`usc:overwrite:${token}`).setLabel('♻️ Overwrite from map 1').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('usc:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId(`usc:overwrite:${token}`).setLabel('✅ Confirm & record stats').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('usc:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
    }

    await interaction.editReply({ content: '', embeds: [embed], components: [row] });
  },
};
