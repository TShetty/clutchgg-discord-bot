// Supabase client for the bot. Uses the service_role key (set only in the
// hosting env, never in git) — the bot is a trusted backend and enforces
// organizer authorization itself (see permissions.js), per INSTRUCTIONS.md.
const { createClient } = require('@supabase/supabase-js');

// Lazy-initialized so modules that merely require() this file (e.g. command
// registration) don't crash when DB env vars aren't set. Any actual DB call
// without credentials throws a clear error instead.
let _client = null;
function supabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var');
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// ─── Tournaments (stored as one JSON blob per row, same as the website) ──────

async function getTournaments() {
  const { data, error } = await supabase()
    .from('tournaments_blob')
    .select('data')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.data);
}

async function getTournamentById(id) {
  const { data, error } = await supabase()
    .from('tournaments_blob')
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

async function upsertTournament(tournament) {
  const { error } = await supabase()
    .from('tournaments_blob')
    .upsert(
      { id: tournament.id, data: tournament, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  if (error) throw error;
}

// ─── Discord links (tournament ↔ organizer Discord IDs + channels) ───────────

async function getDiscordLink(tournamentId) {
  const { data, error } = await supabase()
    .from('tournament_discord_links')
    .select('*')
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// All tournaments linked to a guild — a server can host several (an organizer
// running multiple events). Newest updated first.
async function getDiscordLinksByGuild(guildId) {
  const { data, error } = await supabase()
    .from('tournament_discord_links')
    .select('*')
    .eq('discord_guild_id', guildId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function getLinkByClaimCode(tournamentId, code) {
  const { data, error } = await supabase()
    .from('tournament_discord_links')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('claim_code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertDiscordLink(link) {
  const { error } = await supabase()
    .from('tournament_discord_links')
    .upsert({ ...link, updated_at: new Date().toISOString() }, { onConflict: 'tournament_id' });
  if (error) throw error;
}

module.exports = {
  supabase,
  getTournaments,
  getTournamentById,
  upsertTournament,
  getDiscordLink,
  getDiscordLinksByGuild,
  getLinkByClaimCode,
  upsertDiscordLink,
};
