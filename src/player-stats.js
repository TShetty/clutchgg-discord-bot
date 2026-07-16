// Player lookup + per-player stat aggregation for /player and /compare.
// Stat rows resolve to roster players via statMatchesPlayer (the website's
// StatsPage identity model: id, Riot ID, bare name, nameHistory aliases).
const { allMatches, SITE } = require('./tournament-utils');
const { statMatchesPlayer } = require('./mvp');

const playerUrl = (tournamentId, playerId) =>
  `${SITE}/player/${encodeURIComponent(tournamentId)}/${encodeURIComponent(playerId)}`;

// Find a roster player by name or Riot ID (exact first, then partial).
// Returns { team, player } or null.
function findPlayer(t, query) {
  const q = query.trim().toLowerCase();
  const entries = (t.teams ?? []).flatMap((team) =>
    (team.players ?? []).map((player) => ({ team, player }))
  );
  const nameOf = (e) => (e.player.name ?? '').toLowerCase();
  const riotOf = (e) => (e.player.riotId ?? '').toLowerCase();
  return entries.find((e) => nameOf(e) === q || riotOf(e) === q)
    ?? entries.find((e) => nameOf(e).includes(q) || riotOf(e).includes(q))
    ?? null;
}

// One-line roster listing used in "player not found" replies.
function allPlayerNames(t) {
  return (t.teams ?? []).flatMap((team) => (team.players ?? []).map((p) => `• ${p.name} (${team.name})`));
}

// Aggregate a roster player's stats across all played maps (mirrors
// aggregatePlayerStats but scoped to one player via statMatchesPlayer,
// including the legacy match-level playerStats fallback).
function playerTotals(t, player) {
  const r = { kills: 0, deaths: 0, assists: 0, acsSum: 0, adrSum: 0, adrMaps: 0, fk: 0, fd: 0, maps: 0, agents: new Map() };
  const add = (ps) => {
    r.kills += ps.kills ?? 0;
    r.deaths += ps.deaths ?? 0;
    r.assists += ps.assists ?? 0;
    r.acsSum += ps.acs ?? 0;
    if (ps.adr) { r.adrSum += ps.adr; r.adrMaps += 1; }
    r.fk += ps.fk ?? 0;
    r.fd += ps.fd ?? 0;
    r.maps += 1;
    if (ps.agent) r.agents.set(ps.agent, (r.agents.get(ps.agent) ?? 0) + 1);
  };
  for (const { match } of allMatches(t)) {
    let seenPerMap = false;
    for (const map of match.maps ?? []) {
      for (const ps of map.playerStats ?? []) {
        seenPerMap = true;
        if (statMatchesPlayer(ps, player)) add(ps);
      }
    }
    if (!seenPerMap && match.playerStats?.length) {
      for (const ps of match.playerStats) {
        if (statMatchesPlayer(ps, player)) add(ps);
      }
    }
  }
  return {
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    kd: r.deaths > 0 ? +(r.kills / r.deaths).toFixed(2) : r.kills,
    acs: r.maps > 0 ? Math.round(r.acsSum / r.maps) : 0,
    adr: r.adrMaps > 0 ? Math.round(r.adrSum / r.adrMaps) : null,
    fk: r.fk,
    fd: r.fd,
    maps: r.maps,
    topAgents: [...r.agents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
  };
}

module.exports = { findPlayer, allPlayerNames, playerTotals, playerUrl };
