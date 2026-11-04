import type { Song } from '../shared/types.js';

/**
 * Song lookup without the Spotify Web API:
 *  - Spotify public track page / oEmbed for title, artist, cover, release year
 *  - MusicBrainz for the original release year (Spotify often shows the remaster/compilation year)
 * Everything is best effort; the admin can edit every field.
 */

const UA = 'HitsterNight/1.0 (internal party game)';

export function extractSpotifyTrackIds(text: string): string[] {
  const ids: string[] = [];
  const re = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
  const v = html.match(re)?.[1] ?? html.match(re2)?.[1] ?? null;
  return v ? decodeEntities(v) : null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

interface SpotifyInfo {
  title: string;
  artist: string;
  coverUrl: string | null;
  year: number | null;
}

export async function spotifyInfo(trackId: string): Promise<SpotifyInfo | null> {
  const url = `https://open.spotify.com/track/${trackId}`;
  let title = '';
  let artist = '';
  let coverUrl: string | null = null;
  let year: number | null = null;

  const html = await fetchText(url);
  if (html) {
    title = meta(html, 'og:title') ?? '';
    coverUrl = meta(html, 'og:image');
    const release = meta(html, 'music:release_date');
    if (release && /^\d{4}/.test(release)) year = Number(release.slice(0, 4));
    // og:description looks like "Artist · Album · Song · 1985"
    const desc = meta(html, 'og:description') ?? '';
    const parts = desc.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      artist = parts[0];
      const y = parts.find((p) => /^\d{4}$/.test(p));
      if (!year && y) year = Number(y);
    }
    if (!artist) {
      const t = html.match(/<title>([^<]*)<\/title>/i)?.[1];
      // "Song - song and lyrics by Artist | Spotify"
      const m = t && decodeEntities(t).match(/by (.+?) \| Spotify/);
      if (m) artist = m[1];
    }
  }
  if (!title || !coverUrl) {
    const o = await fetchText(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (o) {
      try {
        const j = JSON.parse(o);
        title ||= j.title ?? '';
        coverUrl ||= j.thumbnail_url ?? null;
      } catch {
        /* ignore */
      }
    }
  }
  if (!title) return null;
  return { title, artist, coverUrl, year };
}

let mbQueue = Promise.resolve();
/** MusicBrainz asks for max 1 request per second. */
function mbThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const p = mbQueue.then(fn);
  mbQueue = p.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return p;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/ - .*$/, '') // "Song - Remastered 2011"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function musicbrainzYear(title: string, artist: string): Promise<number | null> {
  if (!title || !artist) return null;
  const cleanTitle = title.replace(/ - .*$/, '').replace(/\(.*?(remaster|version|edit|mix|live).*?\)/gi, '').trim();
  const primaryArtist = artist.split(/,|&| feat\.? | ft\.? /i)[0].trim();
  const q = `recording:"${cleanTitle.replace(/"/g, '')}" AND artist:"${primaryArtist.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/recording?fmt=json&limit=25&query=${encodeURIComponent(q)}`;
  const body = await mbThrottle(() => fetchText(url));
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    const wantTitle = norm(cleanTitle);
    const wantArtist = norm(primaryArtist);
    let best: number | null = null;
    for (const rec of j.recordings ?? []) {
      if (norm(rec.title ?? '') !== wantTitle) continue;
      const credits = (rec['artist-credit'] ?? []).map((c: any) => norm(c.name ?? c.artist?.name ?? '')).join(' ');
      if (!credits.includes(wantArtist)) continue;
      const d: string | undefined = rec['first-release-date'];
      if (d && /^\d{4}/.test(d)) {
        const y = Number(d.slice(0, 4));
        if (best === null || y < best) best = y;
      }
    }
    return best;
  } catch {
    return null;
  }
}

export type NewSong = Omit<Song, 'id' | 'used'>;

export async function resolveSpotifyTrack(trackId: string): Promise<NewSong> {
  // offline testing: HITSTER_FAKE_LOOKUP=1 returns made-up songs instead of calling Spotify/MusicBrainz
  if (process.env.HITSTER_FAKE_LOOKUP === '1') {
    const n = [...trackId].reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      spotifyId: trackId, spotifyUrl: `https://open.spotify.com/track/${trackId}`, title: `Test song ${trackId.slice(0, 4)}`, artist: `Artist ${n % 50}`,
      coverUrl: null, year: 1960 + (n % 64), spotifyYear: null, musicbrainzYear: null, needsCheck: false, list: '', startAt: 0,
    };
  }
  const info = await spotifyInfo(trackId);
  const mb = info ? await musicbrainzYear(info.title, info.artist) : null;
  const sy = info?.year ?? null;
  const year = sy !== null && mb !== null ? Math.min(sy, mb) : (mb ?? sy);
  return {
    spotifyId: trackId,
    spotifyUrl: `https://open.spotify.com/track/${trackId}`,
    title: info?.title || '(unknown title)',
    artist: info?.artist || '',
    coverUrl: info?.coverUrl ?? null,
    year,
    spotifyYear: sy,
    musicbrainzYear: mb,
    needsCheck: !info || year === null || (sy !== null && mb !== null && sy !== mb) || !info.artist,
    list: '',
    startAt: 0,
  };
}
