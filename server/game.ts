import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AdminState,
  GameInfo,
  Answer,
  Outcome,
  Phase,
  PlayerState,
  PublicState,
  Round,
  Settings,
  Song,
  TeamPublic,
  TimelineCard,
} from '../shared/types.js';

export const MAX_TEAMS = 20;

export interface Team extends TeamPublic {
  token: string;
}

export interface GameData {
  phase: Phase;
  settings: Settings;
  songs: Song[];
  teams: Team[];
  rounds: Round[];
  outcome: Outcome | null;
  pendingBonus: string[];
}

const id = () => crypto.randomBytes(6).toString('base64url');

export function freshData(): GameData {
  return {
    phase: 'lobby',
    settings: { defaultStartYear: 1987, roundSeconds: 60, targetCards: 10, answersSeconds: 6, joinOpen: true },
    songs: [],
    teams: [],
    rounds: [],
    outcome: null,
    pendingBonus: [],
  };
}

export class GameError extends Error {}

/** True if inserting `year` at `position` keeps the timeline sorted. Equal years count on either side. */
export function isPlacementCorrect(years: number[], position: number | null, year: number): boolean {
  if (position === null || position < 0 || position > years.length) return false;
  const before = position > 0 ? years[position - 1] : -Infinity;
  const after = position < years.length ? years[position] : Infinity;
  return before <= year && year <= after;
}

function hasContent(a: Answer | undefined) {
  if (!a) return false;
  return a.position !== null || a.yearGuess !== null || a.artist.trim() !== '' || a.title.trim() !== '';
}

export class Game extends EventEmitter {
  data: GameData;
  info: GameInfo = { id: '', code: '', name: '' };
  private timer: NodeJS.Timeout | null = null;

  constructor(data?: GameData | null) {
    super();
    this.data = data ? { ...freshData(), ...data, settings: { ...freshData().settings, ...data.settings } } : freshData();
    for (const t of this.data.teams) t.connected = false;
    this.resumeTimers();
  }

  // ---------- helpers ----------
  private changed() {
    this.emit('change');
  }
  get round(): Round | null {
    return this.data.rounds.at(-1) ?? null;
  }
  private song(songId: string) {
    return this.data.songs.find((s) => s.id === songId) ?? null;
  }
  team(teamId: string) {
    return this.data.teams.find((t) => t.id === teamId) ?? null;
  }
  teamByToken(token: string | undefined) {
    if (!token) return null;
    return this.data.teams.find((t) => t.token === token) ?? null;
  }
  private startYearOf(t: Team) {
    return t.startYear ?? this.data.settings.defaultStartYear;
  }
  private gameStarted() {
    return this.data.phase !== 'lobby';
  }
  private startCard(t: Team): TimelineCard {
    return { year: this.startYearOf(t), songId: null, title: null, artist: null, coverUrl: null };
  }

