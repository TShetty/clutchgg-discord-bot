// Captain self-registration — an alternative to the organizer's Excel import
// (which stays untouched). A team captain runs /register-team in the
// tournament's server, fills a popup form, and the bot posts an approval card
// to the announce channel. An organizer clicks ✅ Approve → the team is added
// to the tournament (same shape as an Excel-imported team), a team role is
// created and the captain gets it immediately. ❌ Reject just closes the card.
//
// The captain is whoever submitted the form (they're in the server by
// definition), stored as `captainDiscordId` on the team. For Excel-imported
// teams — or when the captain joins Discord later — organizers link them with
// /set-captain. (Auto-detecting new members would need Discord's privileged
// GuildMembers intent, so an explicit command is the reliable path.)
//
// Stateless: the pending registration lives entirely in the approval card's
// embed — Approve parses it back out. No extra storage, survives restarts.
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { resolveGuildTournament } = require('./permissions');
const { getTournamentById } = require('./supabase');
const { saveTournament } = require('./write-utils');
const { VALID_ROLES, sanitizeRiotId } = require('./excel-import');

const SEP = ' | '; // authored separator in the approval card; pipes are stripped from user input

// ── The registration modal ────────────────────────────────────────────────────

function registrationModal() {
  const modal = new ModalBuilder().setCustomId('reg:modal').setTitle('Register your team');
  const input = (id, label, style, required, placeholder) => {
    const i = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    if (placeholder) i.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(i);
  };
  modal.addComponents(
    input('r_team', 'Team name', TextInputStyle.Short, true, 'Velocity Gaming'),
    input('r_players', 'Players — one per line: Name, Riot#tag, role', TextInputStyle.Paragraph, true,
      'Aim1, Aim1#IND, duelist\nSmokeGod, SmokeGod#IND, controller\n(5–7 lines; Riot ID and role optional)'),
  );
  return modal;
}

// "Name, Riot#tag, role" per line → player objects (same shape as Excel import).
function parsePlayers(raw) {
  const players = [];
  const warnings = [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(',').map((p) => p.replace(/\|/g, '/').trim());
    const name = parts[0];
    if (!name) continue;
    let riotId;
    let role;
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase();
      if (VALID_ROLES.includes(lower)) role = lower;
      else if (part.includes('#')) riotId = sanitizeRiotId(part) || undefined;
      else if (part) warnings.push(`"${part}" on ${name}'s line isn't a Riot#tag or a valid role (${VALID_ROLES.join('/')}) — ignored.`);
    }
    players.push({ name, riotId, role });
  }
  return { players, warnings };
}

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ── Approval card (the embed IS the pending registration) ────────────────────

function approvalCard(teamName, players, captainId) {
  return new EmbedBuilder()
    .setTitle('📥 Team registration — pending approval')
    .setColor(0xf59e0b)
    .addFields(
      { name: 'Team name', value: teamName.slice(0, 256) },
      { name: 'Captain', value: `<@${captainId}>` },
      {
        name: `Players (${players.length})`,
        value: players.map((p, i) => `${i + 1}. ${p.name}${SEP}${p.riotId ?? '—'}${SEP}${p.role ?? '—'}`).join('\n').slice(0, 1024),
      },
    )
    .setFooter({ text: 'An organizer must approve or reject this registration.' })
    .setTimestamp(new Date());
}

function parseApprovalCard(embed) {
  const field = (n) => embed.fields?.find((f) => f.name === n || f.name.startsWith(n))?.value ?? '';
  const teamName = field('Team name');
  const captainId = (field('Captain').match(/\d{15,21}/) || [null])[0];
  const players = field('Players').split('\n').map((line) => {
    const body = line.replace(/^\d+\.\s*/, '');
    const [name, riot, role] = body.split(SEP).map((s) => (s ?? '').trim());
    return {
      name,
      riotId: riot && riot !== '—' ? riot : undefined,
      role: role && role !== '—' ? role : undefined,
    };
  }).filter((p) => p.name);
  return { teamName, captainId, players };
}

