// /setup — guided onboarding wizard. Walks an organizer from a freshly-claimed
// tournament to a fully seeded bracket without typing options by hand:
//
//   1. details  — one popup form (modal) instead of /set-details options
//   2. teams    — points at /import-teams, re-checks on a button click
//   3. bracket  — single-stage vs two-stage, then the format dropdowns
//                 (two-stage: stage 1 format → points/qualifiers/groups)
//   4. slots    — for elimination: the wizard offers each open slot in order
//                 (Match 1 Slot 1 → Match 1 Slot 2 → …) with a dropdown of
//                 ONLY the teams not placed yet; picking one auto-advances
//   5. stage2   — two-stage only: playoff format (single/double) or Skip
//   6. done     — next-step suggestions (schedule, roles, announce)
//
// Stateless by design: every interaction recomputes the current step from the
// tournament blob, so the wizard survives restarts and concurrent edits.
// Transient choices (format, points-per-win) ride in customIds; everything
// durable (stage1Config, groups, brackets) is written to the blob immediately.
// All component customIds are namespaced "wiz:" and routed here from bot.js.
//
// Two-stage tournaments (website parity — TwoStageTournamentModal.tsx):
// the bracket step first asks single-stage vs two-stage. Two-stage walks
// stage 1 format (single/double/roundrobin/groupstage) → points per win
// (rr/groups) → qualifiers (or group setup + qualify-per-group) → stage 1
// bracket → stage 2 format (single/double, or Skip → /set-bracket later).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { resolveGuildTournament } = require('./permissions');
const { getTournamentById } = require('./supabase');
const { saveTournament, tournamentHasBegun, matchHasStats } = require('./write-utils');
const { isTeamSlotName } = require('./tournament-utils');
const { generateSingleElimination, generateDoubleElimination, generateRoundRobin, generateGroupStage, scopeBracketIds } = require('./bracket-gen');

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
  // Two-stage group stage mid-setup: groups chosen but not yet filled/finalized.
  const cfg = t.stage1Config;
  if (cfg?.format === 'groupstage' && !t.stage1Bracket) {
    const groups = cfg.groups ?? [];
    if (groups.length === 0 || groups.some((g) => (g.teams ?? []).length === 0)) return 'groups';
    if (!cfg.teamsQualifyingPerGroup) return 'gqual';
  }
  const b = currentBracket(t);
  if (!b) return 'bracket';
  // Slots need filling only while there are open slots AND unplaced teams —
  // a 6-team bracket in 8 slots leaves 2 open slots with nobody to put in
  // them (byes); that still counts as seeded.
  if (b.bracketType !== 'roundrobin' && openSlots(b).length > 0 && unplacedTeams(t, b).length > 0) return 'slots';
  // Two-stage: stage 1 done → offer stage 2 until it exists (Skip just defers).
  if (t.stage1Bracket && !t.stage2Bracket) return 'stage2';
  return 'done';
}

// groups/gqual are sub-steps of the bracket step for progress display.
const normStep = (s) => (s === 'groups' || s === 'gqual' ? 'bracket' : s);

