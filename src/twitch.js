// Twitch stream-status helpers for the "update the VOD link" nudge.
//
// When an organizer sets a match's streamUrl to a live channel link
// (twitch.tv/<channel>), it shows a live preview on the site. Once the broadcast
// ends, Twitch keeps that URL pointing at an (offline) channel — the site can no
// longer show the match's recording. We detect the broadcast going offline and
// DM the organizer to swap the link to the VOD (twitch.tv/videos/<id>).

// Parse a URL that may be missing its scheme (users paste bare links).
function parseUrlLoose(url) {
  const s = (url ?? '').trim();
  if (!s) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

// Channel name for a bare twitch.tv/<channel> link, else null. VOD (/videos/…)
// and clip links return null — they're already a permanent recording, so they
// never need the swap.
function twitchChannel(url) {
  const u = parseUrlLoose(url);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (host !== 'twitch.tv') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return null;
  const reserved = new Set(['videos', 'clip', 'directory', 'settings', 'p', 'team']);
  if (reserved.has(parts[0].toLowerCase())) return null;
  return parts[0];
}

// Is this stream URL a live-channel link (as opposed to a VOD/clip)?
function isLiveChannelUrl(url) {
  return twitchChannel(url) !== null;
}

// Determine whether a Twitch channel is currently OFFLINE.
//   returns true  → confirmed offline
//   returns false → confirmed live
//   returns null  → couldn't determine (network error) — caller should not act
//
// Twitch doesn't 404 an offline channel's preview image; it 302-redirects to a
// generic "404_preview" placeholder that still returns 200. So we fetch the
// preview following redirects and inspect the FINAL url.
async function isChannelOffline(channelName) {
  if (!channelName) return null;
  const url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channelName.toLowerCase()}-640x360.jpg?_=${Date.now()}`;
  try {
    // Node 18+ global fetch. redirect:'follow' is the default, but be explicit.
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return /404_preview/i.test(res.url);
  } catch {
    return null;
  }
}

module.exports = { twitchChannel, isLiveChannelUrl, isChannelOffline };
