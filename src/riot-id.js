// Canonical Riot ID / display-name normalization — ported 1:1 from the website's
// src/app/utils/riotId.ts. Roster entries (from spreadsheet uploads) are messy
// (stray spaces around "#", trailing \r from CSV, full-width CJK, mixed case);
// the Valorant API returns the clean form. Both sides MUST normalize identically
// or a player silently fails to match and the scoreboard shows "2/5" not "5/5".
function normalizeRiotId(s) {
  return String(s ?? '')
    .normalize('NFKC')        // width/encoding variants → canonical
    .replace(/\s*#\s*/g, '#') // kill spaces around the name#tag separator
    .replace(/\s+/g, ' ')     // collapse whitespace runs (incl. \r, \n, tabs)
    .trim()
    .toLowerCase();
}

// The bare name portion (before "#"), normalized. Used when a roster entry is a
// plain display name rather than a full Riot ID.
function normalizeRiotName(s) {
  return normalizeRiotId(s).split('#')[0];
}

function riotIdsMatch(a, b) {
  const na = normalizeRiotId(a);
  const nb = normalizeRiotId(b);
  if (na === nb) return true;
  return normalizeRiotName(a) === normalizeRiotName(b);
}

module.exports = { normalizeRiotId, normalizeRiotName, riotIdsMatch };
