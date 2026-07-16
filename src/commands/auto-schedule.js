// Bulk scheduling — set dates and times for a whole bracket in one command
// instead of running /update-match once per match. Matches are scheduled in
// bracket order (round by round), spaced by `gap` minutes, rolling over to the
// next day after `per_day` matches (or when the day would run past midnight).
//
// By default only touches matches that have NO date yet, so re-running never
// clobbers hand-tuned times; `overwrite:true` reschedules every unfinished
// match. Times are in the tournament timezone (IST unless BOT_TIMEZONE says
// otherwise) — the same wall-clock times players see on the website.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament, matchHasStats } = require('../write-utils');
const { allBrackets, effectiveStatus, MATCH_TZ } = require('../tournament-utils');

// "2026-08-01" + n days → "YYYY-MM-DD" (pure calendar math, no TZ involved).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto-schedule')
    .setDescription('Schedule ALL matches at once — first match time, gap between matches, matches per day')
    .addStringOption((o) => o.setName('start_date').setDescription('Date of the first match, YYYY-MM-DD (e.g. 2026-08-01)').setRequired(true))
    .addStringOption((o) => o.setName('start_time').setDescription('Daily first-match time, 24h HH:MM (e.g. 18:00)').setRequired(true))
    .addIntegerOption((o) => o.setName('gap').setDescription('Minutes between match start times (default 60)').setMinValue(15).setMaxValue(720))
    .addIntegerOption((o) => o.setName('per_day').setDescription('Max matches per day before rolling to the next day (default: fit until midnight)').setMinValue(1).setMaxValue(50))
    .addBooleanOption((o) => o.setName('overwrite').setDescription('Also reschedule matches that already have a date (completed matches are never touched)')),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;

    const startDate = interaction.options.getString('start_date').trim();
    const startTime = interaction.options.getString('start_time').trim();
    const gap = interaction.options.getInteger('gap') ?? 60;
    const perDay = interaction.options.getInteger('per_day') ?? 0; // 0 = fit until midnight
    const overwrite = interaction.options.getBoolean('overwrite') ?? false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      await interaction.editReply('❌ `start_date` must be YYYY-MM-DD (e.g. `2026-08-01`).');
      return;
    }
    const tm = startTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm || +tm[1] > 23 || +tm[2] > 59) {
      await interaction.editReply('❌ `start_time` must be 24h HH:MM (e.g. `18:00`).');
      return;
    }
    const dayStartMins = +tm[1] * 60 + +tm[2];

    let failMsg = null;
    let scheduled = [];
    await saveTournament(ctx.tournamentId, (t) => {
      // All matches in bracket order: stage by stage, round by round.
      const targets = [];
      for (const { label, bracket } of allBrackets(t)) {
        for (const round of bracket.rounds ?? []) {
          for (const m of round) targets.push({ stage: label, m });
        }
      }
      if (!targets.length) { failMsg = 'No bracket yet — generate one with `/setup` or `/set-bracket` first.'; return t; }

      // Which matches get (re)scheduled.
      const todo = targets.filter(({ m }) => {
        if (effectiveStatus(m) === 'completed' || matchHasStats(m)) return false; // never move played matches
        return overwrite || !m.date;
      });
      if (!todo.length) {
        failMsg = overwrite
          ? 'Nothing to schedule — every match is completed or locked.'
          : 'Every match already has a date. Re-run with `overwrite:true` to redo the schedule (completed matches stay put).';
        return t;
      }

      let date = startDate;
      let mins = dayStartMins;
      let onThisDay = 0;
      for (const { stage, m } of todo) {
        // Roll to the next day when the per-day cap is hit or we'd pass midnight.
        if ((perDay > 0 && onThisDay >= perDay) || mins > 23 * 60 + 59) {
          date = addDays(date, 1);
          mins = dayStartMins;
          onThisDay = 0;
        }
        m.date = date;
        m.time = hhmm(mins);
        scheduled.push({ stage, m, date, time: m.time });
        mins += gap;
        onThisDay += 1;
      }
      return t;
    });

    if (failMsg) {
      await interaction.editReply(`❌ ${failMsg}`);
      return;
    }

    const byDay = new Map();
    for (const s of scheduled) {
      if (!byDay.has(s.date)) byDay.set(s.date, []);
      byDay.get(s.date).push(s);
    }
    const lines = [...byDay.entries()].map(([date, items]) =>
      `**${date}** — ${items.length} match${items.length === 1 ? '' : 'es'}\n` +
      items.map((s) => `  ${s.time} · ${s.m.team1Name} vs ${s.m.team2Name} (${s.stage})`).join('\n')
    );

    const embed = new EmbedBuilder()
      .setTitle(`📅 ${scheduled.length} matches scheduled`)
      .setDescription(lines.join('\n').slice(0, 3900))
      .setColor(0x22c55e)
      .setFooter({ text: `Times in ${MATCH_TZ} · fine-tune any match with /update-match · announce with /post what:upcoming matches` });
    await interaction.editReply({ embeds: [embed] });
  },
};
