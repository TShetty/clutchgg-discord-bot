// Excel team import + template — ported from the website's excelImportUtils.ts
// so a sheet that imports on clutchgg.in imports identically here.
// Columns: Team Name | Player Name 1-7 | Riot ID 1-7 | Role 1-7.
// Slots 1-5 are the mandatory roster, 6-7 optional subs. Photos are NOT
// imported via Excel (website rule — they're added in the tournament edit UI).
const XLSX = require('xlsx');

const VALID_ROLES = ['igl', 'duelist', 'controller', 'sentinel', 'initiator'];

// riotId.ts port
function normalizeRiotId(s) {
  return s
    .normalize('NFKC')
    .replace(/\s*#\s*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizeRiotId(raw) {
  return raw
    .replace(/\r|\n/g, '')
    .replace(/\s*#\s*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse an .xlsx file buffer → { teams, errors, warnings } (same semantics as
// the website's extractTeamsFromData).
function parseTeamsXlsx(buffer) {
  const teams = [];
  const errors = [];
  const warnings = [];

  let jsonData;
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  } catch (e) {
    errors.push(`Failed to parse Excel file: ${e.message}`);
    return { teams, errors, warnings };
  }

  if (!jsonData || jsonData.length === 0) {
    errors.push('Excel file is empty or has no data');
    return { teams, errors, warnings };
  }

  const headers = Object.keys(jsonData[0]).map((h) => h.trim());

  const teamNameCol = headers.find((h) => h.toLowerCase().includes('team')) || '';
  if (!teamNameCol) {
    errors.push('Could not find "Team Name" column');
    return { teams, errors, warnings };
  }

  const playerNameCols = {};
  const roleCols = {};
  const riotIdCols = {};
  headers.forEach((h) => {
    let m = h.toLowerCase().match(/player\s*name\s*(\d+)/);
    if (m) playerNameCols[parseInt(m[1]) - 1] = h;
    m = h.toLowerCase().match(/role\s*(\d+)/);
    if (m) roleCols[parseInt(m[1]) - 1] = h;
    m = h.toLowerCase().match(/riot\s*id\s*(\d+)/);
    if (m) riotIdCols[parseInt(m[1]) - 1] = h;
  });

  if (Object.keys(playerNameCols).length === 0) {
    errors.push('Could not find any "Player Name" columns');
    return { teams, errors, warnings };
  }
  const maxPlayerIndex = Math.max(...Object.keys(playerNameCols).map(Number));

  jsonData.forEach((row, rowIndex) => {
    const lineNumber = rowIndex + 2;
    const teamName = row[teamNameCol]?.toString().trim();
    if (!teamName) {
      warnings.push(`Row ${lineNumber}: Skipped empty team name`);
      return;
    }

    const players = [];
    let mandatoryPlayerCount = 0;

    for (let index = 0; index <= maxPlayerIndex; index++) {
      const col = playerNameCols[index];
      if (!col) continue;
      const playerName = row[col]?.toString().trim();
      if (!playerName) continue;

      let role;
      const roleCol = roleCols[index];
      if (roleCol && row[roleCol]) {
        const roleValue = row[roleCol]?.toString().toLowerCase().trim();
        if (VALID_ROLES.includes(roleValue)) role = roleValue;
        else if (roleValue) {
          warnings.push(`Row ${lineNumber}: Invalid role "${roleValue}" for "${playerName}". Valid roles: ${VALID_ROLES.join(', ')}`);
        }
      }

      const riotIdCol = riotIdCols[index];
      const rawRiotId = riotIdCol ? row[riotIdCol]?.toString() : undefined;
      const riotId = rawRiotId ? sanitizeRiotId(rawRiotId) || undefined : undefined;

      players.push({ name: playerName, role, riotId });
      if (index < 5) mandatoryPlayerCount++;
    }

    if (mandatoryPlayerCount === 0) {
      warnings.push(`Row ${lineNumber}: Team "${teamName}" has no players. Skipped.`);
      return;
    }

    // Duplicate Riot IDs within the team
    const seenInTeam = new Map();
    for (const p of players) {
      if (!p.riotId) continue;
      const key = normalizeRiotId(p.riotId);
      const cur = seenInTeam.get(key);
      if (cur) cur.count++;
      else seenInTeam.set(key, { display: p.riotId, count: 1 });
    }
    for (const { display, count } of seenInTeam.values()) {
      if (count > 1) warnings.push(`Row ${lineNumber}: Team "${teamName}" lists Riot ID "${display}" ${count} times. Remove the duplicate player.`);
    }

    teams.push({ teamName, players });
  });

  // Duplicate team names across the sheet
  const teamCounts = new Map();
  for (const t of teams) {
    const key = t.teamName.trim().toLowerCase();
    const cur = teamCounts.get(key);
    if (cur) cur.count++;
    else teamCounts.set(key, { display: t.teamName, count: 1 });
  }
  for (const { display, count } of teamCounts.values()) {
    if (count > 1) warnings.push(`Team "${display}" appears ${count} times in the sheet. Each team should be listed once.`);
  }

  // Same Riot ID on multiple teams
  const riotIdToTeams = new Map();
  for (const t of teams) {
    for (const p of t.players) {
      if (!p.riotId) continue;
      const key = normalizeRiotId(p.riotId);
      const entry = riotIdToTeams.get(key) ?? { display: p.riotId, teams: new Set() };
      entry.teams.add(t.teamName);
      riotIdToTeams.set(key, entry);
    }
  }
  for (const { display, teams: onTeams } of riotIdToTeams.values()) {
    if (onTeams.size > 1) warnings.push(`Riot ID "${display}" appears on multiple teams (${[...onTeams].join(', ')}). A player should be on one team.`);
  }

  return { teams, errors, warnings };
}

// ExcelTeamData → TeamInTournament (same id scheme as the website converter).
function toTournamentTeams(excelTeams) {
  return excelTeams.map((team) => ({
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: team.teamName,
    logo: undefined,
    players: team.players.map((player) => ({
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: player.name,
      riotId: player.riotId,
      role: player.role,
    })),
  }));
}

// Template workbook as a Buffer (same columns/examples/instructions as the
// website's generateExcelTemplate, minus the browser download).
function buildTemplateBuffer() {
  const PLAYER_COUNT = 7;
  const exampleA = [
    { name: 'jinggg', riot: 'jinggg#NA1', role: 'igl' },
    { name: 'sscary', riot: 'sscary#EU1', role: 'duelist' },
    { name: 'ForSaken', riot: 'ForSaken#AP1', role: 'controller' },
    { name: 'papabrainchip', riot: 'papabrainchip#KR1', role: 'sentinel' },
    { name: 'Ghost', riot: 'Ghost#NA2', role: 'initiator' },
    { name: '', riot: '', role: '' },
    { name: '', riot: '', role: '' },
  ];
  const exampleB = [
    { name: 'FNS', riot: '', role: 'igl' },
    { name: 'Marved', riot: '', role: 'controller' },
    { name: 'Crashies', riot: '', role: 'duelist' },
    { name: 'Sick', riot: '', role: 'sentinel' },
    { name: 'Derke', riot: '', role: 'initiator' },
    { name: '', riot: '', role: '' },
    { name: '', riot: '', role: '' },
  ];

  const buildRow = (teamName, players) => {
    const row = { 'Team Name': teamName };
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const p = players[i] ?? { name: '', riot: '', role: '' };
      const n = i + 1;
      row[`Player Name ${n}`] = p.name;
      row[`Riot ID ${n}`] = p.riot;
      row[`Role ${n}`] = p.role;
    }
    return row;
  };

  const worksheet = XLSX.utils.json_to_sheet([
    buildRow('Example Team 1', exampleA),
    buildRow('Example Team 2', exampleB),
  ]);
  const cols = [{ wch: 20 }];
  for (let i = 0; i < PLAYER_COUNT; i++) cols.push({ wch: 18 }, { wch: 20 }, { wch: 14 });
  worksheet['!cols'] = cols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Teams');

  const instructions = [
    ['Tournament Teams & Players Import Template'],
    [],
    ['Instructions:'],
    ['1. Team Name (Required): Enter the name of the team'],
    ['2. Player Name 1-7: Slots 1-5 are the main roster (at least 1 required).'],
    ['   Slots 6 and 7 are OPTIONAL substitutes — leave blank if not needed.'],
    ["3. Riot ID 1-7 (Optional): Enter the player's full Riot ID as name#tag (e.g. jinggg#NA1)."],
    ['   Used to pull match history from the API. Can be filled later if a player changes their name.'],
    ['4. Role 1-7 (Optional): Use one of these roles: igl, duelist, controller, sentinel, initiator'],
    [],
    ['Player photos are NOT set here. Add them in the tournament edit section on clutchgg.in'],
    ['(upload a file or paste an image URL).'],
    [],
    ['Column order per player: Player Name N | Riot ID N | Role N  (N = 1..7)'],
  ];
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionsSheet['!cols'] = [{ wch: 72 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseTeamsXlsx, toTournamentTeams, buildTemplateBuffer, VALID_ROLES, normalizeRiotId, sanitizeRiotId };
