// Automatic notifications — polls the website's data every minute and posts:
//   • result cards (with MVP + a unique stat-based flavor line) when a match
//     finishes on clutchgg.in
//   • reminders 15 minutes before a scheduled match (tags team roles if the
//     server has roles named after the teams)
//   • end-of-day standings once all of a day's matches are done
//   • onboarding: DMs superadmins when an approved tournament request with
//     Discord IDs has no /link-tournament yet; posts the setup guide when a
//     server gets linked
// Every send is deduped through bot_notification_log, so restarts never
// double-post.
const { EmbedBuilder } = require('discord.js');
const { supabase, getTournaments } = require('./supabase');
const { matchUrl, tournamentUrl, deriveScore, realMatches, computeRRStandings, textTable } = require('./tournament-utils');
const { matchMvp } = require('./mvp');

const POLL_MS = 60_000;

// ── Dedup log ────────────────────────────────────────────────────────────────

async function alreadySent(tournamentId, kind, ref) {
  const { data, error } = await supabase()
    .from('bot_notification_log')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('kind', kind)
    .eq('ref', ref)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markSent(tournamentId, kind, ref) {
  await supabase()
    .from('bot_notification_log')
    .upsert({ tournament_id: tournamentId, kind, ref }, { onConflict: 'tournament_id,kind,ref', ignoreDuplicates: true });
}

async function getAllLinks() {
  const { data, error } = await supabase().from('tournament_discord_links').select('*');
  if (error) throw error;
  return data ?? [];
}

async function getPendingOnboardRequests() {
  const { data, error } = await supabase()
    .from('tournament_requests')
    .select('id, organizer_name, tournament_name, discord_ids, created_tournament_id')
    .eq('status', 'approved')
    .not('created_tournament_id', 'is', null)
    .not('discord_ids', 'is', null);
  if (error) throw error;
  return data ?? [];
}

// ── Flavor lines — a different, stat-driven line on every result card ────────

const FLAVOR = {
  sweep: [
    (w, mvp) => `A clean sweep — **${w}** never let go of the wheel.`,
    (w, mvp) => `Ruthless. **${w}** closed it out without dropping a map.`,
    (w, mvp) => `**${w}** came, saw, and swept.`,
  ],
  close: [
    (w) => `A nail-biter to the very last round — **${w}** survives the scare.`,
    (w) => `Down to the wire! **${w}** edges out a thriller.`,
    (w) => `Both teams left everything on the server, but **${w}** found one more gear.`,
  ],
  mvpMonster: [
    (w, mvp) => `**${mvp.name}** went nuclear — ${mvp.acs} ACS is video-game numbers.`,
    (w, mvp) => `Someone check **${mvp.name}**'s settings — ${mvp.kills} kills at ${mvp.acs} ACS. Wonderful performance by ${w}.`,
    (w, mvp) => `A masterclass from **${mvp.name}** (${mvp.kills}/${mvp.deaths}/${mvp.assists}) carried the night.`,
  ],
  default: [
    (w) => `Wonderful performance by **${w}** — on to the next one!`,
    (w) => `**${w}** take it and keep the run alive.`,
    (w) => `GGs! **${w}** get their hand raised.`,
    (w) => `That's a statement win for **${w}**.`,
  ],
};

// Deterministic per-match pick (stable across restarts), varied across matches.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function flavorLine(match, winnerName, mvp, score) {
  const total = score.s1 + score.s2;
  const diff = Math.abs(score.s1 - score.s2);
  let pool;
  if (mvp && (mvp.acs >= 300 || mvp.kd >= 2.5)) pool = FLAVOR.mvpMonster;
  else if (total >= 2 && Math.min(score.s1, score.s2) === 0) pool = FLAVOR.sweep;
  else if (total >= 3 && diff === 1) pool = FLAVOR.close;
  else pool = FLAVOR.default;
  return pool[hashStr(match.id) % pool.length](winnerName, mvp);
}

// ── Embed builders ───────────────────────────────────────────────────────────

