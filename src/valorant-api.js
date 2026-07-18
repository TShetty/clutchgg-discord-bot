// Valorant (HenrikDev) API client — ported 1:1 from the website's
// src/app/services/valorantApi.ts so the bot produces byte-identical map
// results and player stats to what clutchgg.in stores. The website talks to a
// serverless proxy (/api/valorant) that injects the API key; the bot is a
// trusted backend, so it calls HenrikDev directly with HENRIK_API_KEY.
//
// Node 18+ has a global `fetch`, so no dependency is needed.
const { normalizeRiotId } = require('./riot-id');

const API_BASE = process.env.HENRIK_API_BASE || 'https://api.henrikdev.xyz/valorant';
// Region defaults to AP (this circuit is India-based); overridable per-call.
const DEFAULT_REGION = process.env.VALORANT_REGION || 'ap';

function apiKey() {
  const key = process.env.HENRIK_API_KEY;
  if (!key) throw new Error('Missing HENRIK_API_KEY env var — the Valorant stats API cannot be reached.');
  return key;
}

// GET a HenrikDev path (e.g. "/v2/match/<id>"), returning the parsed `.data`.
// Mirrors the proxy: Authorization header carries the key; non-2xx throws a
// message the caller surfaces to the organizer.
async function apiGet(path) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: apiKey() } });
  } catch (e) {
    throw new Error(`Couldn't reach the Valorant stats API (${e instanceof Error ? e.message : 'network error'}).`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = body?.error || body?.message || `HTTP ${res.status}`;
    if (res.status === 404) throw new Error(`Match not found on the Valorant API (${detail}). Double-check the match ID.`);
    if (res.status === 429) throw new Error('The Valorant API is rate-limiting us. Wait a few seconds and try again.');
    throw new Error(`Valorant API error: ${detail}`);
  }
  return body?.data ?? null;
}

// ── Advanced per-round aggregation (ADR / KAST / FK / FD / side splits) ───────
// Direct port of getMatchDetails' folding logic in valorantApi.ts.

const emptySide = () => ({ rounds: 0, score: 0, kills: 0, deaths: 0, assists: 0, damage: 0, kast: 0, fk: 0, fd: 0 });

// Red attacks the first half (rounds 1–12), sides swap each 12-round block.
function attackingSide(roundIndex) {
  return Math.floor(roundIndex / 12) % 2 === 0 ? 'Red' : 'Blue';
}

