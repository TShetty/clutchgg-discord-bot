// MVP scoring — faithful port of the website's model so the bot names the
// same MVP the site shows. Sources: src/app/utils/tournamentMvp.ts,
// src/app/utils/bracketRounds.ts, computePlacement (TeamsPage.tsx),
// statMatchesPlayer (StatsPage.tsx).
const { computeRRStandings } = require('./tournament-utils');
const { normalizeRiotId } = require('./excel-import');

const STAGE_MULTIPLIERS = { GROUP_STAGE: 1.0, QUARTERFINAL: 1.15, SEMIFINAL: 1.3, LOWER_FINAL: 1.4, GRAND_FINAL: 1.5 };
const NORM_RANGES = {
  rating: { min: 0.8, max: 1.4 },
  acs: { min: 150, max: 320 },
  adr: { min: 100, max: 180 },
  kast: { min: 0.6, max: 0.85 },
  entry: { min: -0.05, max: 0.15 },
};
const WEIGHTS = { rating: 0.3, acs: 0.25, adr: 0.15, kast: 0.1, entry: 0.1, placement: 0.1 };

// bracketRounds.ts port
function bracketRoundLabel(bracket, match) {
  if (!bracket?.rounds?.length) return null;
  if (bracket.bracketType === 'roundrobin') return null;
  const sectionOf = (r) => r[0]?.bracketSection ?? 'winners';
  const isDouble = bracket.rounds.flat().some((m) => m.bracketSection === 'losers');
  const winners = bracket.rounds.filter((r) => r.length > 0 && sectionOf(r) === 'winners');
  const losers = bracket.rounds.filter((r) => r.length > 0 && sectionOf(r) === 'losers');
  const grandFinal = bracket.rounds.filter((r) => r.length > 0 && sectionOf(r) === 'grand-final');
  if (grandFinal.some((r) => r.some((m) => m.id === match.id))) return 'Grand Final';
  const name = (idx, total, prefix) => {
    const fromEnd = total - 1 - idx;
    const base = fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semi Finals' : fromEnd === 2 ? 'Quarter Finals' : `Round ${idx + 1}`;
    return prefix ? `${prefix} ${base}` : base;
  };
  const wIdx = winners.findIndex((r) => r.some((m) => m.id === match.id));
  if (wIdx >= 0) return name(wIdx, winners.length, isDouble ? 'WB' : '');
  const lIdx = losers.findIndex((r) => r.some((m) => m.id === match.id));
  if (lIdx >= 0) return name(lIdx, losers.length, 'LB');
  return null;
}

function stageMultiplierFor(bracket, match) {
  const label = bracketRoundLabel(bracket, match);
  if (!label) return STAGE_MULTIPLIERS.GROUP_STAGE;
  if (label === 'Grand Final') return STAGE_MULTIPLIERS.GRAND_FINAL;
  if (label === 'LB Final') return STAGE_MULTIPLIERS.LOWER_FINAL;
  if (label === 'Final') return STAGE_MULTIPLIERS.GRAND_FINAL;
  if (label.endsWith('Final')) return STAGE_MULTIPLIERS.SEMIFINAL;
  if (label.includes('Semi')) return STAGE_MULTIPLIERS.SEMIFINAL;
  if (label.includes('Quarter')) return STAGE_MULTIPLIERS.QUARTERFINAL;
  return STAGE_MULTIPLIERS.GROUP_STAGE;
}

const normalizeRiotName = (s) => normalizeRiotId(s).split('#')[0];

// StatsPage.tsx port — a stat row resolves to a roster player through id,
// Riot ID, bare name, or any nameHistory alias.
function statMatchesPlayer(stat, player) {
  if (stat.playerId === player.id) return true;
  const pid = normalizeRiotId(stat.playerId ?? '');
  const pidName = normalizeRiotName(stat.playerId ?? '');
  const pname = normalizeRiotId(stat.playerName ?? '');
  const idMatches = (ref) => {
    if (!ref) return false;
    const n = normalizeRiotId(ref);
    const nName = normalizeRiotName(ref);
    return pid === n || pname === n || pidName === nName || pname === nName;
  };
  if (idMatches(player.riotId) || idMatches(player.name)) return true;
  for (const alias of player.nameHistory ?? []) {
    if (idMatches(alias.riotId) || idMatches(alias.name)) return true;
  }
  return false;
}