function resultCard(t, item) {
  const m = item.match;
  const { s1, s2 } = deriveScore(m);
  const winnerName = s1 > s2 ? m.team1Name : m.team2Name;
  const mvp = matchMvp(t, m);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${m.team1Name} ${s1} : ${s2} ${m.team2Name}`)
    .setDescription(
      `${flavorLine(m, winnerName, mvp, { s1, s2 })}\n\n[📊 Full stats, maps & round-by-round →](${matchUrl(m.id)})`
    )
    .setURL(matchUrl(m.id))
    .setColor(0x22c55e)
    .setFooter({ text: `${t.name} · ${item.stage}` })
    .setTimestamp(new Date());

  if (mvp) {
    embed.addFields({
      name: '⭐ Match MVP',
      value: `**${mvp.name}** (${mvp.teamName})${mvp.agent ? ` · ${mvp.agent}` : ''}\n${mvp.kills}/${mvp.deaths}/${mvp.assists} · ${mvp.acs} ACS · ${mvp.kd} K/D`,
    });
  }
  const maps = (m.maps ?? []).filter((mp) => mp.mapName || mp.team1Score || mp.team2Score);
  if (maps.length) {
    embed.addFields({
      name: 'Maps',
      value: maps.map((mp) => `${mp.mapName || 'Map'}: ${mp.team1Score}-${mp.team2Score}`).join(' · ').slice(0, 1024),
    });
  }
  return embed;
}

async function reminderCard(guild, t, item) {
  const m = item.match;
  // Tag roles named after the teams when the server has them.
  const tagFor = async (teamName) => {
    try {
      const roles = await guild.roles.fetch();
      const role = roles.find((r) => r.name.toLowerCase() === teamName.toLowerCase());
      return role ? `<@&${role.id}>` : `**${teamName}**`;
    } catch {
      return `**${teamName}**`;
    }
  };
  const tag1 = await tagFor(m.team1Name);
  const tag2 = await tagFor(m.team2Name);

  return new EmbedBuilder()
    .setTitle('⏰ Match starting in ~15 minutes!')
    .setDescription(
      `${tag1} vs ${tag2}\n${item.stage} · ${m.date} ${m.time}${m.format ? ` · ${m.format.toUpperCase()}` : ''}\n` +
      `${m.streamUrl ? `📺 [Watch live](${m.streamUrl})\n` : ''}[Match page →](${matchUrl(m.id)})`
    )
    .setColor(0xf59e0b)
    .setFooter({ text: t.name });
}

function eodCard(t, todaysItems) {
  const lines = todaysItems.map(({ match: m }) => {
    const { s1, s2 } = deriveScore(m);
    return `${m.team1Name} **${s1} : ${s2}** ${m.team2Name}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🌙 That's a wrap on today — ${t.name}`)
    .setDescription(lines.join('\n').slice(0, 3800))
    .setURL(tournamentUrl(t.id))
    .setColor(0x8b5cf6)
    .setTimestamp(new Date());

  const rr = t.stage1Bracket?.bracketType === 'roundrobin' ? t.stage1Bracket
    : t.generatedBracket?.bracketType === 'roundrobin' ? t.generatedBracket : null;
  if (rr) {
    const rows = computeRRStandings(rr.rounds ?? [], rr.rrTeams ?? [], rr.pointsPerWin);
    if (rows.length) {
      const table = textTable(
        ['#', 'Team', 'W-L', 'Pts'],
        rows.map((r, i) => [i + 1, r.teamName.slice(0, 18), `${r.wins}-${r.losses}`, r.points])
      );
      embed.addFields({ name: 'Standings after today', value: '```\n' + table.slice(0, 1000) + '\n```' });
    }
  }
  return embed;
}

function welcomeCard(t, link) {
  const organizers = (link.discord_user_ids || []).map((id) => `<@${id}>`).join(' ');
  return new EmbedBuilder()
    .setTitle(`🎉 ${t.name} is connected to ClutchGG!`)
    .setDescription(
      `${organizers} — your tournament is live at ${tournamentUrl(t.id)} and this server is now its control room.\n\n` +
      '**Suggested setup order:**\n' +
      '1️⃣ `/set-details` — description, dates, prize pool\n' +
      '2️⃣ `/import-teams` — get the .xlsx template, then upload it filled\n' +
      '3️⃣ `/set-bracket` — single/double elim or round robin (per stage for two-stage)\n' +
      '4️⃣ `/assign-slot` — place teams into the bracket\n' +
      '5️⃣ `/update-match` — dates, times, bo1/bo3/bo5, stream links\n' +
      '6️⃣ `/post what:upcoming` — announce the schedule here\n' +
      '7️⃣ `/lock-tournament` — freeze everything once ready\n\n' +
      'ℹ️ `/help` explains every command. Results are auto-posted here as matches finish — with MVP callouts. Reminders go out 15 minutes before each match.'
    )
    .setColor(0xff4655);
}

// ── The poller ───────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function sendTo(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;
  await channel.send(payload);
  return true;
}

