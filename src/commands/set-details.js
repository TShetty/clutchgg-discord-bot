// Update tournament details — the same fields the website's edit section
// exposes (Tournament / TournamentEvent / PrizePool in TournamentCreation.tsx).
// Only the options you provide are changed; everything else is untouched.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament } = require('../write-utils');

// Same as the website: status values and event types.
const STATUSES = ['planning', 'registration', 'in-progress', 'completed'];
const EVENT_TYPES = ['online', 'offline', 'hybrid'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

// "1:25000, 2:10000, 3:5000" → PrizePool places array.
function parsePrizePlaces(raw) {
  const places = [];
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\d+)\s*[:=]\s*(.+)$/);
    if (!m) return { error: `Couldn't read "${part.trim()}". Use position:prize pairs like \`1:25000, 2:10000\`.` };
    places.push({ position: parseInt(m[1], 10), prize: m[2].trim() });
  }
  places.sort((a, b) => a.position - b.position);
  return { places };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-details')
    .setDescription('Update tournament details — only the fields you fill in are changed')
    .addStringOption((o) => o.setName('description').setDescription('Tournament overview/description shown on the website'))
    .addStringOption((o) => o.setName('start_date').setDescription('Event start date, format YYYY-MM-DD (e.g. 2026-08-01)'))
    .addIntegerOption((o) => o.setName('max_teams').setDescription('Maximum number of teams').setMinValue(2).setMaxValue(128))
    .addStringOption((o) =>
      o.setName('event_type').setDescription('How the event is played').addChoices(...EVENT_TYPES.map((t) => ({ name: t, value: t })))
    )
    .addStringOption((o) => o.setName('location').setDescription('Venue/city — for offline or hybrid events'))
    .addStringOption((o) => o.setName('prize_total').setDescription('Total prize pool, e.g. 50000'))
    .addStringOption((o) =>
      o.setName('prize_currency').setDescription('Prize currency (default INR ₹)').addChoices(...CURRENCIES.map((c) => ({ name: c, value: c })))
    )
    .addStringOption((o) =>
      o.setName('prize_places').setDescription('Per-place prizes as position:prize pairs, e.g. "1:25000, 2:10000, 3:5000"')
    )
    .addStringOption((o) =>
      o.setName('status').setDescription('Tournament status').addChoices(...STATUSES.map((s) => ({ name: s, value: s })))
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const description = interaction.options.getString('description');
    const startDate = interaction.options.getString('start_date');
    const maxTeams = interaction.options.getInteger('max_teams');
    const eventType = interaction.options.getString('event_type');
    const location = interaction.options.getString('location');
    const prizeTotal = interaction.options.getString('prize_total');
    const prizeCurrency = interaction.options.getString('prize_currency');
    const prizePlacesRaw = interaction.options.getString('prize_places');
    const status = interaction.options.getString('status');

    if ([description, startDate, maxTeams, eventType, location, prizeTotal, prizeCurrency, prizePlacesRaw, status].every((v) => v == null)) {
      await interaction.editReply(
        'Nothing to update — provide at least one field.\n' +
        'Example: `/set-details start_date:2026-08-01 prize_total:50000 prize_places:1:25000, 2:15000, 3:10000`'
      );
      return;
    }

    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      await interaction.editReply('❌ `start_date` must be YYYY-MM-DD (e.g. `2026-08-01`).');
      return;
    }

    let parsedPlaces = null;
    if (prizePlacesRaw) {
      const res = parsePrizePlaces(prizePlacesRaw);
      if (res.error) {
        await interaction.editReply(`❌ ${res.error}`);
        return;
      }
      parsedPlaces = res.places;
    }

    const changes = [];
    await saveTournament(ctx.tournamentId, (t) => {
      if (description != null) { t.overview = description; changes.push('description'); }
      if (status != null) { t.status = status; changes.push(`status → ${status}`); }

      if (startDate != null || maxTeams != null || eventType != null || location != null || prizeTotal != null || prizeCurrency != null || parsedPlaces) {
        t.event = t.event ?? { type: 'online', startDate: '', maxTeams: 16 };
        if (startDate != null) { t.event.startDate = startDate; changes.push(`start date → ${startDate}`); }
        if (maxTeams != null) { t.event.maxTeams = maxTeams; changes.push(`max teams → ${maxTeams}`); }
        if (eventType != null) { t.event.type = eventType; changes.push(`type → ${eventType}`); }
        if (location != null) { t.event.location = location; changes.push(`location → ${location}`); }
        if (prizeTotal != null || prizeCurrency != null || parsedPlaces) {
          t.event.prizePool = t.event.prizePool ?? { places: [] };
          if (prizeTotal != null) { t.event.prizePool.total = prizeTotal; changes.push(`prize total → ${prizeTotal}`); }
          if (prizeCurrency != null) { t.event.prizePool.currency = prizeCurrency; changes.push(`currency → ${prizeCurrency}`); }
          if (parsedPlaces) { t.event.prizePool.places = parsedPlaces; changes.push(`prize places (${parsedPlaces.length})`); }
        }
      }
      return t;
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Tournament details updated')
      .setDescription(changes.map((c) => `• ${c}`).join('\n'))
      .setColor(0x22c55e)
      .setFooter({ text: 'Check /tournament to review — changes are live on clutchgg.in' });
    await interaction.editReply({ embeds: [embed] });
  },
};
