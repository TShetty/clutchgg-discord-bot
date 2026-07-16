// /setup — guided onboarding wizard. Walks an organizer from a freshly-claimed
// tournament to a fully seeded bracket without typing options by hand:
//
//   1. details  — one popup form (modal) instead of /set-details options
//   2. teams    — points at /import-teams, re-checks on a button click
//   3. bracket  — pick single/double/round-robin from a dropdown
//   4. slots    — for elimination: the wizard offers each open slot in order
//                 (Match 1 Slot 1 → Match 1 Slot 2 → …) with a dropdown of
//                 ONLY the teams not placed yet; picking one auto-advances
//   5. done     — next-step suggestions (schedule, roles, announce)
//
// Stateless by design: every interaction recomputes the current step from the
// tournament blob, so the wizard survives restarts and concurrent edits.
// All component customIds are namespaced "wiz:" and routed here from bot.js.
//
// Two-stage tournaments: the wizard drives the single/main bracket; stage 1+2
// setups are pointed at /set-bracket (same rule the website enforces).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { resolveGuildTournament } = require('./permissions');
const { getTournamentById } = require('./supabase');
const { saveTournament, tournamentHasBegun, matchHasStats } = require('./write-utils');
const { isTeamSlotName } = require('./tournament-utils');
const { generateSingleElimination, generateDoubleElimination, generateRoundRobin } = require('./bracket-gen');

const RED = 0xff4655;
const GREEN = 0x22c55e;
const PAGE_SIZE = 25; // Discord's select-menu option cap

// ── Step derivation (pure functions of the blob) ─────────────────────────────

const currentBracket = (t) => t.generatedBracket ?? t.stage1Bracket ?? null;
const detailsDone = (t) => !!t.event?.startDate;

// Open round-1 slots still carrying placeholder names (same as /assign-slot).
function openSlots(b) {
  const out = [];
  const r0 = b?.rounds?.[0] ?? [];
  r0.forEach((m, i) => {
    if (isTeamSlotName(m.team1Name)) out.push({ matchIndex: i, slot: 1, match: m });
    if (isTeamSlotName(m.team2Name)) out.push({ matchIndex: i, slot: 2, match: m });
  });
  return out;
}

function unplacedTeams(t, b) {
  const placed = new Set();
  for (const m of b?.rounds?.[0] ?? []) { placed.add(m.team1Id); placed.add(m.team2Id); }
  return (t.teams ?? []).filter((tm) => placed.has(tm.id) === false);
}

function stepOf(t) {
  if (!detailsDone(t)) return 'details';
  if ((t.teams ?? []).length < 2) return 'teams';
  const b = currentBracket(t);
  if (!b) return 'bracket';
  // Slots need filling only while there are open slots AND unplaced teams —
  // a 6-team bracket in 8 slots leaves 2 open slots with nobody to put in
  // them (byes); that still counts as seeded.
  if (b.bracketType !== 'roundrobin' && openSlots(b).length > 0 && unplacedTeams(t, b).length > 0) return 'slots';
  return 'done';
}

const STEP_ORDER = ['details', 'teams', 'bracket', 'slots', 'done'];
function progressLine(t) {
  const cur = stepOf(t);
  const names = { details: 'Details', teams: 'Teams', bracket: 'Bracket', slots: 'Seeding', done: 'Done' };
  return STEP_ORDER.map((s) => {
    const icon = STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(cur) ? '✅' : s === cur ? '▶️' : '◻';
    return `${icon} ${names[s]}`;
  }).join('  ·  ');
}

// ── Renderers — each returns a full message payload for editReply ────────────

