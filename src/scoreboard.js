// Scoreboard rendering + series helpers for /update-score.
// Formats a fetched (or stored) match's maps into Discord embed fields showing
// map name, per-team round score, and a per-player stat table — the Discord
// analog of the website's match scoreboard. Kept pure so it can be unit-tested.
const { textTable } = require('./tournament-utils');

// Max maps by series format (same rule as the website / tournament-utils).
function maxMapsFor(format) {
  return format === 'bo1' ? 1 : format === 'bo5' ? 5 : 3;
}

// Series winner purely from stored map scores, using the match's BOn format.
// Returns { winnerId, s1, s2, decided } — winnerId undefined until decided.
// Mirrors winnerFromMaps / isMatchDecidedByMaps on the website.
function seriesResult(match) {
  const maps = (match.maps ?? []).filter((m) => m && (m.team1Score > 0 || m.team2Score > 0 || m.playerStats?.length));
  const maxMaps = maxMapsFor(match.format);
  let s1 = 0;
  let s2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) s1++;
    else if (m.team2Score > m.team1Score) s2++;
  }
  const needed = Math.ceil(maxMaps / 2);
  let winnerId;
  if (s1 >= needed) winnerId = match.team1Id;
  else if (s2 >= needed) winnerId = match.team2Id;
  else if (maps.length >= maxMaps && s1 !== s2) winnerId = s1 > s2 ? match.team1Id : match.team2Id;
  return { winnerId, s1, s2, decided: !!winnerId };
}

// A map "slot" is considered populated once it has stats or a non-0:0 score.
function mapIsPopulated(m) {
  return !!m && (!!m.matchId || (m.playerStats?.length ?? 0) > 0 || m.team1Score > 0 || m.team2Score > 0 || !!m.mapName);
}

// Index of the next unplayed map slot for a BOn match, or -1 if the series is
// already full/decided. Used to detect "map 1 done, map 2 pending".
function nextOpenMapIndex(match) {
  const maxMaps = maxMapsFor(match.format);
  const maps = match.maps ?? [];
  for (let i = 0; i < maxMaps; i++) {
    if (!mapIsPopulated(maps[i])) return i;
  }
  return -1;
}

// Render one map's player table for a Discord code block. Rows are sorted by ACS
// desc (best player first), split by team so the organizer can read each side.
// teamNameById maps tournament team ids → display names.
function renderMapTable(map, match, teamNameById) {
  const stats = map.playerStats ?? [];
  if (stats.length === 0) return '_No player stats for this map._';

  const rowsFor = (teamId) =>
    stats
      .filter((p) => p.teamId === teamId)
      .sort((a, b) => (b.acs ?? 0) - (a.acs ?? 0))
      .map((p) => [
        (p.playerName ?? '').slice(0, 14),
        `${p.kills}/${p.deaths}/${p.assists}`,
        (p.kd ?? 0).toFixed(1),
        String(p.acs ?? 0),
        p.adr ? String(p.adr) : '-',
      ]);

  const header = ['Player', 'K/D/A', 'KD', 'ACS', 'ADR'];
  const t1 = teamNameById.get(match.team1Id) ?? match.team1Name ?? 'Team 1';
  const t2 = teamNameById.get(match.team2Id) ?? match.team2Name ?? 'Team 2';
  const t1Rows = rowsFor(match.team1Id);
  const t2Rows = rowsFor(match.team2Id);
  // Any players whose side didn't map to either tournament team (weak roster match).
  const known = new Set([match.team1Id, match.team2Id]);
  const orphan = stats.filter((p) => !known.has(p.teamId));

  const blocks = [];
  if (t1Rows.length) blocks.push(`${t1}\n${textTable(header, t1Rows)}`);
  if (t2Rows.length) blocks.push(`${t2}\n${textTable(header, t2Rows)}`);
  if (orphan.length) {
    const oRows = orphan
      .sort((a, b) => (b.acs ?? 0) - (a.acs ?? 0))
      .map((p) => [(p.playerName ?? '').slice(0, 14), `${p.kills}/${p.deaths}/${p.assists}`, (p.kd ?? 0).toFixed(1), String(p.acs ?? 0), p.adr ? String(p.adr) : '-']);
    blocks.push(`Unmatched players\n${textTable(header, oRows)}`);
  }
  return '```\n' + blocks.join('\n\n') + '\n```';
}

// One embed field per map (title = "Map N · <MapName> — score", value = table).
// `maps` may be the fetched preview or what's already stored on the match.
function mapFields(maps, match, teamNameById) {
  const t1 = teamNameById.get(match.team1Id) ?? match.team1Name ?? 'Team 1';
  const t2 = teamNameById.get(match.team2Id) ?? match.team2Name ?? 'Team 2';
  return (maps ?? [])
    .map((m, i) => {
      if (!mapIsPopulated(m)) return null;
      const name = m.mapName || 'Unknown map';
      const score = `${t1} ${m.team1Score} – ${m.team2Score} ${t2}`;
      const table = renderMapTable(m, match, teamNameById);
      return { name: `🗺️ Map ${i + 1} · ${name} — ${score}`, value: table.slice(0, 1024) };
    })
    .filter(Boolean);
}

module.exports = {
  maxMapsFor,
  seriesResult,
  mapIsPopulated,
  nextOpenMapIndex,
  renderMapTable,
  mapFields,
};
