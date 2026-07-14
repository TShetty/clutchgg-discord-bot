// Pure derivations over the tournament blob — ported 1:1 from the website so
// the bot always agrees with what clutchgg.in shows (Rule 1 in INSTRUCTIONS.md).
// Sources: src/app/utils/tournamentDerive.ts, src/app/components/BracketDisplay.tsx

const SITE = 'https://clutchgg.in';

const tournamentUrl = (id) => `${SITE}/tournament/${encodeURIComponent(id)}`;
const matchUrl = (id) => `${SITE}/tournament-match/${encodeURIComponent(id)}`;

// ─── Ported from tournamentDerive.ts ─────────────────────────────────────────

// A bracket slot isn't a real, listable team until it names an actual roster.
function isTeamSlotName(name) {
  return !name || name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';
}

function isMatchDecidedByMaps(match) {
  const maps = match.maps ?? [];
  if (maps.length === 0) return false;
  const maxMaps = match.format === 'bo1' ? 1 : match.format === 'bo5' ? 5 : 3;
  let w1 = 0, w2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) w1++;
    else if (m.team2Score > m.team1Score) w2++;
  }
  const needed = Math.ceil(maxMaps / 2);
  if (w1 >= needed || w2 >= needed) return true;
  if (maps.length >= maxMaps && w1 !== w2) return true;
  return false;
}

function getMatchStatus(date, time) {
  if (!date) return 'upcoming';
  try {
    const dt = new Date(`${date}T${time || '00:00'}`);
    const diffH = (dt.getTime() - Date.now()) / 36e5;
    if (diffH > -3 && diffH < 3) return 'live';
    if (diffH < -3) return 'completed';
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

function hasPlayedMap(m) {
  return (m.maps ?? []).some((mp) =>
    !!mp.matchId || (!!mp.playerStats && mp.playerStats.length > 0)
    || !!mp.mapName || mp.team1Score > 0 || mp.team2Score > 0,
  );
}

// Winner-aware status — the shared source of truth on the website.
function effectiveStatus(m) {
  if (m.winner || isMatchDecidedByMaps(m)) return 'completed';
  if (hasPlayedMap(m)) return 'live';
  return getMatchStatus(m.date, m.time);
}

// Series score (map wins per side); 1-0 from recorded winner when no maps.
function deriveScore(m) {
  const maps = m.maps ?? [];
  if (maps.length === 0) {
    return {
      s1: m.winner === m.team1Id ? 1 : 0,
      s2: m.winner === m.team2Id ? 1 : 0,
    };
  }
  let s1 = 0, s2 = 0;
  for (const map of maps) {
    if (map.team1Score > map.team2Score) s1++;
    else if (map.team2Score > map.team1Score) s2++;
  }
  return { s1, s2 };
}

// ─── Ported from BracketDisplay.tsx ──────────────────────────────────────────

const DEFAULT_POINTS_PER_WIN = 3;

// Round robin standings: points (wins × pointsPerWin), tiebreak on round diff.
function computeRRStandings(rounds, rrTeams, pointsPerWin = DEFAULT_POINTS_PER_WIN) {
  const map = {};
  for (const team of rrTeams) {
    map[team.id] = {
      teamId: team.id, teamName: team.name,
      wins: 0, losses: 0, wl: 0, points: 0,
      roundsWon: 0, roundsLost: 0, roundDiff: 0, played: 0,
    };
  }
  for (const round of rounds) {
    for (const match of round) {
      if (!match.winner) continue;
      const winnerId = match.winner;
      const loserId = winnerId === match.team1Id ? match.team2Id : match.team1Id;
      if (map[winnerId]) { map[winnerId].wins++; map[winnerId].roundsWon++; map[winnerId].played++; }
      if (map[loserId]) { map[loserId].losses++; map[loserId].roundsLost++; map[loserId].played++; }
    }
  }
  return Object.values(map)
    .map((r) => ({ ...r, wl: r.wins - r.losses, points: r.wins * pointsPerWin, roundDiff: r.roundsWon - r.roundsLost }))
    .sort((a, b) => (b.points !== a.points ? b.points - a.points : b.roundDiff - a.roundDiff));
}

// ─── Bot-side helpers over the blob ──────────────────────────────────────────

// Every bracket a tournament can carry, with a human stage label.
function allBrackets(t) {
  const out = [];
  if (t.stage1Bracket) out.push({ label: t.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1', bracket: t.stage1Bracket });
  if (t.stage2Bracket) out.push({ label: 'Stage 2', bracket: t.stage2Bracket });
  if (t.generatedBracket) out.push({ label: 'Bracket', bracket: t.generatedBracket });
  if (t.knockoutBracket) out.push({ label: 'Knockout', bracket: t.knockoutBracket });
  return out;
}

// Flat list of all matches with stage label + effective status.
function allMatches(t) {
  const out = [];
  for (const { label, bracket } of allBrackets(t)) {
    for (const round of bracket.rounds ?? []) {
      for (const m of round) {
        out.push({ stage: label, match: m, status: effectiveStatus(m) });
      }
    }
  }
  return out;
}

// Matches with both real teams assigned (skip placeholder slots).
function realMatches(t) {
  return allMatches(t).filter(({ match: m }) =>
    m.team1Id && m.team2Id && !isTeamSlotName(m.team1Name ?? '') && !isTeamSlotName(m.team2Name ?? '')
  );
}

// Aggregate per-player stats across all played maps of all matches.
// Returns rows: { playerName, teamName, kills, deaths, assists, kd, acs, maps }
function aggregatePlayerStats(t) {
  const teamNameById = new Map((t.teams ?? []).map((tm) => [tm.id, tm.name]));
  const rows = new Map(); // key: playerId or playerName
  const add = (ps) => {
    const key = ps.playerId || ps.playerName;
    if (!key) return;
    let r = rows.get(key);
    if (!r) {
      r = { playerName: ps.playerName, teamName: teamNameById.get(ps.teamId) ?? '', kills: 0, deaths: 0, assists: 0, acsSum: 0, maps: 0 };
      rows.set(key, r);
    }
    r.kills += ps.kills ?? 0;
    r.deaths += ps.deaths ?? 0;
    r.assists += ps.assists ?? 0;
    r.acsSum += ps.acs ?? 0;
    r.maps += 1;
  };
  for (const { match } of allMatches(t)) {
    for (const map of match.maps ?? []) {
      for (const ps of map.playerStats ?? []) add(ps);
    }
    // Legacy matches store stats at match level instead of per-map.
    if ((match.maps ?? []).every((m) => !(m.playerStats?.length)) && match.playerStats?.length) {
      for (const ps of match.playerStats) add(ps);
    }
  }
  return [...rows.values()].map((r) => ({
    playerName: r.playerName,
    teamName: r.teamName,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    kd: r.deaths > 0 ? +(r.kills / r.deaths).toFixed(2) : r.kills,
    acs: r.maps > 0 ? Math.round(r.acsSum / r.maps) : 0,
    maps: r.maps,
  }));
}

// Fixed-width text table for Discord code blocks.
function textTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  return [line(headers), line(widths.map((w) => '─'.repeat(w))), ...rows.map(line)].join('\n');
}

module.exports = {
  SITE,
  tournamentUrl,
  matchUrl,
  isTeamSlotName,
  isMatchDecidedByMaps,
  effectiveStatus,
  deriveScore,
  DEFAULT_POINTS_PER_WIN,
  computeRRStandings,
  allBrackets,
  allMatches,
  realMatches,
  aggregatePlayerStats,
  textTable,
};
