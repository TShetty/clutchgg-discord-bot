const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireLinkedTournament } = require('../context');
const { matchUrl, deriveScore, realMatches } = require('../tournament-utils');

// Local YYYY-MM-DD for "today" filtering (matches how the site stores m.date).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function line({ stage, match: m, status }) {
  const { s1, s2 } = deriveScore(m);
  const score = status === 'upcoming' ? 'vs' : `${s1}:${s2}`;
  const when = m.date ? `${m.date}${m.time ? ` ${m.time}` : ''}` : 'TBD';
  const fmt = m.format ? ` · ${m.format.toUpperCase()}` : '';
  return `[${m.team1Name} **${score}** ${m.team2Name}](${matchUrl(m.id)})\n└ ${stage} · ${when}${fmt}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matches')
    .setDescription('List this tournament\'s matches — upcoming, live, today\'s, or completed')
    .addStringOption((o) =>
      o
        .setName('show')
        .setDescription('Which matches to show (default: upcoming)')
        .addChoices(
          { name: 'upcoming', value: 'upcoming' },
          { name: 'live', value: 'live' },
          { name: 'today', value: 'today' },
          { name: 'completed', value: 'completed' },
        )
    ),
  async execute(interaction) {
    const ctx = await requireLinkedTournament(interaction);
    if (!ctx) return;
    const t = ctx.tournament;
    const filter = interaction.options.getString('show') ?? 'upcoming';

    let items = realMatches(t);
    if (filter === 'today') {
      const today = todayStr();
      items = items.filter(({ match: m }) => m.date === today);
    } else {
      items = items.filter(({ status }) => status === filter);
    }

    // Order: upcoming/today soonest first; completed most recent first.
    items.sort((a, b) => {
      const ka = `${a.match.date ?? '9999'}T${a.match.time ?? '00:00'}`;
      const kb = `${b.match.date ?? '9999'}T${b.match.time ?? '00:00'}`;
      return filter === 'completed' ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });

    const TITLES = {
      upcoming: '🕐 Upcoming matches',
      live: '🔴 Live matches',
      today: "📅 Today's matches",
      completed: '✅ Completed matches',
    };

    if (items.length === 0) {
      await interaction.editReply(`No ${filter === 'today' ? "matches scheduled for today" : `${filter} matches`} in **${t.name}**.`);
      return;
    }

    const shown = items.slice(0, 10);
    const embed = new EmbedBuilder()
      .setTitle(`${TITLES[filter]} — ${t.name}`)
      .setDescription(shown.map(line).join('\n\n').slice(0, 4000))
      .setColor(filter === 'live' ? 0xe11d48 : 0x00b0f4);
    if (items.length > shown.length) {
      embed.setFooter({ text: `Showing ${shown.length} of ${items.length} — full list on clutchgg.in` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