const approvalButtons = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('reg:approve').setLabel('✅ Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId('reg:reject').setLabel('❌ Reject').setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = await resolveGuildTournament(interaction);
  if (!ctx.link?.channels?.announce) {
    await interaction.editReply('❌ This server isn\'t fully linked to a tournament yet — registrations can\'t be routed to the organizers.');
    return;
  }
  const t = await getTournamentById(ctx.tournamentId);
  if (!t) {
    await interaction.editReply('❌ The linked tournament no longer exists on the website.');
    return;
  }

  const teamName = interaction.fields.getTextInputValue('r_team').replace(/\|/g, '/').trim();
  const { players, warnings } = parsePlayers(interaction.fields.getTextInputValue('r_players'));

  const errs = [];
  if (!teamName) errs.push('Team name is required.');
  if ((t.teams ?? []).some((tm) => tm.name.toLowerCase() === teamName.toLowerCase())) {
    errs.push(`A team named **${teamName}** is already registered.`);
  }
  if (players.length < 5) errs.push(`Need at least 5 players (got ${players.length}) — one per line.`);
  if (players.length > 7) errs.push(`Max 7 players (got ${players.length}) — same limit as the website.`);
  const maxTeams = t.event?.maxTeams;
  if (maxTeams && (t.teams ?? []).length >= maxTeams) {
    errs.push(`The tournament is full (${maxTeams} teams).`);
  }
  if (errs.length) {
    await interaction.editReply(`❌ Registration not sent:\n${errs.map((e) => `• ${e}`).join('\n')}\n\nRun \`/register-team\` again to retry.`);
    return;
  }

  const channel = await interaction.client.channels.fetch(ctx.link.channels.announce).catch(() => null);
  if (!channel) {
    await interaction.editReply('❌ Couldn\'t reach the organizers\' channel — ask an organizer to check the bot\'s permissions.');
    return;
  }
  await channel.send({
    content: (ctx.link.discord_user_ids ?? []).map((id) => `<@${id}>`).join(' ') || undefined,
    embeds: [approvalCard(teamName, players, interaction.user.id)],
    components: [approvalButtons()],
  });

  await interaction.editReply(
    `✅ **${teamName}** submitted for approval — the organizers have been pinged.\n` +
    `You're registered as the team's captain.` +
    (warnings.length ? `\n\n⚠️ Notes:\n${warnings.map((w) => `• ${w}`).join('\n')}`.slice(0, 1500) : '')
  );
}

async function handleDecision(interaction) {
  await interaction.deferUpdate();

  const ctx = await resolveGuildTournament(interaction);
  if (!ctx.isOrganizer) {
    await interaction.followUp({ content: '⛔ Only organizers can approve or reject registrations.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = interaction.message.embeds[0];
  if (!embed) return;
  const { teamName, captainId, players } = parseApprovalCard(embed);

  if (interaction.customId === 'reg:reject') {
    const closed = EmbedBuilder.from(embed)
      .setTitle(`🚫 Team registration — rejected`)
      .setColor(0xef4444)
      .setFooter({ text: `Rejected by ${interaction.user.tag}` });
    await interaction.editReply({ embeds: [closed], components: [] });
    return;
  }

  // Approve.
  let failMsg = null;
  await saveTournament(ctx.tournamentId, (t) => {
    if ((t.teams ?? []).some((tm) => tm.name.toLowerCase() === teamName.toLowerCase())) {
      failMsg = `A team named **${teamName}** was registered in the meantime.`;
      return t;
    }
    const maxTeams = t.event?.maxTeams;
    if (maxTeams && (t.teams ?? []).length >= maxTeams) {
      failMsg = `The tournament is already full (${maxTeams} teams).`;
      return t;
    }
    t.teams = t.teams ?? [];
    t.teams.push({
      id: newId('team'),
      name: teamName,
      captainDiscordId: captainId ?? undefined,
      players: players.map((p) => ({ id: newId('player'), name: p.name, riotId: p.riotId, role: p.role })),
    });
    return t;
  });

  if (failMsg) {
    const closed = EmbedBuilder.from(embed)
      .setTitle('🚫 Team registration — could not approve')
      .setColor(0xef4444)
      .setFooter({ text: failMsg.replace(/\*/g, '') });
    await interaction.editReply({ embeds: [closed], components: [] });
    return;
  }

  // Automation: create the team role and hand it to the captain right away.
  let roleNote = '';
  try {
    const guild = interaction.guild;
    if (guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const roles = await guild.roles.fetch();
      let role = roles.find((r) => r.name.toLowerCase() === teamName.toLowerCase() && !r.managed);
      if (!role) role = await guild.roles.create({ name: teamName, mentionable: true, reason: `ClutchGG team registration approved` });
      if (captainId) {
        const member = await guild.members.fetch(captainId).catch(() => null);
        if (member) { await member.roles.add(role); roleNote = ` Role ${role} created and given to the captain — teammates get it as they're assigned.`; }
        else roleNote = ` Role ${role} created — assign it to the players once they join the server.`;
      }
    } else {
      roleNote = ' (No Manage Roles permission — run /create-team-roles later for reminder pings.)';
    }
  } catch (e) {
    console.error('[REG] role automation failed:', e.message);
  }

  const approved = EmbedBuilder.from(embed)
    .setTitle('✅ Team registration — approved')
    .setColor(0x22c55e)
    .setFooter({ text: `Approved by ${interaction.user.tag}` });
  await interaction.editReply({ embeds: [approved], components: [] });
  await interaction.followUp({
    content: `🎉 **${teamName}** is in!${captainId ? ` Captain: <@${captainId}>.` : ''}${roleNote}\n-# View rosters with \`/teams\` · seed the bracket with \`/setup\``,
  });
}

async function handle(interaction) {
  if (interaction.isModalSubmit() && interaction.customId === 'reg:modal') return handleModal(interaction);
  if (interaction.isButton() && (interaction.customId === 'reg:approve' || interaction.customId === 'reg:reject')) {
    return handleDecision(interaction);
  }
}

module.exports = { handle, registrationModal };
