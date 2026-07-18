// Find the Valorant match ID for a tournament match by searching a player's
// recent custom games — the bot analog of the website's "Find Match ID" flow
// (getCustomGamesForBothTeams). Lists candidate games where BOTH teams appear,
// with score + roster overlap, so the organizer can copy an ID into
// /update-score instead of hunting through match history by hand.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, numberedMatchList } = require('../write-utils');
const { findCustomGamesForMatch, DEFAULT_REGION } = require('../valorant-api');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('find-match')
    .setDescription('Find the Valorant match ID(s) for a match by searching a player\'s recent customs')
    .addIntegerOption((o) => o.setName('match').setDescription('Match number from the list this command shows'))
    .addStringOption((o) =>
      o.setName('seed_player').setDescription('Riot ID (Name#TAG) to search from — defaults to a player in the match\'s roster')
    )
    .addStringOption((o) =>
      o.setName('region').setDescription('Valorant region (default ap)').addChoices(
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
    const scorable = (it) => it.status !== 'upcoming';

    // ── List mode ──────────────────────────────────────────────────────────
    if (matchNo == null) {
      const items = numberedMatchList(ctx.tournament, scorable);
      if (items.length === 0) {
        await interaction.editReply('No live/played matches to search for yet.');
        return;
      }
      const lines = items.map((it) => `**${it.n}.** ${it.match.team1Name} vs ${it.match.team2Name} — ${it.stage}`);
      const embed = new EmbedBuilder()
        .setTitle('🔎 Find a match ID')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(0x00b0f4)
        .setFooter({ text: 'Run: /find-match match:<n>   (searches a roster player\'s recent customs)' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const items = numberedMatchList(ctx.tournament, scorable);
    const item = items.find((it) => it.n === matchNo);
    if (!item) {
      await interaction.editReply(`Match ${matchNo} isn't in the list — run \`/find-match\` with no options to see valid numbers.`);
      return;
    }
    const match = item.match;
    const region = interaction.options.getString('region') || DEFAULT_REGION;

    const teamsById = new Map((ctx.tournament.teams ?? []).map((t) => [t.id, t]));
    const team1 = teamsById.get(match.team1Id);
    const team2 = teamsById.get(match.team2Id);
    if (!team1 || !team2) {
      await interaction.editReply('❌ One of this match\'s teams isn\'t in the roster — assign both teams first.');
      return;
    }
    const team1Roster = (team1.players ?? []).map((p) => p.riotId || p.name).filter(Boolean);
    const team2Roster = (team2.players ?? []).map((p) => p.riotId || p.name).filter(Boolean);

    // Seed player: explicit option, else the first roster player that has a full
    // Riot ID (Name#TAG) — the history endpoint needs a tag.
    let seed = interaction.options.getString('seed_player');
    if (!seed) {
      const withTag = [...(team1.players ?? []), ...(team2.players ?? [])]
        .map((p) => p.riotId)
        .find((rid) => rid && rid.includes('#'));
      seed = withTag ?? null;
    }
    if (!seed || !seed.includes('#')) {
      await interaction.editReply(
        '❌ Need a seed player with a full Riot ID (Name#TAG) to search from. ' +
        'None of the rostered players has a Riot ID with a tag — add one via `/update-roster edit-player`, or pass `seed_player:Name#TAG`.'
      );
      return;
    }

    await interaction.editReply(`⏳ Searching **${seed}**'s recent custom games (region **${region}**) for ${match.team1Name} vs ${match.team2Name}… this can take up to ~30s.`);

    let candidates;
    try {
      candidates = await findCustomGamesForMatch(seed, team1Roster, team2Roster, region);
    } catch (e) {
      await interaction.editReply(`❌ ${e instanceof Error ? e.message : 'Search failed.'}`);
      return;
    }

    if (candidates.length === 0) {
      await interaction.editReply(
        `No custom games found where both **${match.team1Name}** and **${match.team2Name}** appear in **${seed}**'s last 15 customs.\n` +
        '• Try a different `seed_player` from either roster.\n' +
        '• Check the `region` is correct.\n' +
        '• If you already have the match ID, skip this and use `/update-score match_ids:<id>` directly.'
      );
      return;
    }

    const lines = candidates.map((c, i) => {
      const when = c.startedAt ? ` · ${c.startedAt}` : '';
      return (
        `**${i + 1}. ${c.map}** — ${c.blueScore}:${c.redScore}${when}\n` +
        `   roster overlap: ${match.team1Name} ${c.team1PlayersFound}/${c.team1RosterSize}, ${match.team2Name} ${c.team2PlayersFound}/${c.team2RosterSize}\n` +
        `   ID: \`${c.matchId}\``
      );
    });

    const embed = new EmbedBuilder()
      .setTitle(`🔎 Candidate games — ${match.team1Name} vs ${match.team2Name}`)
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setColor(0x22c55e)
      .setFooter({ text: `Copy the right ID → /update-score match:${matchNo} match_ids:<id>  (BO3: comma-separate one per map)` });
    await interaction.editReply({ content: '', embeds: [embed] });
  },
};
