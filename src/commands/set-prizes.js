// Manage the prize pool incrementally — the same PrizePool model the website
// exposes (TournamentCreation.tsx: total, currency, per-placement places).
// Unlike `/set-details prize_places:` (which replaces the whole list), this lets
// organizers add/update/remove a single placement and view/clear the pool.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament } = require('../write-utils');
const { CURRENCIES, formatPrizePool, ordinal } = require('../tournament-utils');

// Ensure t.event.prizePool exists and return it.
function ensurePool(t) {
  t.event = t.event ?? { type: 'online', startDate: '', maxTeams: 16 };
  t.event.prizePool = t.event.prizePool ?? { places: [] };
  t.event.prizePool.places = t.event.prizePool.places ?? [];
  return t.event.prizePool;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-prizes')
    .setDescription('Manage the prize pool — total, currency, and per-placement prizes')
    .addSubcommand((s) =>
      s
        .setName('set-place')
        .setDescription('Add or update the prize for one placement (e.g. 1st = 25000)')
        .addIntegerOption((o) => o.setName('position').setDescription('Placement, e.g. 1 for 1st').setRequired(true).setMinValue(1).setMaxValue(64))
        .addStringOption((o) => o.setName('prize').setDescription('Prize for this place, e.g. 25000 or "Trip to LAN"').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('remove-place')
        .setDescription('Remove one placement from the prize pool')
        .addIntegerOption((o) => o.setName('position').setDescription('Placement to remove, e.g. 3').setRequired(true).setMinValue(1).setMaxValue(64))
    )
    .addSubcommand((s) =>
      s
        .setName('total')
        .setDescription('Set the total prize pool and/or currency')
        .addStringOption((o) => o.setName('amount').setDescription('Total prize pool, e.g. 50000'))
        .addStringOption((o) => o.setName('currency').setDescription('Currency (default INR ₹)').addChoices(...CURRENCIES.map((c) => ({ name: c, value: c }))))
    )
    .addSubcommand((s) => s.setName('view').setDescription('Show the current prize pool'))
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Clear the prize pool')
        .addBooleanOption((o) => o.setName('confirm').setDescription('Set true to confirm — this wipes total, currency and all places').setRequired(true))
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const sub = interaction.options.getSubcommand();

    // View is read-only — no save.
    if (sub === 'view') {
      await replyWithPool(interaction, ctx.tournament.event?.prizePool, '💰 Current prize pool');
      return;
    }

    let failMsg = null;
    let title = '✅ Prize pool updated';
    let updatedPool = null;

    await saveTournament(ctx.tournamentId, (t) => {
      if (sub === 'clear') {
        if (!interaction.options.getBoolean('confirm')) { failMsg = 'Pass `confirm:true` to wipe the prize pool.'; return t; }
        if (t.event?.prizePool) delete t.event.prizePool;
        title = '🗑️ Prize pool cleared';
        updatedPool = null;
        return t;
      }

      const pool = ensurePool(t);

      if (sub === 'set-place') {
        const position = interaction.options.getInteger('position');
        const prize = interaction.options.getString('prize').trim();
        const existing = pool.places.find((p) => p.position === position);
        if (existing) existing.prize = prize;
        else pool.places.push({ position, prize });
        pool.places.sort((a, b) => a.position - b.position);
      } else if (sub === 'remove-place') {
        const position = interaction.options.getInteger('position');
        const before = pool.places.length;
        pool.places = pool.places.filter((p) => p.position !== position);
        if (pool.places.length === before) { failMsg = `No prize is set for ${ordinal(position)} place.`; return t; }
      } else if (sub === 'total') {
        const amount = interaction.options.getString('amount');
        const currency = interaction.options.getString('currency');
        if (amount == null && currency == null) { failMsg = 'Provide `amount` and/or `currency`.'; return t; }
        if (amount != null) pool.total = amount.trim();
        if (currency != null) pool.currency = currency;
      }

      updatedPool = t.event.prizePool;
      return t;
    });

    if (failMsg) {
      await interaction.editReply(`❌ ${failMsg}`);
      return;
    }
    await replyWithPool(interaction, updatedPool, title);
  },
};

async function replyWithPool(interaction, pool, title) {
  const text = formatPrizePool(pool);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(text ?? '_No prize pool set._')
    .setColor(text ? 0x22c55e : 0x64748b)
    .setFooter({ text: 'Edit: /set-prizes set-place · view on the site: /tournament' });
  await interaction.editReply({ embeds: [embed] });
}
