// Lightweight in-memory rate limiting / brute-force protection.
//
// Single-instance bot (one Railway container) → in-memory state is sufficient
// and resets on restart. If the bot is ever scaled to multiple instances this
// must move to the DB (a `bot_rate_limit` table keyed the same way).
//
// Two primitives:
//   • failGuard  — count consecutive FAILURES for a key; lock out after a cap
//                  for a cooldown window (used against claim-code guessing).
//   • cooldown   — simple "at most once per N ms" gate (used for /report-issue
//                  style spam guards; kept here so all timing lives in one place).

const _fails = new Map(); // key -> { count, firstAt, lockedUntil }
const _cooldowns = new Map(); // key -> lastAllowedAt

// Record and evaluate a failed attempt. Returns:
//   { locked: true, retryAfterMs }  when the key is currently locked out
//   { locked: false, remaining }    otherwise (remaining attempts before lock)
// Call registerFail() AFTER a genuine failure; call clearFails() on success.
function checkFailGuard(key, { max = 5, windowMs = 10 * 60_000, lockMs = 15 * 60_000 } = {}) {
  const now = Date.now();
  const rec = _fails.get(key);
  if (rec?.lockedUntil && rec.lockedUntil > now) {
    return { locked: true, retryAfterMs: rec.lockedUntil - now };
  }
  // Window expired or never seen → treat as fresh.
  if (!rec || now - rec.firstAt > windowMs) {
    return { locked: false, remaining: max };
  }
  return { locked: false, remaining: Math.max(0, max - rec.count) };
}

function registerFail(key, { max = 5, windowMs = 10 * 60_000, lockMs = 15 * 60_000 } = {}) {
  const now = Date.now();
  const rec = _fails.get(key);
  if (!rec || now - rec.firstAt > windowMs) {
    _fails.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return { locked: false, remaining: max - 1 };
  }
  rec.count += 1;
  if (rec.count >= max) {
    rec.lockedUntil = now + lockMs;
    return { locked: true, retryAfterMs: lockMs };
  }
  return { locked: false, remaining: max - rec.count };
}

function clearFails(key) {
  _fails.delete(key);
}

// Simple per-key cooldown. Returns { allowed, retryAfterMs }.
function checkCooldown(key, windowMs) {
  const now = Date.now();
  const last = _cooldowns.get(key) ?? 0;
  const elapsed = now - last;
  if (elapsed < windowMs) return { allowed: false, retryAfterMs: windowMs - elapsed };
  _cooldowns.set(key, now);
  return { allowed: true, retryAfterMs: 0 };
}

// Human-friendly "in about X" from milliseconds.
function humanDuration(ms) {
  const mins = Math.ceil(ms / 60_000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

module.exports = { checkFailGuard, registerFail, clearFails, checkCooldown, humanDuration };
