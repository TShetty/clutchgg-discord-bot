// Bracket generation — ported 1:1 from the website's src/app/utils/bracketUtils.ts
// (the "simplified" generators the admin UI uses). Producing identical
// structures is what lets the website render and edit bot-generated brackets.

function nextPowerOfTwo(n) {
  if (n <= 2) return 2;
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

// Single elimination: round 0 slots left unassigned (needsAssignment) so the
// organizer picks which team fills each slot (/assign-slot).
function generateSingleElimination(teams, forcedSize) {
  const size = forcedSize ? nextPowerOfTwo(forcedSize) : nextPowerOfTwo(teams.length);
  const slotCount = size;
  const rounds = [];

  const r0 = [];
  for (let i = 0; i < slotCount / 2; i++) {
    r0.push({
      id: `match_0_${i}`,
      team1Id: `slot_0_${i}_1`,
      team2Id: `slot_0_${i}_2`,
      team1Name: 'Select Team',
      team2Name: 'Select Team',
      round: 0,
      position: i,
      needsAssignment: true,
    });
  }
  rounds.push(r0);

  let prevCount = slotCount / 2;
  let currentRound = 1;
  while (prevCount > 1) {
    const roundMatches = [];
    for (let i = 0; i < prevCount / 2; i++) {
      roundMatches.push({
        id: `match_${currentRound}_${i}`,
        team1Id: `winner_${currentRound - 1}_${i * 2}`,
        team2Id: `winner_${currentRound - 1}_${i * 2 + 1}`,
        team1Name: 'Winner TBD',
        team2Name: 'Winner TBD',
        round: currentRound,
        position: i,
        autoPopulated: true,
      });
    }
    rounds.push(roundMatches);
    prevCount = prevCount / 2;
    currentRound++;
  }

  return {
    rounds,
    bracketType: 'single',
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated single elimination bracket with ${teams.length} teams (${slotCount} slots)`,
      },
    ],
  };
}

// Double elimination with explicit winner/loser routing (winnerGoesTo /
// loserGoesTo), same structure and ids as the website generator.
function generateDoubleElimination(teams, forcedSize) {
  const size = forcedSize ? nextPowerOfTwo(forcedSize) : nextPowerOfTwo(teams.length);
  const byes = size - teams.length;
  const padded = [
    ...teams,
    ...Array.from({ length: Math.max(0, byes) }, (_, i) => ({ id: `bye_${i}`, name: 'BYE', players: [] })),
  ];
  const teamCount = padded.length;

  const matchMap = {};
  const makeId = (section, r, i) => `${section}_${r}_${i}`;
  const addMatch = (m) => { matchMap[m.id] = m; };

  const wRoundCount = Math.log2(teamCount);

  for (let wr = 0; wr < wRoundCount; wr++) {
    const count = teamCount / Math.pow(2, wr + 1);
    for (let i = 0; i < count; i++) {
      const id = makeId('w', wr, i);
      const isR0 = wr === 0;
      addMatch({
        id,
        team1Id: `slot_${id}_1`,
        team2Id: `slot_${id}_2`,
        team1Name: isR0 ? 'Select Team' : 'Winner TBD',
        team2Name: isR0 ? 'Select Team' : 'Winner TBD',
        round: wr,
        position: i,
        bracketSection: 'winners',
        autoPopulated: wr > 0,
        needsAssignment: isR0,
      });
    }
  }

  const lbRoundCount = 2 * (wRoundCount - 1);
  for (let lr = 0; lr < lbRoundCount; lr++) {
    const phaseAIndex = Math.floor(lr / 2);
    const count = teamCount / Math.pow(2, phaseAIndex + 2);
    for (let i = 0; i < count; i++) {
      const id = makeId('l', lr, i);
      addMatch({
        id,
        team1Id: `slot_${id}_1`,
        team2Id: `slot_${id}_2`,
        team1Name: 'LB TBD',
        team2Name: 'LB TBD',
        round: wRoundCount + lr,
        position: i,
        bracketSection: 'losers',
        autoPopulated: true,
      });
    }
  }

  addMatch({
    id: 'grand_final',
    team1Id: 'slot_gf_1',
    team2Id: 'slot_gf_2',
    team1Name: 'WB Champion',
    team2Name: 'LB Champion',
    round: wRoundCount + lbRoundCount,
    position: 0,
    bracketSection: 'grand-final',
    autoPopulated: true,
  });

  // Routing
  for (let wr = 0; wr < wRoundCount; wr++) {
    const count = teamCount / Math.pow(2, wr + 1);
    for (let i = 0; i < count; i++) {
      const match = matchMap[makeId('w', wr, i)];
      if (wr < wRoundCount - 1) {
        match.winnerGoesTo = { matchId: makeId('w', wr + 1, Math.floor(i / 2)), slot: i % 2 === 0 ? 1 : 2 };
      } else {
        match.winnerGoesTo = { matchId: 'grand_final', slot: 1 };
      }
      if (wr === 0) {
        match.loserGoesTo = { matchId: makeId('l', 0, Math.floor(i / 2)), slot: i % 2 === 0 ? 1 : 2 };
      } else {
        match.loserGoesTo = { matchId: makeId('l', 2 * wr - 1, i), slot: 2 };
      }
    }
  }

  for (let lr = 0; lr < lbRoundCount; lr++) {
    const phaseAIndex = Math.floor(lr / 2);
    const count = teamCount / Math.pow(2, phaseAIndex + 2);
    for (let i = 0; i < count; i++) {
      const match = matchMap[makeId('l', lr, i)];
      if (lr < lbRoundCount - 1) {
        if (lr % 2 === 0) {
          match.winnerGoesTo = { matchId: makeId('l', lr + 1, i), slot: 1 };
        } else {
          match.winnerGoesTo = { matchId: makeId('l', lr + 1, Math.floor(i / 2)), slot: i % 2 === 0 ? 1 : 2 };
        }
      } else {
        match.winnerGoesTo = { matchId: 'grand_final', slot: 2 };
      }
    }
  }

  const maxRound = wRoundCount + lbRoundCount;
  const rounds = [];
  for (let r = 0; r <= maxRound; r++) {
    const roundMatches = Object.values(matchMap)
      .filter((m) => m.round === r)
      .sort((a, b) => a.position - b.position);
    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return {
    rounds,
    bracketType: 'double',
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated double elimination bracket with ${teams.length} teams (${teamCount} slots)`,
      },
    ],
  };
}