function renderDetails(t) {
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 1 — Tournament details**\n` +
      'Click the button and fill in the form: description, start date, max teams and prize pool — ' +
      'one popup instead of typing options. You can refine any field later with `/set-details`.'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz:details').setLabel('📝 Fill in details').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function renderTeams(t) {
  const n = (t.teams ?? []).length;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 2 — Import your teams** (currently: ${n})\n` +
      '1. Run `/import-teams` with no file — the bot sends you the .xlsx template\n' +
      '2. Fill it in (Team Name, Player Name 1–7, Riot ID, Role)\n' +
      '3. Run `/import-teams file:<your file>`\n\n' +
      'Then press **Continue** — the wizard picks up where you left off.'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz:recheck').setLabel('🔄 I\'ve imported — continue').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function renderBracketStep(t) {
  const n = (t.teams ?? []).length;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 3 — Pick the bracket format** (${n} teams imported)\n` +
      '• **Single elimination** — lose once, you\'re out. You seed round 1 next.\n' +
      '• **Double elimination** — a losers bracket gives every team a second life.\n' +
      '• **Round robin** — everyone plays everyone; the schedule fills itself.\n\n' +
      '-# Two-stage event (groups → playoffs)? Use `/set-bracket stage:stage 1` / `stage:stage 2` instead.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:btype').setPlaceholder('Choose a bracket format…').addOptions(
      { label: 'Single elimination', value: 'single', emoji: '🗡️', description: 'Knockout — lose once and you\'re out' },
      { label: 'Double elimination', value: 'double', emoji: '⚔️', description: 'Winners + losers bracket' },
      { label: 'Round robin', value: 'roundrobin', emoji: '🔁', description: 'Everyone plays everyone — auto-scheduled' },
    ),
  );
  return { embeds: [embed], components: [row] };
}

// Round-1 pairing list with slot labels; ▶ marks the slot being filled now.
function pairingLines(b, target) {
  return (b.rounds[0] ?? []).map((m, i) => {
    const name = (n, s) => isTeamSlotName(n)
      ? (target && target.matchIndex === i && target.slot === s ? '**▶ choosing now…**' : `〈M${i + 1}·S${s} open〉`)
      : `**${n}**`;
    return `M${i + 1}: ${name(m.team1Name, 1)} vs ${name(m.team2Name, 2)}`;
  });
}

function renderSlots(t, page = 0) {
  const b = currentBracket(t);
  const slots = openSlots(b);
  const target = slots[0];
  const teams = unplacedTeams(t, b);
  const total = (b.rounds[0] ?? []).length * 2;
  const filled = total - slots.length;

  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 4 — Seed the bracket** (${filled}/${total} slots filled)\n` +
      `Now placing: **Match ${target.matchIndex + 1} · Slot ${target.slot}** (${target.slot === 1 ? 'top' : 'bottom'})\n` +
      'Pick a team below — only teams not yet placed are shown, and the wizard moves to the next open slot automatically.\n\n' +
      pairingLines(b, target).join('\n').slice(0, 3300)
    );

  const pages = Math.ceil(teams.length / PAGE_SIZE) || 1;
  const p = Math.min(Math.max(page, 0), pages - 1);
  const options = teams.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map((tm) => ({
    label: tm.name.slice(0, 100),
    value: tm.id,
    description: `${(tm.players ?? []).length} players`.slice(0, 100),
  }));

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`wiz:pick:${p}`)
        .setPlaceholder(`Team for Match ${target.matchIndex + 1}, Slot ${target.slot}…`)
        .addOptions(options),
    ),
  ];
  const nav = [];
  if (pages > 1) {
    nav.push(
      new ButtonBuilder().setCustomId(`wiz:page:${p - 1}`).setLabel('◀ Prev teams').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId(`wiz:page:${p + 1}`).setLabel('Next teams ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1),
    );
  }
  nav.push(new ButtonBuilder().setCustomId('wiz:finish').setLabel('Finish later').setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(...nav));
  return { embeds: [embed], components: rows };
}

function renderDone(t, note = '') {
  const b = currentBracket(t);
  const seededLines = b && b.bracketType !== 'roundrobin'
    ? '\n' + pairingLines(b, null).join('\n').slice(0, 2000)
    : '';
  const embed = new EmbedBuilder()
    .setTitle(`🎉 Setup complete — ${t.name}`)
    .setColor(GREEN)
    .setDescription(
      `${progressLine(t)}\n${note}${seededLines}\n\n**What's next:**\n` +
      '• `/update-match match:1 date:… time:… format:…` — schedule each match\n' +
      '• `/create-team-roles` — so reminders can ping the teams\n' +
      '• `/post what:upcoming matches` — announce the schedule\n' +
      '• `/lock-tournament action:lock` — freeze everything once ready\n\n' +
      'View any time with `/bracket` — it\'s live on clutchgg.in too.'
    );
  return { embeds: [embed], components: [] };
}

function renderStep(t, page = 0) {
  switch (stepOf(t)) {
    case 'details': return renderDetails(t);
    case 'teams': return renderTeams(t);
    case 'bracket': return renderBracketStep(t);
    case 'slots': return renderSlots(t, page);
    default: return renderDone(t);
  }
}

// ── The details modal ─────────────────────────────────────────────────────────