function progressLine(t) {
  const cur = normStep(stepOf(t));
  const twoStage = !!t.stage1Config || !!t.stage1Bracket || !!t.stage2Bracket;
  const order = twoStage
    ? ['details', 'teams', 'bracket', 'slots', 'stage2', 'done']
    : ['details', 'teams', 'bracket', 'slots', 'done'];
  const names = { details: 'Details', teams: 'Teams', bracket: 'Bracket', slots: 'Seeding', stage2: 'Stage 2', done: 'Done' };
  return order.map((s) => {
    const icon = order.indexOf(s) < order.indexOf(cur) ? '✅' : s === cur ? '▶️' : '◻';
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

// Step 3 entry: single-stage vs two-stage (website: tournament type toggle +
// TwoStageTournamentModal).
function renderBracketStep(t) {
  const n = (t.teams ?? []).length;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 3 — Tournament structure** (${n} teams imported)\n` +
      '• **Single stage** — one bracket start to finish (single/double elim or round robin).\n' +
      '• **Two stage** — a qualifying Stage 1 (incl. group stage) feeds a Stage 2 playoff bracket.\n\n' +
      '-# Same options as the website. Prefer commands? `/set-bracket` works stage by stage.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:mode').setPlaceholder('Single stage or two stage?').addOptions(
      { label: 'Single stage', value: 'single', emoji: '🏆', description: 'One bracket for the whole event' },
      { label: 'Two stage', value: 'two', emoji: '🎯', description: 'Stage 1 qualifying → Stage 2 playoffs' },
    ),
  );
  return { embeds: [embed], components: [row] };
}

const backRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('wiz:recheck').setLabel('↩ Back').setStyle(ButtonStyle.Secondary),
);

// Single-stage: the original 3-format menu.
function renderSingleFormat(t) {
  const n = (t.teams ?? []).length;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Step 3 — Pick the bracket format** (${n} teams imported)\n` +
      '• **Single elimination** — lose once, you\'re out. You seed round 1 next.\n' +
      '• **Double elimination** — a losers bracket gives every team a second life.\n' +
      '• **Round robin** — everyone plays everyone; the schedule fills itself.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:btype').setPlaceholder('Choose a bracket format…').addOptions(
      { label: 'Single elimination', value: 'single', emoji: '🗡️', description: 'Knockout — lose once and you\'re out' },
      { label: 'Double elimination', value: 'double', emoji: '⚔️', description: 'Winners + losers bracket' },
      { label: 'Round robin', value: 'roundrobin', emoji: '🔁', description: 'Everyone plays everyone — auto-scheduled' },
    ),
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// Two-stage: Stage 1 format — the website's 4 options (TwoStageTournamentModal).
function renderStage1Format(t) {
  const n = (t.teams ?? []).length;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Stage 1 format** (${n} teams participating in Stage 1)\n` +
      '• **Single elimination** — one loss and you\'re out. Top finishers qualify.\n' +
      '• **Double elimination** — two losses to be eliminated. LB winner can still qualify.\n' +
      '• **Round robin** — everyone plays each other. Top N by standings advance.\n' +
      '• **Group stage** — teams split into groups; top teams per group advance.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:s1fmt').setPlaceholder('Choose the Stage 1 format…').addOptions(
      { label: 'Single Elimination', value: 'single', emoji: '🗡️', description: 'One loss and you\'re out. Top finishers qualify.' },
      { label: 'Double Elimination', value: 'double', emoji: '⚔️', description: 'Two losses to be eliminated.' },
      { label: 'Round Robin', value: 'roundrobin', emoji: '🔁', description: 'Everyone plays each other. Top N advance.' },
      { label: 'Group Stage', value: 'groupstage', emoji: '🔢', description: 'Groups; top teams per group advance.' },
    ),
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// Points per match win (round robin / group stage standings). Website default 3.
function renderPoints(t, fmt) {
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Points per win** — ${fmt === 'groupstage' ? 'group stage' : 'round robin'} standings rank by total points (wins × this value). The website default is **3**.`
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`wiz:s1p:${fmt}`).setPlaceholder('Points per match win…').addOptions(
      Array.from({ length: 10 }, (_, i) => ({
        label: `${i + 1}${i + 1 === 3 ? ' (default)' : ''}`,
        value: String(i + 1),
      })),
    ),
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// Teams advancing to Stage 2 — same options as the website: [2,4,6,8,16] < teams.
function renderS1Qualifiers(t, fmt, ppw) {
  const n = (t.teams ?? []).length;
  let opts = [2, 4, 6, 8, 16].filter((q) => q < n);
  if (opts.length === 0) opts = [2];
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Teams advancing to Stage 2**\n` +
      `Top teams by final Stage 1 ranking will advance to the Stage 2 playoff bracket. (${n} teams in Stage 1.)`
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`wiz:s1q:${fmt}:${ppw ?? 0}`).setPlaceholder('How many teams qualify?').addOptions(
      opts.map((q) => ({ label: `Top ${q} teams`, value: String(q) })),
    ),
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// Group stage: number of groups — website options [2,3,4,6].
function renderGroupCount(t, ppw) {
  const n = (t.teams ?? []).length;
  const opts = [2, 3, 4, 6].filter((g) => g <= n / 2 || g === 2);
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Group stage setup** — ${n} teams\n` +
      'Pick the number of groups; you assign teams to each group next.\n' +
      opts.map((g) => `• **${g} groups** → ~${Math.ceil(n / g)} teams per group`).join('\n')
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`wiz:s1g:${ppw ?? 0}`).setPlaceholder('Number of groups…').addOptions(
      opts.map((g) => ({ label: `${g} groups`, value: String(g), description: `~${Math.ceil(n / g)} teams per group` })),
    ),
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// Teams not yet assigned to any group.
function unassignedTeams(t) {
  const cfg = t.stage1Config;
  const assigned = new Set((cfg?.groups ?? []).flatMap((g) => (g.teams ?? []).map((tm) => tm.id)));
  return (t.teams ?? []).filter((tm) => !assigned.has(tm.id));
}

// Group stage: fill the first empty group with a multi-select of unassigned
// teams. The remaining empty groups each need at least one team, so the max
// picks leave one per group; the last empty group auto-receives the leftovers.
function renderGroups(t) {
  const cfg = t.stage1Config;
  const groups = cfg.groups ?? [];
  const gi = groups.findIndex((g) => (g.teams ?? []).length === 0);
  const pool = unassignedTeams(t);
  const emptyAfter = groups.filter((g, i) => i > gi && (g.teams ?? []).length === 0).length;
  const maxPick = Math.min(25, Math.max(1, pool.length - emptyAfter));
  const filledLines = groups
    .filter((g) => (g.teams ?? []).length > 0)
    .map((g) => `**${g.name}**: ${g.teams.map((tm) => tm.name).join(', ')}`);
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      (`${progressLine(t)}\n\n**Assign teams to ${groups[gi].name}** (${pool.length} unassigned)\n` +
      `Pick every team for this group in one go — you can select up to ${maxPick}. ` +
      (emptyAfter === 0 ? 'Teams you leave out stay unassigned — pick them all.' : 'Left-over teams flow to the remaining groups; the last group fills automatically.') +
      (filledLines.length ? `\n\n${filledLines.join('\n')}` : '') +
      (pool.length > 25 ? '\n\n-# More than 25 unassigned teams — this menu shows the first 25; the rest appear for later groups.' : '')
      ).slice(0, 4000)
    );
  const options = pool.slice(0, 25).map((tm) => ({
    label: tm.name.slice(0, 100),
    value: tm.id,
    description: `${(tm.players ?? []).length} players`.slice(0, 100),
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`wiz:gpick:${gi}`)
      .setPlaceholder(`Teams for ${groups[gi].name}…`)
      .setMinValues(1)
      .setMaxValues(Math.min(maxPick, options.length))
      .addOptions(options),
  );
  return { embeds: [embed], components: [row, groupResetRow()] };
}

// Redo the group setup from scratch (wrong group count / assignments).
const groupResetRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('wiz:greset').setLabel('🔄 Start group setup over').setStyle(ButtonStyle.Secondary),
);

// Group stage: how many teams qualify per group (website: 1..min group size - 1).
function renderGQual(t) {
  const cfg = t.stage1Config;
  const groups = cfg.groups ?? [];
  const minSize = Math.min(...groups.map((g) => (g.teams ?? []).length));
  const maxQualify = Math.max(1, minSize - 1);
  const groupLines = groups.map((g) => `**${g.name}** (${g.teams.length}): ${g.teams.map((tm) => tm.name).join(', ')}`);
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Teams qualifying per group for Stage 2**\n` +
      `${groupLines.join('\n').slice(0, 3000)}\n\n` +
      'Each group plays round-robin; the top N per group advance.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:gq').setPlaceholder('Teams qualifying per group…').addOptions(
      Array.from({ length: Math.min(25, maxQualify) }, (_, i) => ({
        label: `Top ${i + 1} per group`,
        value: String(i + 1),
        description: `${groups.length * (i + 1)} total teams advance to Stage 2`,
      })),
    ),
  );
  return { embeds: [embed], components: [row, groupResetRow()] };
}

// Stage 2 format — single/double only (website Stage2Format), plus Skip.
function renderStage2(t) {
  const q = t.stage1Config?.qualifiersCount ?? 0;
  const embed = new EmbedBuilder()
    .setTitle(`🧭 Setup — ${t.name}`)
    .setColor(RED)
    .setDescription(
      `${progressLine(t)}\n\n**Stage 2 — playoff bracket** (${q} teams will qualify from Stage 1)\n` +
      'Pick the playoff format now — the bracket is generated with empty slots you fill with ' +
      '`/assign-slot stage:stage 2` once Stage 1 finishes.\n' +
      'Or **Skip** and set it later with `/set-bracket stage:stage 2`.'
    );
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz:s2fmt').setPlaceholder('Stage 2 format…').addOptions(
      { label: 'Single Elimination', value: 'single', emoji: '🗡️', description: 'Straight knockout playoffs' },
      { label: 'Double Elimination', value: 'double', emoji: '⚔️', description: 'Winners + losers playoff bracket' },
    ),
  );
  const skip = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz:s2skip').setLabel('⏭ Skip — set later with /set-bracket').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, skip] };
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
    case 'groups': return renderGroups(t);
    case 'gqual': return renderGQual(t);
    case 'slots': return renderSlots(t, page);
    case 'stage2': return renderStage2(t);
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

  // Structure chosen: single-stage → 3-format menu; two-stage → Stage 1 formats.
  if (interaction.isStringSelectMenu() && id === 'wiz:mode') {
    await interaction.editReply(interaction.values[0] === 'two' ? renderStage1Format(ctx.tournament) : renderSingleFormat(ctx.tournament));
    return;
  }

  // Single-stage bracket type chosen.
  if (interaction.isStringSelectMenu() && id === 'wiz:btype') {
    const type = interaction.values[0];
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (currentBracket(t)) { return t; } // generated meanwhile — just advance
      if (tournamentHasBegun(t)) { failMsg = 'The tournament has already begun — the bracket type can no longer be set here.'; return t; }
      const teams = t.teams ?? [];
      if (teams.length < 2) { failMsg = 'Fewer than 2 teams — import teams first.'; return t; }
      t.tournamentType = 'single';
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

  // Stage 1 format chosen → points (rr/groups) or straight to qualifiers.
  if (interaction.isStringSelectMenu() && id === 'wiz:s1fmt') {
    const fmt = interaction.values[0];
    if (fmt === 'roundrobin' || fmt === 'groupstage') {
      await interaction.editReply(renderPoints(ctx.tournament, fmt));
    } else {
      await interaction.editReply(renderS1Qualifiers(ctx.tournament, fmt, null));
    }
    return;
  }

  // Points per win chosen → qualifiers (rr) or group count (groupstage).
  if (interaction.isStringSelectMenu() && id.startsWith('wiz:s1p:')) {
    const fmt = id.split(':')[2];
    const ppw = parseInt(interaction.values[0], 10) || 3;
    if (fmt === 'groupstage') {
      await interaction.editReply(renderGroupCount(ctx.tournament, ppw));
    } else {
      await interaction.editReply(renderS1Qualifiers(ctx.tournament, fmt, ppw));
    }
    return;
  }

  // Qualifiers chosen (single/double/roundrobin Stage 1) → generate Stage 1.
  if (interaction.isStringSelectMenu() && id.startsWith('wiz:s1q:')) {
    const [, , fmt, ppwRaw] = id.split(':');
    const ppw = parseInt(ppwRaw, 10) || 0;
    const qualifiers = parseInt(interaction.values[0], 10);
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (currentBracket(t)) { return t; } // generated meanwhile — just advance
      if (tournamentHasBegun(t)) { failMsg = 'The tournament has already begun — the bracket type can no longer be set here.'; return t; }
      const teams = t.teams ?? [];
      if (teams.length < 2) { failMsg = 'Fewer than 2 teams — import teams first.'; return t; }
      if (qualifiers >= teams.length) { failMsg = `Qualifiers (${qualifiers}) must be smaller than the number of teams (${teams.length}).`; return t; }
      const bracket =
        fmt === 'single' ? generateSingleElimination(teams)
        : fmt === 'double' ? generateDoubleElimination(teams)
        : generateRoundRobin(teams);
      if (fmt === 'roundrobin' && ppw) bracket.pointsPerWin = ppw;
      t.tournamentType = 'group';
      t.stage1Config = { format: fmt, qualifiersCount: qualifiers, ...(ppw ? { pointsPerWin: ppw } : {}) };
      // Website parity: non-groupstage stage brackets get id-scoped so stage 1
      // and stage 2 match ids never collide (the website resolves by id).
      t.stage1Bracket = scopeBracketIds(bracket, t.id);
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Group count chosen → create empty groups, then the assignment loop.
  if (interaction.isStringSelectMenu() && id.startsWith('wiz:s1g:')) {
    const ppw = parseInt(id.split(':')[2], 10) || 0;
    const count = parseInt(interaction.values[0], 10);
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (currentBracket(t)) { return t; }
      if (tournamentHasBegun(t)) { failMsg = 'The tournament has already begun — the bracket type can no longer be set here.'; return t; }
      if ((t.teams ?? []).length < count * 2) { failMsg = `${count} groups need at least ${count * 2} teams (2 per group) — only ${(t.teams ?? []).length} imported.`; return t; }
      t.tournamentType = 'group';
      t.stage1Config = {
        format: 'groupstage',
        qualifiersCount: 0,
        ...(ppw ? { pointsPerWin: ppw } : {}),
        groups: Array.from({ length: count }, (_, i) => ({ id: `group_${i}`, name: `Group ${String.fromCharCode(65 + i)}`, teams: [] })),
      };
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Teams picked for a group (multi-select). The last empty group auto-receives
  // whatever remains — with every team required in a group, that's the only outcome.
  if (interaction.isStringSelectMenu() && id.startsWith('wiz:gpick:')) {
    const gi = parseInt(id.split(':')[2], 10);
    const picked = interaction.values;
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      const cfg = t.stage1Config;
      if (!cfg || cfg.format !== 'groupstage' || !cfg.groups?.[gi]) { failMsg = 'The group setup changed — run `/setup` again.'; return t; }
      if (cfg.groups[gi].teams.length > 0) { return t; } // filled meanwhile — advance
      const byId = new Map((t.teams ?? []).map((tm) => [tm.id, tm]));
      const already = new Set(cfg.groups.flatMap((g) => g.teams.map((tm) => tm.id)));
      cfg.groups[gi].teams = picked
        .filter((tid) => byId.has(tid) && !already.has(tid))
        .map((tid) => ({ id: tid, name: byId.get(tid).name }));
      if (cfg.groups[gi].teams.length === 0) { failMsg = 'None of those teams are still available — refreshing.'; return t; }
      // Auto-fill the last remaining empty group with the leftover teams.
      const empties = cfg.groups.filter((g) => g.teams.length === 0);
      if (empties.length === 1) {
        const assigned = new Set(cfg.groups.flatMap((g) => g.teams.map((tm) => tm.id)));
        empties[0].teams = (t.teams ?? []).filter((tm) => !assigned.has(tm.id)).map((tm) => ({ id: tm.id, name: tm.name }));
      }
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Start group setup over — only while no stage 1 bracket exists yet.
  if (interaction.isButton() && id === 'wiz:greset') {
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (t.stage1Config?.format === 'groupstage' && !t.stage1Bracket) {
        delete t.stage1Config;
        delete t.tournamentType;
      }
      return t;
    });
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Qualify-per-group chosen → generate the group-stage bracket (website structure).
  if (interaction.isStringSelectMenu() && id === 'wiz:gq') {
    const per = parseInt(interaction.values[0], 10);
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      const cfg = t.stage1Config;
      if (!cfg || cfg.format !== 'groupstage' || !(cfg.groups ?? []).length) { failMsg = 'The group setup changed — run `/setup` again.'; return t; }
      if (t.stage1Bracket) { return t; }
      const minSize = Math.min(...cfg.groups.map((g) => g.teams.length));
      if (per >= minSize) { failMsg = `Top ${per} per group needs every group to have more than ${per} teams (smallest has ${minSize}).`; return t; }
      cfg.teamsQualifyingPerGroup = per;
      cfg.qualifiersCount = cfg.groups.length * per;
      t.stage1Bracket = generateGroupStage(cfg.groups, cfg.pointsPerWin);
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    await interaction.editReply(renderStep(updated));
    return;
  }

  // Stage 2 format chosen → empty playoff bracket at qualifier size.
  if (interaction.isStringSelectMenu() && id === 'wiz:s2fmt') {
    const fmt = interaction.values[0];
    let failMsg = null;
    const updated = await saveTournament(ctx.tournamentId, (t) => {
      if (t.stage2Bracket) { return t; } // generated meanwhile — just advance
      const q = t.stage1Config?.qualifiersCount;
      if (!q || q < 2) { failMsg = 'Stage 1 has no qualifier count — set the bracket with `/set-bracket stage:stage 2` instead.'; return t; }
      t.stage2Format = fmt;
      const bracket = fmt === 'single'
        ? generateSingleElimination(t.teams ?? [], q)
        : generateDoubleElimination(t.teams ?? [], q);
      t.stage2Bracket = scopeBracketIds(bracket, t.id);
      return t;
    });
    if (failMsg) {
      await interaction.editReply({ content: `❌ ${failMsg}`, embeds: [], components: [] });
      return;
    }
    await interaction.editReply(renderDone(updated,
      '\n🎯 Stage 2 bracket created with empty slots — once Stage 1 finishes, place the qualifiers with `/assign-slot stage:stage 2`.'));
    return;
  }

  // Stage 2 skipped — Stage 1 is ready; /set-bracket handles Stage 2 later.
  if (interaction.isButton() && id === 'wiz:s2skip') {
    const embed = new EmbedBuilder()
      .setTitle(`✅ Stage 1 ready — ${ctx.tournament.name}`)
      .setColor(GREEN)
      .setDescription(
        'Stage 2 is deferred. When you\'re ready (any time, even after Stage 1 finishes):\n' +
        '• `/set-bracket type:… stage:stage 2` — create the playoff bracket\n' +
        '• `/assign-slot stage:stage 2` — place the qualified teams\n\n' +
        'Re-running `/setup` also brings this step back.'
      );
    await interaction.editReply({ embeds: [embed], components: [] });
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
    const after = stepOf(updated);
    if (after === 'done') {
      const leftover = openSlots(b2).length;
      const note = leftover
        ? `\n🧩 Every team is placed! ${leftover} slot${leftover === 1 ? ' is' : 's are'} still empty (byes) — add more teams with \`/update-roster\` and re-run \`/setup\`, or leave them for walkovers.`
        : '\n🧩 All slots seeded!';
      await interaction.editReply(renderDone(updated, note));
    } else {
      // Still seeding — or, on two-stage events, seeding done and Stage 2 is next.
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