  private resumeTimers() {
    const r = this.round;
    if (this.data.phase === 'playing' && r?.endsAt) this.scheduleEnd(r.endsAt);
    if (this.data.phase === 'answers') this.scheduleReveal();
  }
  dispose() {
    this.clearTimer();
    this.removeAllListeners();
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private scheduleEnd(endsAt: number) {
    this.clearTimer();
    this.timer = setTimeout(() => this.endRound(), Math.max(0, endsAt - Date.now()));
  }
  private scheduleReveal() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.data.phase === 'answers') this.reveal();
    }, this.data.settings.answersSeconds * 1000);
  }

  // ---------- teams ----------
  join(name: string): Team {
    if (!this.data.settings.joinOpen) throw new GameError('Joining is closed. Ask the host.');
    if (this.data.teams.length >= MAX_TEAMS) throw new GameError(`The game is full (${MAX_TEAMS} teams).`);
    const clean = name.trim().slice(0, 30) || `Team ${this.data.teams.length + 1}`;
    const team: Team = {
      id: id(),
      token: crypto.randomBytes(18).toString('base64url'),
      name: clean,
      photoVersion: 0,
      startYear: null,
      timeline: [],
      points: 0,
      connected: true,
    };
    if (this.gameStarted()) team.timeline = [this.startCard(team)];
    this.data.teams.push(team);
    this.changed();
    return team;
  }

  renameTeam(teamId: string, name: string) {
    const t = this.team(teamId);
    if (!t) throw new GameError('Unknown team');
    const clean = name.trim().slice(0, 30);
    if (!clean) throw new GameError('Team name cannot be empty');
    t.name = clean;
    this.changed();
  }

  photoUpdated(teamId: string) {
    const t = this.team(teamId);
    if (t) t.photoVersion = Date.now();
    this.changed();
  }

  setConnected(teamId: string, connected: boolean) {
    const t = this.team(teamId);
    if (t && t.connected !== connected) {
      t.connected = connected;
      this.changed();
    }
  }

  adminUpdateTeam(teamId: string, patch: { name?: string; startYear?: number | null; points?: number }) {
    const t = this.team(teamId);
    if (!t) throw new GameError('Unknown team');
    if (patch.name !== undefined) this.renameTeam(teamId, patch.name);
    if (patch.startYear !== undefined) {
      t.startYear = patch.startYear;
      // keep the start card in sync while nothing else is on the timeline
      if (this.gameStarted() && t.timeline.length <= 1) t.timeline = [this.startCard(t)];
    }
    if (patch.points !== undefined && Number.isFinite(patch.points)) t.points = Math.round(patch.points);
    this.changed();
  }

  removeTeam(teamId: string) {
    this.data.teams = this.data.teams.filter((t) => t.id !== teamId);
    for (const r of this.data.rounds) r.participants = r.participants.filter((p) => p !== teamId);
    this.data.pendingBonus = this.data.pendingBonus.filter((p) => p !== teamId);
    this.changed();
  }

  // ---------- settings & songs ----------
  updateSettings(patch: Partial<Settings>) {
    const s = this.data.settings;
    if (patch.defaultStartYear !== undefined) s.defaultStartYear = clampInt(patch.defaultStartYear, 1900, 2100);
    if (patch.roundSeconds !== undefined) s.roundSeconds = clampInt(patch.roundSeconds, 10, 600);
    if (patch.targetCards !== undefined) s.targetCards = clampInt(patch.targetCards, 2, 30);
    if (patch.answersSeconds !== undefined) s.answersSeconds = clampInt(patch.answersSeconds, 1, 60);
    if (patch.joinOpen !== undefined) s.joinOpen = !!patch.joinOpen;
    if (patch.defaultStartYear !== undefined && this.gameStarted()) {
      for (const t of this.data.teams) if (t.timeline.length <= 1 && t.startYear === null) t.timeline = [this.startCard(t)];
    }
    this.changed();
  }

  addSongs(songs: Omit<Song, 'id' | 'used'>[]) {
    for (const s of songs) this.data.songs.push({ ...s, id: id(), used: false });
    this.changed();
  }

  updateSong(songId: string, patch: Partial<Song>) {
    const s = this.song(songId);
    if (!s) throw new GameError('Unknown song');
    const allowed: (keyof Song)[] = ['title', 'artist', 'year', 'coverUrl', 'bonus', 'used', 'needsCheck'];
    for (const k of allowed) if (k in patch) (s as any)[k] = (patch as any)[k];
    if ('year' in patch) s.needsCheck = false;
    this.changed();
  }

  removeSong(songId: string) {
    if (this.round && !this.round.committed && this.round.songId === songId) throw new GameError('This song is in the current round');
    this.data.songs = this.data.songs.filter((s) => s.id !== songId);
    this.changed();
  }

  moveSong(songId: string, delta: number) {
    const i = this.data.songs.findIndex((s) => s.id === songId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.data.songs.length) return;
    const [s] = this.data.songs.splice(i, 1);
    this.data.songs.splice(j, 0, s);
    this.changed();
  }

  shuffleSongs() {
    const unused = this.data.songs.filter((s) => !s.used);
    const used = this.data.songs.filter((s) => s.used);
    for (let i = unused.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unused[i], unused[j]] = [unused[j], unused[i]];
    }
    this.data.songs = [...used, ...unused];
    this.changed();
  }

  // ---------- flow ----------
  startShow() {
    if (this.data.phase !== 'lobby') throw new GameError('The show already started');
    if (this.data.teams.length === 0) throw new GameError('No teams have joined yet');
    for (const t of this.data.teams) {
      t.timeline = [this.startCard(t)];
      t.points = 0;
    }
    this.data.rounds = [];
    this.data.outcome = null;
    this.data.pendingBonus = [];
    this.data.phase = 'intro';
    this.changed();
  }

  private pickSong(kind: 'normal' | 'bonus', songId?: string): Song {
    if (songId) {
      const s = this.song(songId);
      if (!s) throw new GameError('Unknown song');
      if (s.year === null) throw new GameError(`"${s.title}" has no year yet`);
      return s;
    }
    const usable = (s: Song) => !s.used && s.year !== null;
    const pool =
      kind === 'bonus'
        ? this.data.songs.filter((s) => usable(s) && s.bonus)
        : this.data.songs.filter((s) => usable(s) && !s.bonus);
    // fall back to the other pool so the game never gets stuck
    const fallback = this.data.songs.filter(usable);
    const s = pool[0] ?? fallback[0];
    if (!s) throw new GameError('No songs left with a year. Add songs in the Songs tab.');
    return s;
  }

  nextSong(songId?: string) {
    const ok: Phase[] = ['intro', 'scoreboard', 'ready'];
    if (!ok.includes(this.data.phase)) throw new GameError('Finish the current round first');
    // replacing a round that never started: free its song again
    const prev = this.round;
    if (this.data.phase === 'ready' && prev && !prev.startedAt) {
      const ps = this.song(prev.songId);
      if (ps) ps.used = false;
      this.data.rounds.pop();
    }
    const bonus = this.data.pendingBonus.length > 0;
    const song = this.pickSong(bonus ? 'bonus' : 'normal', songId);
    song.used = true;
    const participants = bonus ? [...this.data.pendingBonus] : this.data.teams.map((t) => t.id);
    const timelineYears: Record<string, number[]> = {};
    for (const t of this.data.teams) timelineYears[t.id] = t.timeline.map((c) => c.year);
    this.data.rounds.push({
      index: this.data.rounds.length + 1,
      kind: bonus ? 'bonus' : 'normal',
      songId: song.id,
      participants,
      startedAt: null,
      endsAt: null,
      answers: {},
      judgments: {},
      placementCorrect: {},
      timelineYears,
      committed: false,
    });
    this.data.phase = 'ready';
    this.changed();
  }

  startRound() {
    if (this.data.phase !== 'ready' || !this.round) throw new GameError('Load a song first');
    const now = Date.now();
    this.round.startedAt = now;
    this.round.endsAt = now + this.data.settings.roundSeconds * 1000;
    this.data.phase = 'playing';
    this.scheduleEnd(this.round.endsAt);
    this.changed();
  }

  addTime(seconds: number) {
    if (this.data.phase !== 'playing' || !this.round?.endsAt) return;
    this.round.endsAt += seconds * 1000;
    this.scheduleEnd(this.round.endsAt);
    this.changed();
  }

  submitAnswer(teamId: string, patch: Partial<Answer>, confirm: boolean) {
    const r = this.round;
    if (this.data.phase !== 'playing' || !r) throw new GameError('The round is not open');
    if (!r.participants.includes(teamId)) throw new GameError('Your team is not playing this round');
    const prev = r.answers[teamId];
    if (prev?.confirmed) throw new GameError('Your answer is already locked in');
    const a: Answer = prev ?? { position: null, yearGuess: null, artist: '', title: '', confirmed: false, updatedAt: 0 };
    if (patch.position !== undefined) {
      const max = (r.timelineYears[teamId] ?? []).length;
      a.position = patch.position === null ? null : clampInt(patch.position, 0, max);
    }
    if (patch.yearGuess !== undefined) a.yearGuess = patch.yearGuess === null ? null : clampInt(patch.yearGuess, 1000, 2100);
    if (patch.artist !== undefined) a.artist = String(patch.artist).slice(0, 80);
    if (patch.title !== undefined) a.title = String(patch.title).slice(0, 80);
    if (confirm) {
      if (r.kind === 'normal' && a.position === null) throw new GameError('Drag the song into your timeline first');
      if (r.kind === 'bonus' && a.yearGuess === null) throw new GameError('Enter a year first');
      a.confirmed = true;
    }
    a.updatedAt = Date.now();
    r.answers[teamId] = a;
    // everybody locked in: no need to wait for the clock
    if (r.participants.every((p) => r.answers[p]?.confirmed)) {
      this.changed();
      this.endRound();
      return;
    }
    this.changed();
  }

  endRound() {
    const r = this.round;
    if (this.data.phase !== 'playing' || !r) return;
    this.clearTimer();
    // unconfirmed answers with content still count; empty ones are dropped
    for (const p of r.participants) {
      const a = r.answers[p];
      if (!hasContent(a)) delete r.answers[p];
    }
    const song = this.song(r.songId)!;
    for (const p of r.participants) {
      const a = r.answers[p];
      r.placementCorrect[p] =
        r.kind === 'normal' && !!a && song.year !== null && isPlacementCorrect(r.timelineYears[p] ?? [], a.position, song.year);
      r.judgments[p] = { artist: null, title: null };
    }
    r.endsAt = Math.min(r.endsAt ?? Date.now(), Date.now());
    this.data.phase = 'answers';
    this.scheduleReveal();
    this.changed();
  }

  reveal() {
    if (this.data.phase !== 'answers') throw new GameError('Nothing to reveal');
    this.clearTimer();
    this.data.phase = 'reveal';
    this.changed();
  }

  judge(teamId: string, field: 'artist' | 'title', value: boolean | null) {
    const r = this.round;
    if (!r || (this.data.phase !== 'reveal' && this.data.phase !== 'answers')) throw new GameError('Not judging right now');
    if (!r.participants.includes(teamId)) throw new GameError('Team did not play this round');
    r.judgments[teamId] = { ...(r.judgments[teamId] ?? { artist: null, title: null }), [field]: value };
    this.changed();
  }

  overridePlacement(teamId: string, value: boolean) {
    const r = this.round;
    if (!r || r.kind !== 'normal' || (this.data.phase !== 'reveal' && this.data.phase !== 'answers')) throw new GameError('Not judging right now');
    r.placementCorrect[teamId] = value;
    this.changed();
  }

  private roundPoints(r: Round, teamId: string) {
    const j = r.judgments[teamId];
    return (j?.artist ? 100 : 0) + (j?.title ? 100 : 0);
  }

  /** Apply the round: cards onto timelines, points, then decide winner / tie. */
  commit() {
    const r = this.round;
    if (this.data.phase !== 'reveal' || !r) throw new GameError('Reveal the answer first');
    const song = this.song(r.songId)!;
    for (const p of r.participants) {
      const t = this.team(p);
      if (!t) continue;
      t.points += this.roundPoints(r, p);
      if (r.kind === 'normal' && r.placementCorrect[p] && song.year !== null) {
        const card: TimelineCard = { year: song.year, songId: song.id, title: song.title, artist: song.artist, coverUrl: song.coverUrl };
        t.timeline.push(card);
        t.timeline.sort((a, b) => a.year - b.year);
      }
    }
    r.committed = true;
    this.decide(r);
    this.data.phase = this.data.outcome?.winnerId ? 'finished' : 'scoreboard';
    this.changed();
  }

  private decide(r: Round) {
    const target = this.data.settings.targetCards;
    const byId = (ids: string[]) => ids.map((i) => this.team(i)).filter((t): t is Team => !!t);
    const win = (t: Team, message: string) => {
      this.data.outcome = { winnerId: t.id, tiedTeamIds: [], message };
      this.data.pendingBonus = [];
    };
    const tie = (ids: string[], message: string) => {
      this.data.outcome = { winnerId: null, tiedTeamIds: ids, message };
      this.data.pendingBonus = ids;
    };

    if (r.kind === 'bonus') {
      const song = this.song(r.songId)!;
      const players = byId(r.participants);
      const diff = (t: Team) => {
        const g = r.answers[t.id]?.yearGuess;
        return g === null || g === undefined || song.year === null ? Infinity : Math.abs(g - song.year);
      };
      const best = Math.min(...players.map(diff));
      const closest = players.filter((t) => diff(t) === best);
      if (closest.length === 1) return win(closest[0], `${closest[0].name} was closest to ${song.year}!`);
      const bestPts = Math.max(...closest.map((t) => this.roundPoints(r, t.id)));
      const top = closest.filter((t) => this.roundPoints(r, t.id) === bestPts);
      if (top.length === 1) return win(top[0], `${top[0].name} wins on artist & title!`);
      return tie(top.map((t) => t.id), 'Still a tie! Another bonus round.');
    }

    const finishers = this.data.teams.filter((t) => t.timeline.length >= target);
    if (finishers.length === 0) {
      // nothing left to play: most cards, then points
      const left = this.data.songs.filter((s) => !s.used && s.year !== null).length;
      if (left === 0 && this.data.teams.length) {
        const most = Math.max(...this.data.teams.map((t) => t.timeline.length));
        const leaders = this.data.teams.filter((t) => t.timeline.length === most);
        const pts = Math.max(...leaders.map((t) => t.points));
        const top = leaders.filter((t) => t.points === pts);
        if (top.length === 1) return win(top[0], `Out of songs! ${top[0].name} has the longest timeline.`);
        return tie(top.map((t) => t.id), 'Out of songs and a tie! Add a bonus song.');
      }
      this.data.outcome = null;
      return;
    }
    if (finishers.length === 1) return win(finishers[0], `${finishers[0].name} completed the timeline!`);
    const pts = Math.max(...finishers.map((t) => t.points));
    const top = finishers.filter((t) => t.points === pts);
    if (top.length === 1) return win(top[0], `${top[0].name} wins on points!`);
    return tie(top.map((t) => t.id), `It's a tie! Bonus round for ${top.map((t) => t.name).join(' & ')}.`);
  }

  /** Admin can jump straight to the scoreboard from the lobby/intro/ready. */
  showScoreboard() {
    if (!['intro', 'ready', 'scoreboard'].includes(this.data.phase)) throw new GameError('Not now');
    const r = this.round;
    if (this.data.phase === 'ready' && r && !r.startedAt) {
      const s = this.song(r.songId);
      if (s) s.used = false;
      this.data.rounds.pop();
    }
    this.data.phase = 'scoreboard';
    this.changed();
  }

  showIntro() {
    if (!['scoreboard', 'intro', 'ready'].includes(this.data.phase)) throw new GameError('Not now');
    this.data.phase = 'intro';
    this.changed();
  }

  /** Back to the lobby, keep teams and songs. */
  resetGame() {
    this.clearTimer();
    for (const t of this.data.teams) {
      t.timeline = [];
      t.points = 0;
    }
    for (const s of this.data.songs) s.used = false;
    this.data.rounds = [];
    this.data.outcome = null;
    this.data.pendingBonus = [];
    this.data.phase = 'lobby';
    this.changed();
  }

  // ---------- views ----------
  private publicTeam(t: Team): TeamPublic {
    const { token: _t, ...rest } = t;
    return rest;
  }

  publicState(): PublicState {
    const r = this.round;
    const phase = this.data.phase;
    const afterPlay = ['answers', 'reveal', 'scoreboard', 'finished'].includes(phase);
    const afterReveal = ['reveal', 'scoreboard', 'finished'].includes(phase);
    const song = r ? this.song(r.songId) : null;
    return {
      game: this.info,
      phase,
      serverNow: Date.now(),
      settings: this.data.settings,
      teams: this.data.teams.map((t) => this.publicTeam(t)),
      round: r
        ? {
            index: r.index,
            kind: r.kind,
            participants: r.participants,
            startedAt: r.startedAt,
            endsAt: r.endsAt,
            confirmedTeamIds: Object.entries(r.answers).filter(([, a]) => a.confirmed).map(([k]) => k),
            answeredTeamIds: Object.entries(r.answers).filter(([, a]) => hasContent(a)).map(([k]) => k),
            answers: afterPlay ? r.answers : null,
            timelineYears: afterPlay ? r.timelineYears : null,
            song: afterReveal && song ? { title: song.title, artist: song.artist, year: song.year, coverUrl: song.coverUrl } : null,
            placementCorrect: afterReveal ? r.placementCorrect : null,
            judgments: afterReveal ? r.judgments : null,
          }
        : null,
      outcome: this.data.outcome,
      pendingBonus: this.data.pendingBonus,
      songsLeft: this.data.songs.filter((s) => !s.used && s.year !== null).length,
    };
  }

  adminState(): AdminState {
    const pub = this.publicState();
    const r = this.round;
    const song = r ? this.song(r.songId) : null;
    if (pub.round && r) {
      // the admin sees everything live
      pub.round.answers = r.answers;
      pub.round.timelineYears = r.timelineYears;
      pub.round.placementCorrect = r.placementCorrect;
      pub.round.judgments = r.judgments;
      pub.round.song = song ? { title: song.title, artist: song.artist, year: song.year, coverUrl: song.coverUrl } : null;
    }
    return { ...pub, songs: this.data.songs, currentSongId: r && !r.committed ? r.songId : null };
  }

  playerState(teamId: string | null, base?: PublicState): PlayerState {
    const pub = base ?? this.publicState();
    const t = teamId ? this.team(teamId) : null;
    const r = this.round;
    return {
      ...pub,
      me: t ? this.publicTeam(t) : null,
      myAnswer: t && r ? (r.answers[t.id] ?? null) : null,
    };
  }
}

function clampInt(v: unknown, min: number, max: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new GameError('Invalid number');
  return Math.min(max, Math.max(min, n));
}