// Fetch a match and shape it exactly like the website's MatchDetails.
async function getMatchDetails(matchId) {
  const d = await apiGet(`/v2/match/${matchId}`);
  if (!d) throw new Error('Valorant API returned no data for that match.');

  const rawRounds = Array.isArray(d.rounds) ? d.rounds : [];
  const agg = {}; // puuid → aggregate
  const bump = (puuid) => {
    if (!puuid) return null;
    return (agg[puuid] ??= { damage: 0, kast: 0, fk: 0, fd: 0, atk: emptySide(), def: emptySide() });
  };

  rawRounds.forEach((r, roundIdx) => {
    const atkSide = attackingSide(roundIdx);
    const ps = r.player_stats ?? [];

    const sideOf = (puuid) => {
      const e = ps.find((x) => x.player_puuid === puuid);
      const team = e?.player_team === 'Red' ? 'Red' : e?.player_team === 'Blue' ? 'Blue' : undefined;
      return team === atkSide ? 'atk' : 'def';
    };

    let earliest = Number.POSITIVE_INFINITY;
    let fkKiller;
    let fkVictim;
    const killsThisRound = {};
    const diedThisRound = new Set();
    const assistedThisRound = new Set();

    for (const p of ps) {
      for (const ke of p.kill_events ?? []) {
        const killer = ke.killer_puuid ?? p.player_puuid;
        if (killer) killsThisRound[killer] = (killsThisRound[killer] ?? 0) + 1;
        if (ke.victim_puuid) diedThisRound.add(ke.victim_puuid);
        for (const as of ke.assistants ?? []) {
          const aPuuid = typeof as === 'string' ? as : as?.assistant_puuid;
          if (aPuuid) assistedThisRound.add(aPuuid);
        }
        const t = ke.kill_time_in_round ?? Number.POSITIVE_INFINITY;
        if (t < earliest) { earliest = t; fkKiller = killer; fkVictim = ke.victim_puuid; }
      }
    }

    for (const p of ps) {
      const puuid = p.player_puuid;
      const a = bump(puuid);
      if (!a || !puuid) continue;
      const dmg = typeof p.damage === 'number'
        ? p.damage
        : (p.damage_events ?? []).reduce((s, e) => s + (e.damage ?? 0), 0);
      a.damage += dmg;
      const bucket = sideOf(puuid) === 'atk' ? a.atk : a.def;
      bucket.rounds += 1;
      bucket.kills += killsThisRound[puuid] ?? p.kills ?? 0;
      bucket.deaths += diedThisRound.has(puuid) ? 1 : 0;
      bucket.assists += assistedThisRound.has(puuid) ? 1 : 0;
      bucket.score += p.score ?? 0;
      bucket.damage += dmg;
    }

    for (const p of ps) {
      const puuid = p.player_puuid;
      if (!puuid) continue;
      const credited = (killsThisRound[puuid] ?? 0) > 0 || assistedThisRound.has(puuid) || !diedThisRound.has(puuid);
      if (!credited) continue;
      const a = bump(puuid);
      if (!a) continue;
      a.kast += 1;
      (sideOf(puuid) === 'atk' ? a.atk : a.def).kast += 1;
    }

    const fkA = bump(fkKiller);
    if (fkA) { fkA.fk += 1; (sideOf(fkKiller) === 'atk' ? fkA.atk : fkA.def).fk += 1; }
    const fdA = bump(fkVictim);
    if (fdA) { fdA.fd += 1; (sideOf(fkVictim) === 'atk' ? fdA.atk : fdA.def).fd += 1; }
  });

  const players = (d.players?.all_players ?? []).map((p) => {
    const a = p.puuid ? agg[p.puuid] : undefined;
    return {
      name: p.name ?? '',
      tag: p.tag ?? '',
      team: p.team === 'Red' ? 'Red' : 'Blue',
      character: p.character ?? '',
      stats: {
        score: p.stats?.score ?? 0,
        kills: p.stats?.kills ?? 0,
        deaths: p.stats?.deaths ?? 0,
        assists: p.stats?.assists ?? 0,
        headshots: p.stats?.headshots ?? 0,
        bodyshots: p.stats?.bodyshots ?? 0,
        legshots: p.stats?.legshots ?? 0,
      },
      damageMade: a?.damage ?? p.damage_made ?? 0,
      kastRounds: a?.kast ?? 0,
      firstKills: a?.fk ?? 0,
      firstDeaths: a?.fd ?? 0,
      atk: a?.atk ?? emptySide(),
      def: a?.def ?? emptySide(),
    };
  });

  const rounds = rawRounds.map((r) => ({
    winningTeam: r.winning_team === 'Red' ? 'Red' : 'Blue',
    endType: r.end_type ?? '',
    bombPlanted: !!r.bomb_planted,
    bombDefused: !!r.bomb_defused,
  }));

  return {
    metadata: {
      map: d.metadata?.map ?? '',
      game_start_patched: d.metadata?.game_start_patched ?? '',
      rounds_played: d.metadata?.rounds_played ?? 0,
    },
    teams: {
      blue: { has_won: !!d.teams?.blue?.has_won, rounds_won: d.teams?.blue?.rounds_won ?? 0 },
      red: { has_won: !!d.teams?.red?.has_won, rounds_won: d.teams?.red?.rounds_won ?? 0 },
    },
    players,
    rounds,
  };
}

// ── Roster ↔ API player matching (port of the same helpers) ──────────────────

function apiPlayerMatchesRoster(player, roster) {
  const riotId = normalizeRiotId(`${player.name}#${player.tag}`);
  const name = normalizeRiotId(player.name);
  return roster.some((r) => {
    const v = normalizeRiotId(r);
    return v === riotId || v === name;
  });
}

function countRosterMatches(apiPlayers, roster) {
  return apiPlayers.filter((p) => apiPlayerMatchesRoster(p, roster)).length;
}

