// Roster editing — the same fields the website's team edit section exposes:
// team name/description, player name, Riot ID, role. Player photos are
// website-only (upload/URL), same as the Excel import rule.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireOrganizer, saveTournament } = require('../write-utils');
const { sanitizeRiotId } = require('../excel-import');

const ROLES = ['igl', 'duelist', 'controller', 'sentinel', 'initiator'];
const roleChoices = ROLES.map((r) => ({ name: r, value: r }));

function findTeam(t, query) {
  const q = query.trim().toLowerCase();
  const teams = t.teams ?? [];
  return teams.find((tm) => tm.name.toLowerCase() === q) || teams.find((tm) => tm.name.toLowerCase().includes(q));
}

function findPlayer(team, query) {
  const q = query.trim().toLowerCase();
  const players = team.players ?? [];
  return players.find((p) => p.name.toLowerCase() === q) || players.find((p) => p.name.toLowerCase().includes(q));
}

const ok = (msg) => new EmbedBuilder().setTitle('✅ Roster updated').setDescription(msg).setColor(0x22c55e)
  .setFooter({ text: 'Live on clutchgg.in · verify with /roster' });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update-roster')
    .setDescription('Edit teams and players — add/remove/rename, set Riot IDs and roles')
    .addSubcommand((s) =>
      s.setName('add-team').setDescription('Add a new empty team')
        .addStringOption((o) => o.setName('name').setDescription('Team name').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('rename-team').setDescription('Rename a team')
        .addStringOption((o) => o.setName('team').setDescription('Current team name').setRequired(true))
        .addStringOption((o) => o.setName('new_name').setDescription('New team name').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('remove-team').setDescription('Remove a team from the tournament')
        .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('add-player').setDescription('Add a player to a team')
        .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true))
        .addStringOption((o) => o.setName('name').setDescription('Player display name').setRequired(true))
        .addStringOption((o) => o.setName('riot_id').setDescription('Riot ID as name#tag (optional, used for stats)'))
        .addStringOption((o) => o.setName('role').setDescription('Player role (optional)').addChoices(...roleChoices))
    )
    .addSubcommand((s) =>
      s.setName('edit-player').setDescription("Change a player's name, Riot ID or role")
        .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true))
        .addStringOption((o) => o.setName('player').setDescription('Current player name').setRequired(true))
        .addStringOption((o) => o.setName('new_name').setDescription('New display name (optional)'))
        .addStringOption((o) => o.setName('riot_id').setDescription('New Riot ID as name#tag (optional)'))
        .addStringOption((o) => o.setName('role').setDescription('New role (optional)').addChoices(...roleChoices))
    )
    .addSubcommand((s) =>
      s.setName('remove-player').setDescription('Remove a player from a team')
        .addStringOption((o) => o.setName('team').setDescription('Team name').setRequired(true))
        .addStringOption((o) => o.setName('player').setDescription('Player name').setRequired(true))
    ),
  ephemeral: true,
  async execute(interaction) {
    const ctx = await requireOrganizer(interaction);
    if (!ctx) return;
    const sub = interaction.options.getSubcommand();

    let reply = null;
    let fail = null;

    await saveTournament(ctx.tournamentId, (t) => {
      t.teams = t.teams ?? [];

      if (sub === 'add-team') {
        const name = interaction.options.getString('name').trim();
        if (findTeam(t, name)?.name.toLowerCase() === name.toLowerCase()) {
          fail = `A team named **${name}** already exists.`;
          return t;
        }
        t.teams.push({ id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name, players: [] });
        reply = `Added team **${name}**. Add players with \`/update-roster add-player\`.`;
        return t;
      }

      const team = findTeam(t, interaction.options.getString('team'));
      if (!team) {
        const names = (t.teams ?? []).map((tm) => `• ${tm.name}`).join('\n') || '(none)';
        fail = `No team matching **${interaction.options.getString('team')}**. Teams:\n${names}`;
        return t;
      }

      if (sub === 'rename-team') {
        const newName = interaction.options.getString('new_name').trim();
        const old = team.name;
        team.name = newName;
        // Keep bracket slot names in sync, same as the website does when a team renames.
        for (const b of [t.generatedBracket, t.stage1Bracket, t.stage2Bracket, t.knockoutBracket]) {
          if (!b) continue;
          for (const m of b.rounds.flat()) {
            if (m.team1Id === team.id) m.team1Name = newName;
            if (m.team2Id === team.id) m.team2Name = newName;
          }
        }
        reply = `Renamed **${old}** → **${newName}** (bracket updated too).`;
      } else if (sub === 'remove-team') {
        const inBracket = [t.generatedBracket, t.stage1Bracket, t.stage2Bracket, t.knockoutBracket]
          .filter(Boolean)
          .some((b) => b.rounds.flat().some((m) => m.team1Id === team.id || m.team2Id === team.id));
        if (inBracket) {
          fail = `**${team.name}** is placed in the bracket — remove it from its bracket slots on the website first, then retry.`;
          return t;
        }
        t.teams = t.teams.filter((tm) => tm.id !== team.id);
        reply = `Removed team **${team.name}**.`;
      } else if (sub === 'add-player') {
        const name = interaction.options.getString('name').trim();
        const riotRaw = interaction.options.getString('riot_id');
        const role = interaction.options.getString('role') ?? undefined;
        team.players = team.players ?? [];
        team.players.push({
          id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name,
          riotId: riotRaw ? sanitizeRiotId(riotRaw) : undefined,
          role,
        });
        reply = `Added **${name}** to **${team.name}**${role ? ` as ${role}` : ''}.`;
      } else if (sub === 'edit-player') {
        const player = findPlayer(team, interaction.options.getString('player'));
        if (!player) {
          fail = `No player matching **${interaction.options.getString('player')}** on **${team.name}**.`;
          return t;
        }
        const newName = interaction.options.getString('new_name');
        const riotRaw = interaction.options.getString('riot_id');
        const role = interaction.options.getString('role');
        const changes = [];
        if (newName) {
          // Preserve stat-matching history like the website: push old identity.
          player.nameHistory = player.nameHistory ?? [];
          player.nameHistory.push({ name: player.name, riotId: player.riotId });
          changes.push(`name → ${newName}`);
          player.name = newName.trim();
        }
        if (riotRaw) { player.riotId = sanitizeRiotId(riotRaw); changes.push(`Riot ID → ${player.riotId}`); }
        if (role) { player.role = role; changes.push(`role → ${role}`); }
        if (!changes.length) {
          fail = 'Nothing to change — provide new_name, riot_id, or role.';
          return t;
        }
        reply = `Updated **${player.name}** on **${team.name}**: ${changes.join(', ')}.`;
      } else if (sub === 'remove-player') {
        const player = findPlayer(team, interaction.options.getString('player'));
        if (!player) {
          fail = `No player matching **${interaction.options.getString('player')}** on **${team.name}**.`;
          return t;
        }
        team.players = (team.players ?? []).filter((p) => p.id !== player.id);
        reply = `Removed **${player.name}** from **${team.name}**.`;
      }
      return t;
    });

    if (fail) await interaction.editReply(`❌ ${fail}`);
    else await interaction.editReply({ embeds: [ok(reply)] });
  },
};