async function tick(client) {
  const [links, tournaments] = await Promise.all([getAllLinks(), getTournaments()]);
  const byId = new Map(tournaments.map((t) => [t.id, t]));

  for (const link of links) {
    const t = byId.get(link.tournament_id);
    if (!t || !link.channels) continue;
    const prefs = link.prefs ?? {};
    const announceCh = link.channels.announce;
    const scheduleCh = link.channels.schedule ?? announceCh;
    const resultsCh = link.channels.results ?? announceCh;

    // Welcome / onboarding guide (once per link).
    if (announceCh && !(await alreadySent(t.id, 'welcome', t.id))) {
      if (await sendTo(client, announceCh, { embeds: [welcomeCard(t, link)] })) {
        await markSent(t.id, 'welcome', t.id);
        console.log(`[NOTIFY] welcome posted for ${t.name}`);
      }
    }

    const items = realMatches(t);

    // First time we see this tournament: silently mark everything already
    // completed as "sent" so a fresh deploy doesn't flood the channel with
    // months-old results. Only matches finishing AFTER seeding get posted.
    if (!(await alreadySent(t.id, 'seeded', t.id))) {
      for (const item of items.filter((i) => i.status === 'completed')) {
        await markSent(t.id, 'result', item.match.id);
      }
      await markSent(t.id, 'eod', todayStr());
      await markSent(t.id, 'seeded', t.id);
      console.log(`[NOTIFY] seeded existing results for ${t.name}`);
    }

    // Result cards.
    if (resultsCh && prefs.results !== false) {
      for (const item of items.filter((i) => i.status === 'completed')) {
        if (await alreadySent(t.id, 'result', item.match.id)) continue;
        if (await sendTo(client, resultsCh, { embeds: [resultCard(t, item)] })) {
          await markSent(t.id, 'result', item.match.id);
          console.log(`[NOTIFY] result posted: ${item.match.team1Name} vs ${item.match.team2Name}`);
        }
      }
    }

    // 15-minute reminders.
    if (scheduleCh && prefs.reminders !== false) {
      const now = Date.now();
      for (const item of items.filter((i) => i.status === 'upcoming' && i.match.date && i.match.time)) {
        const start = new Date(`${item.match.date}T${item.match.time}`).getTime();
        if (Number.isNaN(start)) continue;
        const minsAway = (start - now) / 60000;
        if (minsAway <= 0 || minsAway > 15) continue;
        if (await alreadySent(t.id, 'reminder', item.match.id)) continue;
        const channel = await client.channels.fetch(scheduleCh).catch(() => null);
        if (!channel) continue;
        const embed = await reminderCard(channel.guild, t, item);
        await channel.send({ embeds: [embed] });
        await markSent(t.id, 'reminder', item.match.id);
        console.log(`[NOTIFY] reminder sent: ${item.match.team1Name} vs ${item.match.team2Name}`);
      }
    }

    // End-of-day summary once all of today's matches are completed.
    if (announceCh && prefs.daily !== false) {
      const today = todayStr();
      const todays = items.filter((i) => i.match.date === today);
      if (todays.length > 0 && todays.every((i) => i.status === 'completed')) {
        if (!(await alreadySent(t.id, 'eod', today))) {
          if (await sendTo(client, announceCh, { embeds: [eodCard(t, todays)] })) {
            await markSent(t.id, 'eod', today);
            console.log(`[NOTIFY] end-of-day posted for ${t.name} (${today})`);
          }
        }
      }
    }
  }

  // Onboarding: approved requests with Discord IDs but no link yet → nudge
  // superadmins to run /link-tournament in the tournament's server.
  const linkedIds = new Set(links.map((l) => l.tournament_id));
  const superadmins = (process.env.SUPERADMIN_DISCORD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (superadmins.length) {
    for (const req of await getPendingOnboardRequests()) {
      if (linkedIds.has(req.created_tournament_id)) continue;
      if (await alreadySent(req.created_tournament_id, 'onboard-dm', req.id)) continue;
      const t = byId.get(req.created_tournament_id);
      const embed = new EmbedBuilder()
        .setTitle('🆕 Tournament ready to link to Discord')
        .setDescription(
          `**${req.tournament_name}** (organizer: ${req.organizer_name}) was approved and their form lists Discord IDs: \`${req.discord_ids}\`.\n\n` +
          `Run \`/link-tournament tournament_id:${req.created_tournament_id}\` in their server to hand them the bot.` +
          (t ? `\n${tournamentUrl(t.id)}` : '')
        )
        .setColor(0x00b0f4);
      let sent = false;
      for (const id of superadmins) {
        try {
          const user = await client.users.fetch(id);
          await user.send({ embeds: [embed] });
          sent = true;
        } catch (e) {
          console.error(`[NOTIFY] could not DM superadmin ${id}:`, e.message);
        }
      }
      if (sent) await markSent(req.created_tournament_id, 'onboard-dm', req.id);
    }
  }
}

function start(client) {
  const run = () => tick(client).catch((e) => console.error('[NOTIFY] tick failed:', e.message));
  setTimeout(run, 10_000); // first pass shortly after startup
  setInterval(run, POLL_MS);
  console.log(`[NOTIFY] poller started (every ${POLL_MS / 1000}s)`);
}

module.exports = { start };