// Decide which API side (Blue/Red) is team1 vs team2 by roster overlap, scoring
// both orientations and picking the better global fit (port of mapPlayersToTeams).
function mapPlayersToTeams(apiPlayers, team1Players, team2Players) {
  const blueTeam = apiPlayers.filter((p) => p.team === 'Blue');
  const redTeam = apiPlayers.filter((p) => p.team === 'Red');
  const countIn = (players, roster) => players.filter((p) => apiPlayerMatchesRoster(p, roster)).length;

  const blueAsT1 = countIn(blueTeam, team1Players);
  const redAsT2 = countIn(redTeam, team2Players);
  const redAsT1 = countIn(redTeam, team1Players);
  const blueAsT2 = countIn(blueTeam, team2Players);

  const scoreA = blueAsT1 + redAsT2; // Blue = team1
  const scoreB = redAsT1 + blueAsT2; // Red = team1

  if (scoreA >= scoreB) {
    return { team1Matches: blueAsT1, team2Matches: redAsT2, team1Name: 'Blue', team2Name: 'Red' };
  }
  return { team1Matches: redAsT1, team2Matches: blueAsT2, team1Name: 'Red', team2Name: 'Blue' };
}

function sideSplitToStat(raw) {
  if (!raw || raw.rounds === 0) return undefined;
  return {
    rounds: raw.rounds,
    kills: raw.kills,
    deaths: raw.deaths,
    assists: raw.assists,
    kd: raw.deaths > 0 ? parseFloat((raw.kills / raw.deaths).toFixed(2)) : raw.kills,
    acs: Math.floor(raw.score / raw.rounds),
    adr: Math.round(raw.damage / raw.rounds),
    kast: Math.round((raw.kast / raw.rounds) * 100),
    fk: raw.fk,
    fd: raw.fd,
  };
}

// Build MatchPlayerStat[] keyed to tournament team ids (port of buildPlayerStatsFromAPI).
// playerName is ALWAYS the Riot in-game name (never the roster-entered name), per
// the website's note about split "Players to Watch" entries.
function buildPlayerStatsFromAPI(apiPlayers, team1Name, team1Id, team2Id, roundsPlayed) {
  return apiPlayers.map((player) => {
    const teamId = player.team === team1Name ? team1Id : team2Id;
    const totalShots = player.stats.headshots + player.stats.bodyshots + player.stats.legshots;
    const hsPercent = totalShots > 0 ? (player.stats.headshots / totalShots) * 100 : 0;
    return {
      playerId: `${player.name}#${player.tag}`,
      playerName: player.name,
      teamId,
      agent: player.character,
      kills: player.stats.kills,
      deaths: player.stats.deaths,
      assists: player.stats.assists,
      kd: player.stats.deaths > 0 ? parseFloat((player.stats.kills / player.stats.deaths).toFixed(2)) : player.stats.kills,
      acs: roundsPlayed > 0 ? Math.floor(player.stats.score / roundsPlayed) : 0,
      hsPercent: Math.round(hsPercent),
      adr: roundsPlayed > 0 ? Math.round(player.damageMade / roundsPlayed) : 0,
      kast: roundsPlayed > 0 ? Math.round((player.kastRounds / roundsPlayed) * 100) : 0,
      fk: player.firstKills,
      fd: player.firstDeaths,
      atk: sideSplitToStat(player.atk),
      def: sideSplitToStat(player.def),
    };
  });
}

function normalizeEndType(raw, bombDefused) {
  const s = (raw || '').toLowerCase();
  if (s.includes('defus') || bombDefused) return 'defuse';
  if (s.includes('detonat') || s.includes('bomb')) return 'detonate';
  if (s.includes('time') || s.includes('expir')) return 'time';
  return 'elim';
}

function buildRoundFlow(rounds, team1Name) {
  return rounds.map((r) => ({
    winner: r.winningTeam === team1Name ? 1 : 2,
    endType: normalizeEndType(r.endType, r.bombDefused),
  }));
}

