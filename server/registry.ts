import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Game, freshData, type GameData } from './game.js';
import { debouncedSaver, type KV } from './store.js';
import type { GameSummary } from '../shared/types.js';

export type Photo = { mime: string; b64: string };

export interface GameMeta {
  id: string;
  code: string;
  ownerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  meta: GameMeta;
  game: Game;
  photos: Record<string, Photo>;
  saveGame: ReturnType<typeof debouncedSaver>;
  savePhotos: ReturnType<typeof debouncedSaver>;
}

// no 0/O, 1/I/L: easy to read out loud and type on a phone
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class Registry extends EventEmitter {
  entries = new Map<string, Entry>();
  private saveIndex;

  constructor(private kv: KV) {
    super();
    this.saveIndex = debouncedSaver(kv, 'games', () => [...this.entries.values()].map((e) => e.meta), 300);
  }

  async load() {
    const metas = ((await this.kv.load('games')) as GameMeta[] | null) ?? [];
    for (const meta of metas) {
      const data = (await this.kv.load(`game:${meta.id}`)) as GameData | null;
      const photos = ((await this.kv.load(`photos:${meta.id}`)) as Record<string, Photo> | null) ?? {};
      this.attach(meta, new Game(data), photos);
    }
    console.log(`[registry] loaded ${this.entries.size} games`);
  }

  private attach(meta: GameMeta, game: Game, photos: Record<string, Photo>) {
    game.info = { id: meta.id, code: meta.code, name: meta.name };
    const entry: Entry = {
      meta,
      game,
      photos,
      saveGame: debouncedSaver(this.kv, `game:${meta.id}`, () => game.data),
      savePhotos: debouncedSaver(this.kv, `photos:${meta.id}`, () => entry.photos, 1000),
    };
    game.on('change', () => {
      meta.updatedAt = Date.now();
      entry.saveGame.schedule();
      this.saveIndex.schedule();
      this.emit('change', entry);
    });
    this.entries.set(meta.id, entry);
    return entry;
  }

  private newCode() {
    const taken = new Set([...this.entries.values()].map((e) => e.meta.code));
    for (let len = 4; ; len++) {
      for (let i = 0; i < 50; i++) {
        const bytes = crypto.randomBytes(len);
        const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
        if (!taken.has(code)) return code;
      }
    }
  }

  create(ownerId: string, name: string, copyFrom?: Entry) {
    const data = freshData();
    if (copyFrom) {
      data.settings = { ...copyFrom.game.data.settings, joinOpen: true };
      data.songs = copyFrom.game.data.songs.map((s) => ({ ...s, id: crypto.randomBytes(6).toString('base64url'), used: false }));
    }
    const now = Date.now();
    const meta: GameMeta = {
      id: crypto.randomBytes(8).toString('base64url'),
      code: this.newCode(),
      ownerId,
      name: String(name ?? '').trim().slice(0, 60) || 'Hitster Night',
      createdAt: now,
      updatedAt: now,
    };
    const entry = this.attach(meta, new Game(data), {});
    entry.saveGame.schedule();
    this.saveIndex.schedule();
    return entry;
  }

  rename(entry: Entry, name: string) {
    entry.meta.name = String(name ?? '').trim().slice(0, 60) || entry.meta.name;
    entry.game.info = { ...entry.game.info, name: entry.meta.name };
    entry.meta.updatedAt = Date.now();
    this.saveIndex.schedule();
    this.emit('change', entry);
  }

  async remove(entry: Entry) {
    entry.game.dispose();
    entry.saveGame.cancel();
    entry.savePhotos.cancel();
    this.entries.delete(entry.meta.id);
    await Promise.all([this.kv.delete(`game:${entry.meta.id}`), this.kv.delete(`photos:${entry.meta.id}`)]);
    this.saveIndex.schedule();
  }

  byId(id: string | undefined) {
    return id ? (this.entries.get(id) ?? null) : null;
  }

  byCode(code: string | undefined) {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c) return null;
    for (const e of this.entries.values()) if (e.meta.code === c) return e;
    return null;
  }

  forOwner(ownerId: string | null) {
    return [...this.entries.values()].filter((e) => ownerId === null || e.meta.ownerId === ownerId);
  }

  summary(e: Entry): GameSummary {
    const d = e.game.data;
    return {
      id: e.meta.id,
      code: e.meta.code,
      name: e.meta.name,
      ownerId: e.meta.ownerId,
      createdAt: e.meta.createdAt,
      updatedAt: e.meta.updatedAt,
      phase: d.phase,
      teams: d.teams.length,
      songs: d.songs.length,
      songsToCheck: d.songs.filter((s) => s.needsCheck).length,
      bonusSongs: d.songs.filter((s) => s.bonus).length,
    };
  }

  async flush() {
    const all = [...this.entries.values()];
    await Promise.all([this.saveIndex.flushNow(), ...all.map((e) => e.saveGame.flushNow()), ...all.map((e) => e.savePhotos.flushNow())]);
  }
}