// Round robin via the circle algorithm — teams auto-populated, no slots.
function generateRoundRobin(teams) {
  const n = teams.length;
  const list = n % 2 === 0 ? [...teams] : [...teams, { id: 'bye', name: 'BYE', players: [] }];
  const total = list.length;
  const numRounds = total - 1;
  const rounds = [];
  const rrTeams = teams.map((t) => ({ id: t.id, name: t.name }));

  for (let round = 0; round < numRounds; round++) {
    const roundMatches = [];
    for (let i = 0; i < total / 2; i++) {
      const home = list[i];
      const away = list[total - 1 - i];
      if (home.id === 'bye' || away.id === 'bye') continue;
      roundMatches.push({
        id: `rr_${round}_${i}`,
        team1Id: home.id,
        team2Id: away.id,
        team1Name: home.name,
        team2Name: away.name,
        round,
        position: i,
        bracketSection: undefined,
        autoPopulated: true,
      });
    }
    if (roundMatches.length > 0) rounds.push(roundMatches);

    const last = list[total - 1];
    for (let j = total - 1; j > 1; j--) list[j] = list[j - 1];
    list[1] = last;
  }

  return {
    rounds,
    bracketType: 'roundrobin',
    rrTeams,
    customizationHistory: [
      {
        timestamp: new Date().toISOString(),
        changes: `Generated round robin bracket with ${n} teams`,
      },
    ],
  };
}

module.exports = { nextPowerOfTwo, generateSingleElimination, generateDoubleElimination, generateRoundRobin };