function detailsModal(t) {
  const modal = new ModalBuilder().setCustomId('wiz:dmodal').setTitle('Tournament details');
  const input = (id, label, style, required, placeholder, value) => {
    const i = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (placeholder) i.setPlaceholder(placeholder);
    if (value) i.setValue(String(value).slice(0, 4000));
    return new ActionRowBuilder().addComponents(i);
  };
  modal.addComponents(
    input('d_date', 'Start date (YYYY-MM-DD)', TextInputStyle.Short, true, '2026-08-01', t.event?.startDate),
    input('d_desc', 'Description shown on the website', TextInputStyle.Paragraph, false, 'What the tournament is about…', t.overview),
    input('d_max', 'Max teams (a number)', TextInputStyle.Short, false, '16', t.event?.maxTeams),
    input('d_total', 'Total prize pool (INR)', TextInputStyle.Short, false, '50000', t.event?.prizePool?.total),
    input('d_places', 'Per-place prizes (position:prize, comma-sep)', TextInputStyle.Short, false, '1:25000, 2:15000, 3:10000', undefined),
  );
  return modal;
}

// "1:25000, 2:10000" → PrizePool places (same parser as /set-details).
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

// ── Authorization for component interactions ─────────────────────────────────

async function orgCtx(interaction) {
  if (!interaction.guildId) return { err: 'Run this inside your tournament\'s Discord server.' };
  const ctx = await resolveGuildTournament(interaction);
  if (!ctx.link) return { err: '❌ This server isn\'t linked to a tournament yet — run `/claim-tournament` first.' };
  if (!ctx.isOrganizer) return { err: '⛔ Only this tournament\'s organizers can run setup.' };
  if (ctx.link.locked && !ctx.isSuperAdmin) return { err: '🔒 This tournament is locked — `/lock-tournament action:unlock` first.' };
  const tournament = await getTournamentById(ctx.tournamentId);
  if (!tournament) return { err: '❌ The linked tournament no longer exists on the website.' };
  return { ...ctx, tournament };
}

// ── Component/modal handlers ──────────────────────────────────────────────────