// StatsPage.tsx port
function getStageOptions(t) {
  const twoStage = !!t.stage1Config || !!t.stage1Bracket || !!t.stage2Bracket;
  if (!twoStage) {
    return t.generatedBracket ? [{ id: 'main', label: 'Main Bracket', brackets: [t.generatedBracket] }] : [];
  }
  const stages = [];
  if (t.stage1Bracket) {
    stages.push({ id: 'stage1', label: t.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1', brackets: [t.stage1Bracket] });
  }
  if (t.stage2Bracket) stages.push({ id: 'stage2', label: 'Stage 2', brackets: [t.stage2Bracket] });
  return stages;
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// TeamsPage.tsx port
function computePlacement(t, teamId) {
  const finalStageBracket = t.stage2Bracket || t.generatedBracket;
  const rrBracket = [t.generatedBracket, t.stage1Bracket].find((b) => b?.bracketType === 'roundrobin');
  if (rrBracket && !t.stage2Bracket) {
    const rows = computeRRStandings(rrBracket.rounds, rrBracket.rrTeams ?? [], rrBracket.pointsPerWin);
    const idx = rows.findIndex((r) => r.teamId === teamId);
    if (idx >= 0) return ordinal(idx + 1);
  }
  if (t.stage1Config?.format === 'groupstage' && t.stage1Bracket && !t.stage2Bracket) {
    let best = null;
    for (const g of t.stage1Config.groups ?? []) {
      const matches = t.stage1Bracket.rounds.flat().filter((m) => m.id.includes(`gs_${g.id}_`));
      const rrTeams = g.teams.map((tm) => ({ id: tm.id, name: tm.name }));
      const rows = computeRRStandings([matches], rrTeams, t.stage1Bracket.pointsPerWin);
      const idx = rows.findIndex((r) => r.teamId === teamId);
      if (idx >= 0) best = best === null ? idx + 1 : Math.min(best, idx + 1);
    }
    if (best !== null) return ordinal(best);
  }
  if (finalStageBracket?.rounds.length) {
    const lastRound = finalStageBracket.rounds[finalStageBracket.rounds.length - 1];
    const grandFinal = lastRound[lastRound.length - 1];
    if (grandFinal?.winner) {
      if (grandFinal.winner === teamId) return '1st';
      if (grandFinal.team1Id === teamId || grandFinal.team2Id === teamId) return '2nd';
    }
    let furthestRound = -1;
    finalStageBracket.rounds.forEach((round, ri) => {
      if (round.some((m) => m.team1Id === teamId || m.team2Id === teamId)) furthestRound = ri;
    });
    if (furthestRound >= 0) {
      const remaining = Math.pow(2, finalStageBracket.rounds.length - furthestRound);
      if (remaining <= 16) return `Top ${remaining}`;
    }
  }
  return null;
}

// tournamentMvp.ts ports
const calculateWeightedAverage = (samples, pick) => {
  let num = 0, den = 0;
  for (const s of samples) {
    const v = pick(s);
    if (v === undefined || Number.isNaN(v)) continue;
    num += v * s.multiplier;
    den += s.multiplier;
  }
  return den > 0 ? num / den : null;
};
const normalizeStat = (value, min, max) => Math.min(1, Math.max(0, (value - min) / (max - min)));
const calculateEntryImpact = (fk, fd, rounds) => (rounds > 0 ? (fk - fd) / rounds : 0);
function calculatePlacementBonus(placement) {
  if (!placement) return 0.4;
  if (placement === '1st') return 1.0;
  if (placement === '2nd') return 0.85;
  const m = placement.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : Infinity;
  if (n <= 4) return 0.7;
  if (n <= 8) return 0.55;
  return 0.4;
}
function calculateMVPScore(parts) {
  const stats = [
    { value: parts.ratingNorm, weight: WEIGHTS.rating },
    { value: parts.acsNorm, weight: WEIGHTS.acs },
    { value: parts.adrNorm, weight: WEIGHTS.adr },
    { value: parts.kastNorm, weight: WEIGHTS.kast },
    { value: parts.entryNorm, weight: WEIGHTS.entry },
  ];
  const available = stats.filter((s) => s.value !== null);
  const availWeight = available.reduce((s, x) => s + x.weight, 0);
  const statBudget = 1 - WEIGHTS.placement;
  const statScore = availWeight > 0
    ? available.reduce((s, x) => s + x.value * (x.weight / availWeight), 0) * statBudget
    : 0;
  return (statScore + parts.placementBonus * WEIGHTS.placement) * 100;
}
const ratingProxy = (stat, rounds) => (rounds <= 0 ? 1 : 1 + (stat.kills + 0.5 * stat.assists - stat.deaths) / rounds);
const kastFraction = (v) => (v > 1 ? v / 100 : v);

function collectSamples(t, scope) {
  const stages = getStageOptions(t).filter((s) => scope === 'all' || s.id !== 'stage1');
  const players = new Map();
  const teamMaps = new Map();
  const seen = new Set();
  const seenTeamMap = new Set();
  for (const stage of stages) {
    for (const bracket of stage.brackets) {
      for (const match of bracket.rounds.flat()) {
        for (const map of match.maps ?? []) {
          const rounds = map.roundFlow?.length || map.team1Score + map.team2Score;
          const multiplier = stageMultiplierFor(bracket, match);
          for (const ps of map.playerStats ?? []) {
            const key = `${match.id}|${map.mapName}|${ps.playerId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const tmKey = `${match.id}|${map.mapName}|${ps.teamId}`;
            if (!seenTeamMap.has(tmKey)) {
              seenTeamMap.add(tmKey);
              teamMaps.set(ps.teamId, (teamMaps.get(ps.teamId) ?? 0) + 1);
            }
            const cur = players.get(ps.playerId) ?? { sample: ps, samples: [] };
            cur.samples.push({ stat: ps, multiplier, rounds });
            players.set(ps.playerId, cur);
          }
        }
      }
    }
  }
  return { players, teamMaps };
}

function resolveRoster(t, sample) {
  const team = t.teams.find((tm) => tm.id === sample.teamId);
  return team?.players.find((p) => statMatchesPlayer(sample, p))
    ?? t.teams.flatMap((tm) => tm.players).find((p) => statMatchesPlayer(sample, p))
    ?? null;
}

// Full tournament MVP ranking — same eligibility and scoring as the website.
function calculateTournamentMvpRankings(t) {
  const scope = t.mvpStageScope === 'stage2' && t.stage2Bracket ? 'stage2' : 'all';
  const { players, teamMaps } = collectSamples(t, scope);
  if (players.size === 0) return [];
  const teamNameById = {};
  (t.teams ?? []).forEach((tm) => { teamNameById[tm.id] = tm.name; });

  const build = (minMaps) => {
    const out = [];
    for (const { sample, samples } of players.values()) {
      const tm = teamMaps.get(sample.teamId) ?? 0;
      if (samples.length < Math.max(minMaps, Math.ceil(tm * 0.6))) continue;

      const weightedACS = calculateWeightedAverage(samples, (s) => s.stat.acs) ?? 0;
      const weightedRating = calculateWeightedAverage(samples, (s) => ratingProxy(s.stat, s.rounds)) ?? 1;
      const weightedADR = calculateWeightedAverage(samples, (s) => s.stat.adr || undefined);
      const weightedKAST = calculateWeightedAverage(samples, (s) => (s.stat.kast ? kastFraction(s.stat.kast) : undefined));
      const weightedEntryImpact = calculateWeightedAverage(
        samples,
        (s) => (s.stat.fk !== undefined && s.stat.fd !== undefined && s.rounds > 0 ? calculateEntryImpact(s.stat.fk, s.stat.fd, s.rounds) : undefined)
      );

      const acsNorm = normalizeStat(weightedACS, NORM_RANGES.acs.min, NORM_RANGES.acs.max);
      const ratingNorm = normalizeStat(weightedRating, NORM_RANGES.rating.min, NORM_RANGES.rating.max);
      const adrNorm = weightedADR === null ? null : normalizeStat(weightedADR, NORM_RANGES.adr.min, NORM_RANGES.adr.max);
      const kastNorm = weightedKAST === null ? null : normalizeStat(weightedKAST, NORM_RANGES.kast.min, NORM_RANGES.kast.max);
      const entryNorm = weightedEntryImpact === null ? null : normalizeStat(weightedEntryImpact, NORM_RANGES.entry.min, NORM_RANGES.entry.max);
      const placementBonus = calculatePlacementBonus(computePlacement(t, sample.teamId));
      const mvpScore = calculateMVPScore({ ratingNorm, acsNorm, adrNorm, kastNorm, entryNorm, placementBonus });

      const roster = resolveRoster(t, sample);
      out.push({
        name: roster?.name?.trim() || sample.playerName,
        teamName: teamNameById[sample.teamId] ?? '',
        mapsPlayed: samples.length,
        weightedACS,
        mvpScore,
      });
    }
    return out.sort((a, b) => b.mvpScore - a.mvpScore);
  };

  const ranked = build(4);
  return ranked.length > 0 ? ranked : build(2);
}

// MVP of a single match: best average ACS across the match's played maps
// (min 1 map). Used for the auto result cards.
function matchMvp(t, match) {
  const rows = new Map();
  for (const map of match.maps ?? []) {
    for (const ps of map.playerStats ?? []) {
      const key = ps.playerId || ps.playerName;
      if (!key) continue;
      const r = rows.get(key) ?? { sample: ps, kills: 0, deaths: 0, assists: 0, acsSum: 0, maps: 0 };
      r.kills += ps.kills ?? 0;
      r.deaths += ps.deaths ?? 0;
      r.assists += ps.assists ?? 0;
      r.acsSum += ps.acs ?? 0;
      r.maps += 1;
      rows.set(key, r);
    }
  }
  if (rows.size === 0) return null;
  const best = [...rows.values()]
    .map((r) => ({ ...r, acs: r.maps ? r.acsSum / r.maps : 0 }))
    .sort((a, b) => b.acs - a.acs)[0];
  const roster = resolveRoster(t, best.sample);
  const teamName = (t.teams ?? []).find((tm) => tm.id === best.sample.teamId)?.name ?? '';
  return {
    name: roster?.name?.trim() || best.sample.playerName,
    teamName,
    acs: Math.round(best.acs),
    kills: best.kills,
    deaths: best.deaths,
    assists: best.assists,
    kd: best.deaths > 0 ? +(best.kills / best.deaths).toFixed(2) : best.kills,
    agent: best.sample.agent,
  };
}

module.exports = { calculateTournamentMvpRankings, matchMvp, bracketRoundLabel, computePlacement };