// Fetch one Valorant match id and produce the stored MatchMapResult shape:
// { mapName, team1Score, team2Score, playerStats, matchId, roundFlow }.
// Direct port of buildMatchResultFromId — the website's canonical importer.
async function buildMatchResultFromId(matchId, team1Roster, team2Roster, team1Id, team2Id) {
  const details = await getMatchDetails(matchId);
  const mapping = mapPlayersToTeams(details.players, team1Roster, team2Roster);
  const team1Rounds = mapping.team1Name === 'Blue' ? details.teams.blue.rounds_won : details.teams.red.rounds_won;
  const team2Rounds = mapping.team1Name === 'Blue' ? details.teams.red.rounds_won : details.teams.blue.rounds_won;
  const playerStats = buildPlayerStatsFromAPI(details.players, mapping.team1Name, team1Id, team2Id, details.metadata.rounds_played);
  return {
    mapName: details.metadata.map,
    team1Score: team1Rounds,
    team2Score: team2Rounds,
    playerStats,
    matchId,
    roundFlow: buildRoundFlow(details.rounds, mapping.team1Name),
    // Diagnostic only (how many roster players matched each side) — lets the
    // command warn the organizer when the side mapping is weak.
    _mapping: { team1Matches: mapping.team1Matches, team2Matches: mapping.team2Matches },
  };
}

// ── Match finding (custom-game lookup) — ported from valorantApi.ts ──────────

// A player's recent match history (newest first), optionally filtered by mode.
// `mode='custom'` surfaces custom games (tournament scrims). Returns light
// records: { uuid, map, startedAt, mode }.
async function getPlayerMatchHistory(playerName, playerTag, region = DEFAULT_REGION, mode = 'custom', size = 15) {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (size) params.set('size', String(size));
  const qs = params.toString();
  const data = await apiGet(`/v3/matches/${region}/${encodeURIComponent(playerName)}/${encodeURIComponent(playerTag)}${qs ? `?${qs}` : ''}`);
  const mapped = (Array.isArray(data) ? data : []).map((m) => ({
    uuid: m.metadata?.matchid ?? '',
    map: m.metadata?.map ?? '',
    startedAt: m.metadata?.game_start_patched ?? '',
    mode: m.metadata?.mode_id ?? '',
  }));
  return mode === 'custom' ? mapped.filter((m) => m.mode === 'custom') : mapped;
}

// Split a "name#tag" (or bare name) into { name, tag } for the history endpoint.
function splitRiotId(riotId) {
  const [name, tag] = String(riotId).split('#');
  return { name: (name ?? '').trim(), tag: (tag ?? '').trim() };
}

// Search a seed player's recent customs and keep only games where BOTH teams
// appear (≥ minPerTeam roster players each) — i.e. the actual head-to-head, not
// every scrim the player joined. Port of getCustomGamesForBothTeams. Each
// candidate carries the score and how many of each roster showed up, so the
// organizer can eyeball the right match id. Fetches details per game (rate-limit
// friendly gap between calls).
async function findCustomGamesForMatch(seedRiotId, team1Roster, team2Roster, region = DEFAULT_REGION, count = 15, minPerTeam = 2) {
  const { name, tag } = splitRiotId(seedRiotId);
  if (!name || !tag) throw new Error(`Seed player "${seedRiotId}" must be a full Riot ID like Name#TAG.`);
  const history = await getPlayerMatchHistory(name, tag, region, 'custom', count);
  const out = [];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!h.uuid) continue;
    let details;
    try {
      details = await getMatchDetails(h.uuid);
    } catch {
      continue; // skip games that fail to load
    }
    const t1 = countRosterMatches(details.players, team1Roster);
    const t2 = countRosterMatches(details.players, team2Roster);
    if (t1 < minPerTeam || t2 < minPerTeam) continue;
    out.push({
      matchId: h.uuid,
      map: details.metadata.map || h.map,
      startedAt: details.metadata.game_start_patched || h.startedAt,
      blueScore: details.teams.blue.rounds_won,
      redScore: details.teams.red.rounds_won,
      team1PlayersFound: t1,
      team2PlayersFound: t2,
      team1RosterSize: team1Roster.length,
      team2RosterSize: team2Roster.length,
    });
    if (i < history.length - 1) await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

module.exports = {
  DEFAULT_REGION,
  getMatchDetails,
  buildMatchResultFromId,
  countRosterMatches,
  mapPlayersToTeams,
  getPlayerMatchHistory,
  findCustomGamesForMatch,
  splitRiotId,
};