async function handle(interaction) {
  const id = interaction.customId;

  // Opening a modal must happen BEFORE any defer/reply.
  if (interaction.isButton() && id === 'wiz:details') {
    const ctx = await orgCtx(interaction);
    if (ctx.err) { await interaction.reply({ content: ctx.err, flags: MessageFlags.Ephemeral }); return; }
    await interaction.showModal(detailsModal(ctx.tournament));
    return;
  }

  // Everything else updates the wizard message in place.
  await interaction.deferUpdate();

  const ctx = await orgCtx(interaction);
  if (ctx.err) { await interaction.editReply({ content: ctx.err, embeds: [], components: [] }); return; }

  // Modal submit → save details, advance.
  if (interaction.isModalSubmit() && id === 'wiz:dmodal') {
    const date = interaction.fields.getTextInputValue('d_date').trim();
    const desc = interaction.fields.getTextInputValue('d_desc').trim();
    const max = interaction.fields.getTextInputValue('d_max').trim();
    const total = interaction.fields.getTextInputValue('d_total').trim();
    const placesRaw = interaction.fields.getTextInputValue('d_places').trim();

    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.push('Start date must be `YYYY-MM-DD` (e.g. `2026-08-01`).');
    if (max && (!/^\d+$/.test(max) || +max < 2 || +max > 128)) errs.push('Max teams must be a number between 2 and 128.');
    let places = null;
    if (placesRaw) {
      const res = parsePrizePlaces(placesRaw);
      if (res.error) errs.push(res.error); else places = res.places;
    }
    if (errs.length) {
      const embed = new EmbedBuilder().setTitle('❌ Couldn\'t save details').setColor(RED)
        .setDescription(errs.map((e) => `• ${e}`).join('\n') + '\n\nPress the button to try again — your other steps are untouched.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('wiz:details').setLabel('📝 Try again').setStyle(ButtonStyle.Primary),
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }

    const updated = await saveTournament(ctx.tournamentId, (t) => {
      t.event = t.event ?? { type: 'online', startDate: '', maxTeams: 16 };
      t.event.startDate = date;
      if (desc) t.overview = desc;
      if (max) t.event.maxTeams = +max;
      if (total || places) {
        t.event.prizePool = t.event.prizePool ?? { places: [] };
        if (total) { t.event.prizePool.total = total; t.event.prizePool.currency = t.event.prizePool.currency ?? 'INR'; }
        if (places) t.event.prizePool.places = places;
      }
      return t;
    });
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Re-check current state (teams step "continue", generic refresh).
  if (interaction.isButton() && (id === 'wiz:recheck' || id === 'wiz:start')) {
    await interaction.editReply(renderStep(ctx.tournament));
    return;
  }

  // Bracket type chosen.
  if (interaction.isStringSelectMenu() && id === 'wiz:btype') {
    const type = interaction.values[0];
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (currentBracket(t)) { return t; } // generated meanwhile — just advance
      if (tournamentHasBegun(t)) { failMsg = 'The tournament has already begun — the bracket type can no longer be set here.'; return t; }
      const teams = t.teams ?? [];
      if (teams.length < 2) { failMsg = 'Fewer than 2 teams — import teams first.'; return t; }
      t.generatedBracket =
        type === 'single' ? generateSingleElimination(teams)
        : type === 'double' ? generateDoubleElimination(teams)
        : generateRoundRobin(teams);
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    const b = currentBracket(updated);
    if (b.bracketType === 'roundrobin') {
      await interaction.editReply(renderDone(updated, '\n🔁 Round robin generated — every pairing is scheduled automatically, no seeding needed.'));
    } else {
      await interaction.editReply(renderStep(updated));
    }
    return;
  }

  // Team picked for the next open slot.
  if (interaction.isStringSelectMenu() && id.startsWith('wiz:pick:')) {
    const teamId = interaction.values[0];
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      const b = currentBracket(t);
      if (!b) { failMsg = 'The bracket disappeared — run `/setup` again.'; return t; }
      const target = openSlots(b)[0];
      if (!target) return t; // filled meanwhile — renderStep will show done
      const m = b.rounds[0][target.matchIndex];
      if (matchHasStats(m)) { failMsg = 'That match already has pulled stats — its teams are locked (website rule).'; return t; }
      const team = (t.teams ?? []).find((tm) => tm.id === teamId);
      if (!team) { failMsg = 'That team no longer exists — it may have been removed.'; return t; }
      for (const other of b.rounds[0]) {
        if (other.team1Id === team.id || other.team2Id === team.id) {
          failMsg = `**${team.name}** is already placed. Refreshing the list…`;
          return t;
        }
      }
      const prev = target.slot === 1 ? m.team1Name : m.team2Name;
      if (target.slot === 1) { m.team1Id = team.id; m.team1Name = team.name; }
      else { m.team2Id = team.id; m.team2Name = team.name; }
      m.needsAssignment = isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name);
      b.customizationHistory = b.customizationHistory ?? [];
      b.customizationHistory.push({
        timestamp: new Date().toISOString(),
        changes: `Changed ${target.slot === 1 ? 'first' : 'second'} team in round 1, match ${target.matchIndex + 1}: ${prev} → ${team.name}`,
      });
      return t;
    });
    if (failMsg) {
      // Show the error briefly by re-rendering with fresh data (stale-pick case).
      const payload = renderStep(updated);
      payload.embeds[0].setDescription(`⚠️ ${failMsg}\n\n${payload.embeds[0].data.description}`.slice(0, 4000));
      await interaction.editReply(payload);
      return;
    }
    const b2 = currentBracket(updated);
    if (stepOf(updated) !== 'slots') {
      const leftover = openSlots(b2).length;
      const note = leftover
        ? `\n🧩 Every team is placed! ${leftover} slot${leftover === 1 ? ' is' : 's are'} still empty (byes) — add more teams with \`/update-roster\` and re-run \`/setup\`, or leave them for walkovers.`
        : '\n🧩 All slots seeded!';
      await interaction.editReply(renderDone(updated, note));
    } else {
      await interaction.editReply(renderStep(updated));
    }
    return;
  }

  // Team-list pagination.
  if (interaction.isButton() && id.startsWith('wiz:page:')) {
    const page = parseInt(id.split(':')[2], 10) || 0;
    await interaction.editReply(renderStep(ctx.tournament, page));
    return;
  }

  // "Finish later" — leave with pointers to the manual commands.
  if (interaction.isButton() && id === 'wiz:finish') {
    const embed = new EmbedBuilder()
      .setTitle('👋 Setup paused')
      .setColor(RED)
      .setDescription(
        'Pick it up any time with `/setup` — it resumes exactly where you left off.\n' +
        'Prefer manual commands? `/assign-slot` fills slots one by one; `/bracket` shows what\'s open.'
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  // Unknown wiz id — just re-render.
  await interaction.editReply(renderStep(ctx.tournament));
}

module.exports = { handle, renderStep };
