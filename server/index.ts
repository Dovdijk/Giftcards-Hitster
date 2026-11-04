import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server, type Socket } from 'socket.io';
import { GameError } from './game.js';
import { createStore } from './store.js';
import { extractSpotifyTrackIds, resolveSpotifyTrack, type NewSong } from './songs.js';
import { Accounts, AuthError, SESSION_COOKIE, parseCookies, type User } from './accounts.js';
import { Registry, type Entry } from './registry.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const kv = createStore();
  const accounts = new Accounts(kv);
  await accounts.load();
  const registry = new Registry(kv);
  await registry.load();

  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 10000, pingTimeout: 8000 });

  app.use(express.json({ limit: '3mb' }));
  app.get('/healthz', (_req, res) => res.send('ok'));

  // ---------- auth helpers ----------
  const sessionToken = (req: Request) => parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const currentUser = (req: Request) => accounts.userFromSession(sessionToken(req));
  const setSession = (req: Request, res: Response, userId: string) => {
    res.cookie(SESSION_COOKIE, accounts.createSession(userId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 30 * 86400_000,
      path: '/',
    });
  };
  const canManage = (u: User | null, e: Entry | null) => !!u && !!e && (e.meta.ownerId === u.id || accounts.isSuperAdmin(u));

  type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
  const api = (fn: Handler) => async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AuthError || e instanceof GameError) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
  const requireUser = (req: Request) => {
    const u = currentUser(req);
    if (!u) throw new AuthError('Please log in');
    return u;
  };
  const ownedGame = (req: Request) => {
    const u = requireUser(req);
    const e = registry.byId(String(req.params.id));
    if (!canManage(u, e)) throw new AuthError('Game not found');
    return e!;
  };

  // ---------- account API ----------
  app.post('/api/signup', api(async (req, res) => {
    const u = await accounts.signup(req.body?.name, req.body?.email, req.body?.password);
    setSession(req, res, u.id);
    return { user: accounts.publicUser(u) };
  }));
  app.post('/api/login', api(async (req, res) => {
    const u = await accounts.login(req.body?.email, req.body?.password, req.ip ?? '');
    setSession(req, res, u.id);
    return { user: accounts.publicUser(u) };
  }));
  app.post('/api/logout', api((req, res) => {
    accounts.destroySession(sessionToken(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));
  app.get('/api/me', api((req) => {
    const u = currentUser(req);
    return { user: u ? accounts.publicUser(u) : null };
  }));
  app.post('/api/me/password', api(async (req) => {
    const u = requireUser(req);
    await accounts.changeOwnPassword(u.id, req.body?.current, req.body?.next);
    return { ok: true };
  }));

  // ---------- games API ----------
  app.get('/api/games', api((req) => {
    const u = requireUser(req);
    const all = req.query.all === '1' && accounts.isSuperAdmin(u);
    const list = registry.forOwner(all ? null : u.id).map((e) => ({
      ...registry.summary(e),
      ownerName: accounts.user(e.meta.ownerId)?.name ?? '?',
    }));
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return { games: list };
  }));
  app.post('/api/games', api((req) => {
    const u = requireUser(req);
    if (registry.forOwner(u.id).length >= 50) throw new AuthError('You have reached the maximum of 50 games');
    const e = registry.create(u.id, req.body?.name);
    return { game: registry.summary(e) };
  }));
  app.post('/api/games/:id/duplicate', api((req) => {
    const src = ownedGame(req);
    const u = requireUser(req);
    const e = registry.create(u.id, req.body?.name || `${src.meta.name} (copy)`, src);
    return { game: registry.summary(e) };
  }));
  app.patch('/api/games/:id', api((req) => {
    const e = ownedGame(req);
    if (req.body?.name !== undefined) registry.rename(e, req.body.name);
    return { game: registry.summary(e) };
  }));
  app.delete('/api/games/:id', api(async (req) => {
    const e = ownedGame(req);
    io.to(`g:${e.meta.id}`).emit('gameDeleted');
    io.in(`g:${e.meta.id}`).disconnectSockets(true);
    await registry.remove(e);
    return { ok: true };
  }));
  app.get('/api/join/:code', api((req) => {
    const e = registry.byCode(String(req.params.code));
    if (!e) throw new GameError('No game with this code');
    return { game: e.game.info };
  }));

  // ---------- super admin ----------
  const requireSuper = (req: Request) => {
    const u = requireUser(req);
    if (!accounts.isSuperAdmin(u)) throw new AuthError('Not allowed');
    return u;
  };
  app.get('/api/admin/users', api((req) => {
    requireSuper(req);
    return {
      users: accounts.users.map((u) => ({ ...accounts.publicUser(u), createdAt: u.createdAt, games: registry.forOwner(u.id).length })),
    };
  }));
  app.post('/api/admin/users/:id/password', api(async (req) => {
    requireSuper(req);
    await accounts.setPassword(String(req.params.id), req.body?.password);
    return { ok: true };
  }));

  // ---------- photos ----------
  app.post('/api/photo/:code', (req, res) => {
    const e = registry.byCode(String(req.params.code));
    const team = e?.game.teamByToken(req.header('x-team-token'));
    if (!e || !team) return res.status(401).json({ error: 'Unknown team' });
    const m = String(req.body?.dataUrl ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'Invalid image' });
    if (m[2].length > 2_000_000) return res.status(413).json({ error: 'Image too large' });
    e.photos[team.id] = { mime: m[1], b64: m[2] };
    e.savePhotos.schedule();
    e.game.photoUpdated(team.id);
    res.json({ ok: true });
  });
  app.get('/api/photo/:gameId/:teamId', (req, res) => {
    const p = registry.byId(String(req.params.gameId))?.photos[String(req.params.teamId)];
    if (!p) return res.status(404).end();
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(p.b64, 'base64'));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- static client ----------
  const clientDir = path.resolve('dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Client not built. Run `npm run build` or use `npm run dev`.'));
  }

  // ---------- realtime ----------
  const pendingBroadcast = new Set<string>();
  const broadcast = (entry: Entry) => {
    const id = entry.meta.id;
    if (pendingBroadcast.has(id)) return;
    pendingBroadcast.add(id);
    setImmediate(() => {
      pendingBroadcast.delete(id);
      if (!registry.byId(id)) return;
      const g = entry.game;
      const pub = g.publicState();
      io.to(`g:${id}:show`).emit('state', pub);
      io.to(`g:${id}:admin`).emit('state', g.adminState());
      for (const s of io.sockets.adapter.rooms.get(`g:${id}:players`) ?? []) {
        const sock = io.sockets.sockets.get(s);
        if (sock) sock.emit('state', g.playerState(sock.data.teamId ?? null, pub));
      }
    });
  };
  registry.on('change', (entry: Entry) => broadcast(entry));

  const reply = (ack: unknown, fn: () => unknown) => {
    const cb = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
    try {
      cb({ ok: true, result: fn() });
    } catch (e) {
      cb({ ok: false, error: e instanceof GameError ? e.message : 'Something went wrong' });
      if (!(e instanceof GameError)) console.error(e);
    }
  };

  // connection count per team, so "online" survives a second tab/refresh
  const playerConnections = new Map<string, number>();
  const markConnected = (entry: Entry, teamId: string, delta: number) => {
    const key = `${entry.meta.id}:${teamId}`;
    const n = Math.max(0, (playerConnections.get(key) ?? 0) + delta);
    playerConnections.set(key, n);
    entry.game.setConnected(teamId, n > 0);
  };

  io.on('connection', (socket: Socket) => {
    const { role, token, code, gameId } = (socket.handshake.auth ?? {}) as Record<string, string>;

    if (role === 'admin') {
      const user = accounts.userFromSession(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
      const entry = registry.byId(gameId);
      if (!user) {
        socket.emit('authError', 'Please log in');
        return void socket.disconnect(true);
      }
      if (!canManage(user, entry)) {
        socket.emit('authError', 'Game not found');
        return void socket.disconnect(true);
      }
      socket.data.role = 'admin';
      socket.join([`g:${entry!.meta.id}`, `g:${entry!.meta.id}:admin`]);
      socket.emit('state', entry!.game.adminState());
      registerAdmin(socket, entry!);
      return;
    }

    const entry = registry.byCode(code);
    if (!entry) {
      socket.emit('authError', 'No game with this code');
      return void socket.disconnect(true);
    }
    const game = entry.game;

    if (role === 'show') {
      socket.data.role = 'show';
      socket.join([`g:${entry.meta.id}`, `g:${entry.meta.id}:show`]);
      socket.emit('state', game.publicState());
      return;
    }

    // player
    socket.data.role = 'player';
    socket.join([`g:${entry.meta.id}`, `g:${entry.meta.id}:players`]);
    const team = game.teamByToken(token);
    if (team) {
      socket.data.teamId = team.id;
      markConnected(entry, team.id, +1);
    } else if (token) {
      socket.emit('tokenInvalid');
    }
    socket.emit('state', game.playerState(socket.data.teamId ?? null));

    socket.on('join', (name: string, ack) =>
      reply(ack, () => {
        if (socket.data.teamId) throw new GameError('This device already has a team');
        const t = game.join(String(name ?? ''));
        socket.data.teamId = t.id;
        markConnected(entry, t.id, +1);
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
      if (socket.data.teamId && registry.byId(entry.meta.id)) markConnected(entry, socket.data.teamId, -1);
    });
  });

  function registerAdmin(socket: Socket, entry: Entry) {
    const game = entry.game;
    socket.on('admin', (action: { type: string; [k: string]: any }, ack) => {
      if (action?.type === 'importSongs') return importSongs(entry, String(action.text ?? ''), String(action.list ?? ''), ack);
      if (action?.type === 'blindSetup') return blindSetup(entry, action, ack);
      reply(ack, () => {
        const a = action ?? { type: '' };
        switch (a.type) {
          case 'settings': return game.updateSettings(a.patch ?? {});
          case 'addSong': return game.addSongs([manualSong(a.song)]);
          case 'updateSong': return game.updateSong(a.songId, a.patch ?? {});
          case 'removeSong': return game.removeSong(a.songId);
          case 'moveSong': return game.moveSong(a.songId, Number(a.delta) || 0);
          case 'shuffleSongs': return game.shuffleSongs(String(a.list ?? ''));
          case 'addStage': return game.addStage();
          case 'updateStage': return game.updateStage(a.stageId, a.patch ?? {});
          case 'removeStage': return game.removeStage(a.stageId);
          case 'moveStage': return game.moveStage(a.stageId, Number(a.delta) || 0);
          case 'nextStage': return game.nextStage();
          case 'finishEvening': return game.finishEvening();
          case 'nextAward': return game.nextAward();
          case 'skipAwards': return game.skipAwards();
          case 'updateTeam': return game.adminUpdateTeam(a.teamId, a.patch ?? {});
          case 'removeTeam': {
            delete entry.photos[a.teamId];
            entry.savePhotos.schedule();
            for (const s of io.sockets.adapter.rooms.get(`g:${entry.meta.id}:players`) ?? []) {
              const sock = io.sockets.sockets.get(s);
              if (sock && sock.data.teamId === a.teamId) {
                sock.data.teamId = undefined;
                sock.emit('tokenInvalid');
              }
            }
            playerConnections.delete(`${entry.meta.id}:${a.teamId}`);
            return game.removeTeam(a.teamId);
          }
          case 'startShow': return game.startShow();
          case 'showIntro': return game.showIntro();
          case 'nextSong': return game.nextSong(a.songId);
          case 'practiceSong': return game.practiceSong();
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
    const startAt = Math.max(0, Math.round(Number(s?.startAt) || 0));
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
      list: String(s.list ?? ''),
      startAt,
    };
  }

  const importing = new Set<string>();
  async function importSongs(entry: Entry, text: string, list: string, ack: unknown) {
    const cb = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
    const id = entry.meta.id;
    if (importing.has(id)) return cb({ ok: false, error: 'An import is already running' });
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
    if (!entry.game.data.stages.some((s) => s.id === list) && !['bonus', 'music', 'practice'].includes(list)) return cb({ ok: false, error: 'Pick a song list first' });
    // the same song may not be in two game lists (it would be played twice); music may repeat
    const existing = new Set(entry.game.data.songs.filter((s) => (list === 'music' ? s.list === 'music' : s.list !== 'music')).map((s) => s.spotifyId));
    const todo = ids.filter((i) => !existing.has(i)).slice(0, 300);
    cb({ ok: true, result: { queued: todo.length, skipped: ids.length - todo.length } });
    importing.add(id);
    try {
      let done = 0;
      for (const trackId of todo) {
        if (!registry.byId(id)) break;
        const song = await resolveSpotifyTrack(trackId);
        if (!entry.game.data.stages.some((s) => s.id === list) && !['bonus', 'music', 'practice'].includes(list)) break;
        entry.game.addSongs([{ ...song, list }]);
        done++;
        io.to(`g:${id}:admin`).emit('importProgress', { done, total: todo.length });
      }
    } finally {
      importing.delete(id);
      io.to(`g:${id}:admin`).emit('importProgress', null);
    }
  }

  /**
   * Blind setup: pick random songs from a big pasted playlist and spread them over the rounds,
   * so the host can play along without knowing the answers.
   */
  async function blindSetup(entry: Entry, a: Record<string, any>, ack: unknown) {
    const cb = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
    const id = entry.meta.id;
    const game = entry.game;
    if (importing.has(id)) return cb({ ok: false, error: 'An import is already running' });
    if (game.data.phase !== 'lobby') return cb({ ok: false, error: 'Blind setup is only possible before the show starts' });
    const rounds = Math.min(12, Math.max(1, Math.round(Number(a.rounds) || 0)));
    const perRound = Math.min(40, Math.max(1, Math.round(Number(a.perRound) || 0)));
    const practice = Math.min(2, Math.max(0, Math.round(Number(a.practice) || 0)));
    const bonus = Math.min(5, Math.max(0, Math.round(Number(a.bonus) || 0)));
    const existing = new Set(game.data.songs.map((s) => s.spotifyId));
    const pool = extractSpotifyTrackIds(String(a.text ?? '')).filter((x) => !existing.has(x));
    const need = rounds * perRound + practice + bonus;
    if (pool.length < need) return cb({ ok: false, error: `Paste at least ${need} songs (found ${pool.length} new Spotify links). A bigger playlist also keeps more surprise.` });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    try {
      while (game.data.stages.length < rounds) game.addStage();
    } catch (e) {
      return cb({ ok: false, error: e instanceof GameError ? e.message : 'Could not add rounds' });
    }
    game.updateSettings({ blind: true });
    const stageIds = game.data.stages.slice(0, rounds).map((s) => s.id);
    // which list gets the next song: practice first, then bonus, then the rounds in turn
    const slots: string[] = [
      ...Array(practice).fill('practice'),
      ...Array(bonus).fill('bonus'),
      ...Array.from({ length: rounds * perRound }, (_, i) => stageIds[i % rounds]),
    ];
    cb({ ok: true, result: { queued: need } });
    importing.add(id);
    let done = 0;
    let skipped = 0;
    try {
      for (const trackId of pool) {
        if (done >= slots.length || !registry.byId(id)) break;
        const song = await resolveSpotifyTrack(trackId);
        // without a year we can't use it (and the host shouldn't look it up): take another one
        if (song.year === null || song.title === '(unknown title)') {
          skipped++;
          continue;
        }
        const list = slots[done];
        if (!['practice', 'bonus'].includes(list) && !game.data.stages.some((s) => s.id === list)) break;
        game.addSongs([{ ...song, list, needsCheck: false }]);
        done++;
        io.to(`g:${id}:admin`).emit('importProgress', { done, total: slots.length });
      }
    } finally {
      importing.delete(id);
      io.to(`g:${id}:admin`).emit('importProgress', null);
      io.to(`g:${id}:admin`).emit('blindDone', { done, total: slots.length, skipped });
    }
  }

  const shutdown = async () => {
    await Promise.all([registry.flush(), accounts.flush()]);
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
