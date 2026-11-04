import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server, type Socket } from 'socket.io';
import { Game, GameError, type GameData } from './game.js';
import { createStore, debouncedSaver } from './store.js';
import { extractSpotifyTrackIds, resolveSpotifyTrack, type NewSong } from './songs.js';

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'hitster';
if (!process.env.ADMIN_PASSWORD) console.warn('[auth] ADMIN_PASSWORD not set, using default "hitster"');

type Photo = { mime: string; b64: string };

async function main() {
  const kv = createStore();
  const game = new Game((await kv.load('game')) as GameData | null);
  const photos: Record<string, Photo> = ((await kv.load('photos')) as Record<string, Photo> | null) ?? {};
  const saveGame = debouncedSaver(kv, 'game', () => game.data);
  const savePhotos = debouncedSaver(kv, 'photos', () => photos, 1000);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 10000, pingTimeout: 8000 });

  app.use(express.json({ limit: '3mb' }));
  app.get('/healthz', (_req, res) => res.send('ok'));

  // ---------- photos ----------
  app.post('/api/photo', (req, res) => {
    const team = game.teamByToken(req.header('x-team-token'));
    if (!team) return res.status(401).json({ error: 'Unknown team' });
    const m = String(req.body?.dataUrl ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'Invalid image' });
    if (m[2].length > 2_000_000) return res.status(413).json({ error: 'Image too large' });
    photos[team.id] = { mime: m[1], b64: m[2] };
    savePhotos.schedule();
    game.photoUpdated(team.id);
    res.json({ ok: true });
  });
  app.get('/api/photo/:teamId', (req, res) => {
    const p = photos[req.params.teamId];
    if (!p) return res.status(404).end();
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(p.b64, 'base64'));
  });

  // ---------- static client ----------
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Client not built. Run `npm run build` or use `npm run dev`.'));
  }

  // ---------- realtime ----------
  let pending = false;
  const broadcast = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      const pub = game.publicState();
      io.to('show').emit('state', pub);
      io.to('admin').emit('state', game.adminState());
      for (const [, s] of io.of('/').sockets) {
        if (s.data.role === 'player') s.emit('state', game.playerState(s.data.teamId ?? null, pub));
      }
    });
  };
  game.on('change', () => {
    saveGame.schedule();
    broadcast();
  });

  const reply = (ack: unknown, fn: () => unknown) => {
    const cb = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
    try {
      const result = fn();
      cb({ ok: true, result });
    } catch (e) {
      cb({ ok: false, error: e instanceof GameError ? e.message : 'Something went wrong' });
      if (!(e instanceof GameError)) console.error(e);
    }
  };

  const playerConnections = new Map<string, number>();
  const markConnected = (teamId: string, delta: number) => {
    const n = (playerConnections.get(teamId) ?? 0) + delta;
    playerConnections.set(teamId, Math.max(0, n));
    game.setConnected(teamId, n > 0);
  };

  io.on('connection', (socket: Socket) => {
    const { role, token, password } = (socket.handshake.auth ?? {}) as Record<string, string>;

    if (role === 'admin') {
      if (password !== ADMIN_PASSWORD) {
        socket.emit('authError', 'Wrong password');
        socket.disconnect(true);
        return;
      }
      socket.data.role = 'admin';
      socket.join('admin');
      socket.emit('state', game.adminState());
      registerAdmin(socket);
      return;
    }

    if (role === 'show') {
      socket.data.role = 'show';
      socket.join('show');
      socket.emit('state', game.publicState());
      return;
    }

    // player
    socket.data.role = 'player';
    const team = game.teamByToken(token);
    if (team) {
      socket.data.teamId = team.id;
      markConnected(team.id, +1);
    } else if (token) {
      socket.emit('tokenInvalid');
    }
    socket.emit('state', game.playerState(socket.data.teamId ?? null));

    socket.on('join', (name: string, ack) =>
      reply(ack, () => {
        if (socket.data.teamId) throw new GameError('This device already has a team');
        const t = game.join(String(name ?? ''));
        socket.data.teamId = t.id;
        markConnected(t.id, +1);
        return { token: t.token, teamId: t.id };
      }),
    );
    socket.on('rename', (name: string, ack) =>
      reply(ack, () => {
        if (!socket.data.teamId) throw new GameError('Join first');
        game.renameTeam(socket.data.teamId, String(name ?? ''));
      }),
    );
    socket.on('answer', (payload: { answer: Record<string, unknown>; confirm?: boolean }, ack) =>
      reply(ack, () => {
        if (!socket.data.teamId) throw new GameError('Join first');
        game.submitAnswer(socket.data.teamId, (payload?.answer ?? {}) as any, !!payload?.confirm);
      }),
    );
    socket.on('disconnect', () => {
      if (socket.data.teamId) markConnected(socket.data.teamId, -1);
    });
  });

  function registerAdmin(socket: Socket) {
    socket.on('admin', (action: { type: string; [k: string]: any }, ack) => {
      if (action?.type === 'importSongs') return importSongs(socket, String(action.text ?? ''), ack);
      reply(ack, () => {
        const a = action ?? { type: '' };
        switch (a.type) {
          case 'settings': return game.updateSettings(a.patch ?? {});
          case 'addSong': return game.addSongs([manualSong(a.song)]);
          case 'updateSong': return game.updateSong(a.songId, a.patch ?? {});
          case 'removeSong': return game.removeSong(a.songId);
          case 'moveSong': return game.moveSong(a.songId, Number(a.delta) || 0);
          case 'shuffleSongs': return game.shuffleSongs();
          case 'updateTeam': return game.adminUpdateTeam(a.teamId, a.patch ?? {});
          case 'removeTeam':
            delete photos[a.teamId];
            savePhotos.schedule();
            for (const [, s] of io.of('/').sockets) {
              if (s.data.teamId === a.teamId) {
                s.data.teamId = undefined;
                s.emit('tokenInvalid');
              }
            }
            playerConnections.delete(a.teamId);
            return game.removeTeam(a.teamId);
          case 'startShow': return game.startShow();
          case 'showIntro': return game.showIntro();
          case 'nextSong': return game.nextSong(a.songId);
          case 'startRound': return game.startRound();
          case 'addTime': return game.addTime(Number(a.seconds) || 15);
          case 'endRound': return game.endRound();
          case 'reveal': return game.reveal();
          case 'judge': return game.judge(a.teamId, a.field, a.value);
          case 'placement': return game.overridePlacement(a.teamId, !!a.value);
          case 'commit': return game.commit();
          case 'scoreboard': return game.showScoreboard();
          case 'resetGame': return game.resetGame();
          default: throw new GameError(`Unknown action ${a.type}`);
        }
      });
    });
  }

  function manualSong(s: any): NewSong {
    const year = s?.year ? Number(s.year) : null;
    const ids = extractSpotifyTrackIds(String(s?.spotifyUrl ?? ''));
    if (!String(s?.title ?? '').trim()) throw new GameError('Title is required');
    return {
      spotifyId: ids[0] ?? null,
      spotifyUrl: ids[0] ? `https://open.spotify.com/track/${ids[0]}` : null,
      title: String(s.title).trim(),
      artist: String(s.artist ?? '').trim(),
      year: Number.isFinite(year) ? year : null,
      coverUrl: s.coverUrl ? String(s.coverUrl) : null,
      spotifyYear: null,
      musicbrainzYear: null,
      needsCheck: false,
      bonus: !!s.bonus,
    };
  }

  let importing = false;
  async function importSongs(socket: Socket, text: string, ack: unknown) {
    const cb = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
    if (importing) return cb({ ok: false, error: 'An import is already running' });
    const ids = extractSpotifyTrackIds(text);
    if (ids.length === 0) {
      const playlist = /playlist|album/.test(text);
      return cb({
        ok: false,
        error: playlist
          ? 'Playlist/album links cannot be read. Open the playlist in the Spotify desktop app, select all songs (Ctrl+A), copy (Ctrl+C) and paste here.'
          : 'No Spotify track links found.',
      });
    }
    const existing = new Set(game.data.songs.map((s) => s.spotifyId));
    const todo = ids.filter((i) => !existing.has(i));
    cb({ ok: true, result: { queued: todo.length, skipped: ids.length - todo.length } });
    importing = true;
    try {
      let done = 0;
      for (const trackId of todo) {
        const song = await resolveSpotifyTrack(trackId);
        game.addSongs([song]);
        done++;
        io.to('admin').emit('importProgress', { done, total: todo.length });
      }
    } finally {
      importing = false;
      io.to('admin').emit('importProgress', null);
    }
  }

  const shutdown = async () => {
    await Promise.all([saveGame.flushNow(), savePhotos.flushNow()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(PORT, () => console.log(`Hitster running on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
