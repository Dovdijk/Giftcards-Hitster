import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  BONUS_LIST,
  MUSIC_LIST,
  PRACTICE_LIST,
  type AdminState,
  type Answer,
  type Award,
  type GameInfo,
  type Outcome,
  type Phase,
  type PlayerState,
  type PublicState,
  type Settings,
  type Song,
  type Stage,
  type TeamPublic,
  type TimelineCard,
  type Turn,
} from '../shared/types.js';

export const MAX_TEAMS = 20;
export const MAX_STAGES = 12;

export interface Team extends TeamPublic {
  token: string;
}

export interface GameData {
  phase: Phase;
  settings: Settings;
  stages: Stage[];
  currentStage: number;
  songs: Song[];
  teams: Team[];
  rounds: Turn[]; // every song played tonight, across stages
  outcome: Outcome | null;
  pendingBonus: string[];
  musicCursor: number; // which scoreboard song is next
  awards: Award[] | null;
  awardIndex: number;
}

export const newId = () => crypto.randomBytes(6).toString('base64url');

export function freshStage(n: number, startYears = [1987]): Stage {
  return { id: newId(), name: `Round ${n}`, startYears };
}

export function freshData(): GameData {
  return {
    phase: 'lobby',
    settings: { roundSeconds: 60, targetCards: 10, answersSeconds: 6, winBonus: 1000, speedBonus: 50, blind: false, autopilot: false, autoRevealSeconds: 12, autoScoreboardSeconds: 10, joinOpen: true },
    stages: [freshStage(1)],
    currentStage: 0,
    songs: [],
    teams: [],
    rounds: [],
    outcome: null,
    pendingBonus: [],
    musicCursor: 0,
    awards: null,
    awardIndex: 0,
  };
}

/** Bring games saved by older versions up to date. */
function migrate(raw: any): GameData {
  const d = { ...freshData(), ...raw } as GameData & Record<string, any>;
  const legacyStart = raw?.settings?.defaultStartYear;
  d.settings = { ...freshData().settings, ...(raw?.settings ?? {}) };
  delete (d.settings as any).defaultStartYear;
  if (!Array.isArray(raw?.stages) || raw.stages.length === 0) d.stages = [freshStage(1, [legacyStart ?? 1987])];
  d.currentStage = Math.min(d.currentStage ?? 0, d.stages.length - 1);
  d.songs = (d.songs ?? []).map((s: any) => ({
    startAt: 0,
    ...s,
    list: s.list ?? (s.bonus ? BONUS_LIST : d.stages[0].id),
  }));
  for (const s of d.songs) delete (s as any).bonus;
  d.teams = (d.teams ?? []).map((t: any) => ({
    stagePoints: 0,
    wins: [],
    ...t,
    startYears: t.startYears ?? (t.startYear ? [t.startYear] : null),
  }));
  for (const t of d.teams) delete (t as any).startYear;
  d.rounds = (d.rounds ?? []).map((r: any) => ({ stage: 0, speedWinnerId: null, speedMs: null, ...r }));
  d.musicCursor ??= 0;
  d.awards ??= null;
  d.awardIndex ??= 0;
  return d;
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

const MUSIC_PHASES: Phase[] = ['scoreboard', 'stageEnd', 'stageIntro', 'awards', 'finished'];

export class Game extends EventEmitter {
  data: GameData;
  info: GameInfo = { id: '', code: '', name: '' };
  private timer: NodeJS.Timeout | null = null;

  constructor(data?: GameData | null) {
    super();
    this.data = data ? migrate(data) : freshData();
    for (const t of this.data.teams) t.connected = false;
    this.resumeTimers();
    this.scheduleAuto();
  }

  // ---------- helpers ----------
  private changed() {
    this.scheduleAuto();
    this.emit('change');
  }

  // ---------- autopilot ----------
  private autoTimer: NodeJS.Timeout | null = null;
  private autoKey = '';
  autoAt: number | null = null;

  /** The step the game is at: the autopilot timer restarts only when this changes. */
  private stepKey() {
    const r = this.round;
    return [this.data.phase, this.data.currentStage, this.data.rounds.length, r?.startedAt ?? 0, this.data.awardIndex, this.data.settings.autopilot].join('|');
  }

  private autoDelay(): number | null {
    const s = this.data.settings;
    switch (this.data.phase) {
      case 'intro': return 46_000; // let the explanation run once
      case 'stageIntro': return 8_000;
      case 'reveal': return s.autoRevealSeconds * 1000;
      case 'scoreboard': return s.autoScoreboardSeconds * 1000;
      case 'stageEnd': return 12_000;
      case 'awards': return this.data.awards?.[this.data.awardIndex]?.grand ? 14_000 : 10_000;
      case 'ready': {
        // songs without Spotify link can't be started by pressing play
        const song = this.round ? this.song(this.round.songId) : null;
        return song && !song.spotifyId ? 4_000 : null;
      }
      default: return null; // playing and answers have their own timers; lobby and finished wait for the host
    }
  }

  private scheduleAuto() {
    const key = this.stepKey();
    if (key === this.autoKey) return;
    this.autoKey = key;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.autoAt = null;
    if (!this.data.settings.autopilot) return;
    const delay = this.autoDelay();
    if (delay === null) return;
    this.autoAt = Date.now() + delay;
    this.autoTimer = setTimeout(() => this.autoStep(), delay);
    this.autoTimer.unref?.();
  }

  private autoStep() {
    this.autoTimer = null;
    if (!this.data.settings.autopilot) return;
    try {
      switch (this.data.phase) {
        case 'intro':
        case 'stageIntro':
        case 'scoreboard':
          return this.nextSong();
        case 'reveal':
          return this.commit();
        case 'stageEnd':
          return this.data.currentStage >= this.data.stages.length - 1 ? this.finishEvening() : this.nextStage();
        case 'awards':
          return this.nextAward();
        case 'ready':
          return this.startRound();
      }
    } catch (e) {
      // e.g. out of songs: wait for the host
      this.autoAt = null;
      this.emit('change');
      if (!(e instanceof GameError)) console.error(e);
    }
  }
  get round(): Turn | null {
    return this.data.rounds.at(-1) ?? null;
  }
  get stage(): Stage {
    return this.data.stages[this.data.currentStage] ?? this.data.stages[0];
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
  private gameStarted() {
    return this.data.phase !== 'lobby';
  }
  private startCards(t: Team): TimelineCard[] {
    const years = (t.startYears?.length ? t.startYears : this.stage.startYears).slice(0, 2);
    return [...years].sort((a, b) => a - b).map((year) => ({ year, songId: null, title: null, artist: null, coverUrl: null }));
  }
  private stageSongs(stageIndex = this.data.currentStage) {
    const sid = this.data.stages[stageIndex]?.id;
    return this.data.songs.filter((s) => s.list === sid);
  }
  private playable = (s: Song) => !s.used && s.year !== null;

  private resumeTimers() {
    const r = this.round;
    if (this.data.phase === 'playing' && r?.endsAt) this.scheduleEnd(r.endsAt);
    if (this.data.phase === 'answers') this.scheduleReveal();
  }
  dispose() {
    this.clearTimer();
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.removeAllListeners();
  }
  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private scheduleEnd(endsAt: number) {
    this.clearTimer();
    this.timer = setTimeout(() => this.endRound(), Math.max(0, endsAt - Date.now()));
    this.timer.unref?.();
  }
  private scheduleReveal() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.data.phase === 'answers') this.reveal();
    }, this.data.settings.answersSeconds * 1000);
    this.timer.unref?.();
  }

  // ---------- teams ----------
  join(name: string): Team {
    if (!this.data.settings.joinOpen) throw new GameError('Joining is closed. Ask the host.');
    if (this.data.teams.length >= MAX_TEAMS) throw new GameError(`The game is full (${MAX_TEAMS} teams).`);
    const clean = name.trim().slice(0, 30) || `Team ${this.data.teams.length + 1}`;
    const team: Team = {
      id: newId(),
      token: crypto.randomBytes(18).toString('base64url'),
      name: clean,
      photoVersion: 0,
      startYears: null,
      timeline: [],
      points: 0,
      stagePoints: 0,
      wins: [],
      connected: true,
    };
    if (this.gameStarted()) team.timeline = this.startCards(team);
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
      const r = this.round;
      if (!connected && this.data.phase === 'playing' && r && r.participants.includes(teamId) && Object.keys(r.answers).length && this.allLockedIn(r)) {
        // give a reconnecting phone a moment before closing the song
        setTimeout(() => {
          const now = this.round;
          if (this.data.phase === 'playing' && now === r && this.allLockedIn(r)) this.endRound();
        }, 8000).unref?.();
      }
    }
  }

  private noSongsOnTimeline(t: Team) {
    return t.timeline.every((c) => c.songId === null);
  }

  adminUpdateTeam(teamId: string, patch: { name?: string; startYears?: number[] | null; points?: number }) {
    const t = this.team(teamId);
    if (!t) throw new GameError('Unknown team');
    if (patch.name !== undefined) this.renameTeam(teamId, patch.name);
    if (patch.startYears !== undefined) {
      t.startYears = patch.startYears?.length ? patch.startYears.slice(0, 2).map((y) => clampInt(y, 1000, 2100)) : null;
      if (this.gameStarted() && this.noSongsOnTimeline(t)) t.timeline = this.startCards(t);
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

  // ---------- settings, stages & songs ----------
  updateSettings(patch: Partial<Settings>) {
    const s = this.data.settings;
    if (patch.roundSeconds !== undefined) s.roundSeconds = clampInt(patch.roundSeconds, 10, 600);
    if (patch.targetCards !== undefined) s.targetCards = clampInt(patch.targetCards, 3, 30);
    if (patch.answersSeconds !== undefined) s.answersSeconds = clampInt(patch.answersSeconds, 1, 60);
    if (patch.winBonus !== undefined) s.winBonus = clampInt(patch.winBonus, 0, 100000);
    if (patch.speedBonus !== undefined) s.speedBonus = clampInt(patch.speedBonus, 0, 10000);
    if (patch.joinOpen !== undefined) s.joinOpen = !!patch.joinOpen;
    if (patch.blind !== undefined) s.blind = !!patch.blind;
    if (patch.autopilot !== undefined) s.autopilot = !!patch.autopilot;
    if (patch.autoRevealSeconds !== undefined) s.autoRevealSeconds = clampInt(patch.autoRevealSeconds, 3, 120);
    if (patch.autoScoreboardSeconds !== undefined) s.autoScoreboardSeconds = clampInt(patch.autoScoreboardSeconds, 3, 120);
    this.changed();
  }

  addStage() {
    if (this.data.stages.length >= MAX_STAGES) throw new GameError(`Maximum ${MAX_STAGES} rounds`);
    const prev = this.data.stages.at(-1);
    this.data.stages.push(freshStage(this.data.stages.length + 1, prev ? [...prev.startYears] : [1987]));
    this.changed();
  }

  updateStage(stageId: string, patch: { name?: string; startYears?: number[] }) {
    const i = this.data.stages.findIndex((s) => s.id === stageId);
    if (i < 0) throw new GameError('Unknown round');
    const st = this.data.stages[i];
    if (patch.name !== undefined) st.name = String(patch.name).trim().slice(0, 40) || st.name;
    if (patch.startYears !== undefined) {
      const ys = (patch.startYears ?? []).slice(0, 2).map((y) => clampInt(y, 1000, 2100));
      if (ys.length === 0) throw new GameError('A round needs at least 1 start year');
      st.startYears = ys;
      // refresh untouched timelines of the round that is about to be played
      if (i === this.data.currentStage && this.gameStarted()) {
        for (const t of this.data.teams) if (this.noSongsOnTimeline(t)) t.timeline = this.startCards(t);
      }
    }
    this.changed();
  }

  removeStage(stageId: string) {
    const i = this.data.stages.findIndex((s) => s.id === stageId);
    if (i < 0) throw new GameError('Unknown round');
    if (this.data.stages.length === 1) throw new GameError('A game needs at least 1 round');
    if (this.gameStarted() && i <= this.data.currentStage) throw new GameError('This round has already been played');
    this.data.songs = this.data.songs.filter((s) => s.list !== stageId);
    this.data.stages.splice(i, 1);
    this.changed();
  }

  moveStage(stageId: string, delta: number) {
    const i = this.data.stages.findIndex((s) => s.id === stageId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.data.stages.length) return;
    if (this.gameStarted() && Math.min(i, j) <= this.data.currentStage) throw new GameError('Played rounds cannot be moved');
    const [s] = this.data.stages.splice(i, 1);
    this.data.stages.splice(j, 0, s);
    this.changed();
  }

  private validList(list: string) {
    return list === BONUS_LIST || list === MUSIC_LIST || list === PRACTICE_LIST || this.data.stages.some((s) => s.id === list);
  }

  addSongs(songs: Omit<Song, 'id' | 'used'>[]) {
    for (const s of songs) {
      if (!this.validList(s.list)) throw new GameError('Unknown song list');
      this.data.songs.push({ ...s, id: newId(), used: false });
    }
    this.changed();
  }

  updateSong(songId: string, patch: Partial<Song>) {
    const s = this.song(songId);
    if (!s) throw new GameError('Unknown song');
    if (patch.list !== undefined && !this.validList(patch.list)) throw new GameError('Unknown song list');
    const allowed: (keyof Song)[] = ['title', 'artist', 'year', 'coverUrl', 'used', 'needsCheck', 'list', 'startAt'];
    for (const k of allowed) if (k in patch) (s as any)[k] = (patch as any)[k];
    if ('startAt' in patch) s.startAt = clampInt(patch.startAt, 0, 1200);
    if ('year' in patch) s.needsCheck = false;
    if ('list' in patch) {
      // moved songs go to the end of their new list
      this.data.songs = [...this.data.songs.filter((x) => x !== s), s];
    }
    this.changed();
  }

  removeSong(songId: string) {
    if (this.round && !this.round.committed && this.round.songId === songId) throw new GameError('This song is in the current round');
    this.data.songs = this.data.songs.filter((s) => s.id !== songId);
    this.changed();
  }

  /** Move a song up/down within its own list. */
  moveSong(songId: string, delta: number) {
    const s = this.song(songId);
    if (!s) return;
    const same = this.data.songs.filter((x) => x.list === s.list);
    const i = same.indexOf(s);
    const other = same[i + delta];
    if (!other) return;
    const a = this.data.songs.indexOf(s);
    const b = this.data.songs.indexOf(other);
    [this.data.songs[a], this.data.songs[b]] = [this.data.songs[b], this.data.songs[a]];
    this.changed();
  }

  shuffleSongs(list: string) {
    const pick = this.data.songs.filter((s) => s.list === list && !s.used);
    for (let i = pick.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
    const rest = this.data.songs.filter((s) => !(s.list === list && !s.used));
    this.data.songs = [...rest, ...pick];
    this.changed();
  }

  // ---------- flow ----------
  private resetForStage() {
    for (const t of this.data.teams) {
      t.timeline = this.startCards(t);
      t.stagePoints = 0;
    }
    this.data.outcome = null;
    this.data.pendingBonus = [];
  }

  startShow() {
    if (this.data.phase !== 'lobby') throw new GameError('The show already started');
    if (this.data.teams.length === 0) throw new GameError('No teams have joined yet');
    for (const t of this.data.teams) {
      t.points = 0;
      t.wins = [];
    }
    this.data.currentStage = 0;
    this.data.rounds = [];
    this.resetForStage();
    this.data.phase = 'intro';
    this.changed();
  }

  /** After a round winner: on to the next round. */
  nextStage() {
    if (this.data.phase !== 'stageEnd') throw new GameError('Finish this round first');
    if (this.data.currentStage >= this.data.stages.length - 1) throw new GameError('This was the last round');
    this.data.currentStage++;
    this.resetForStage();
    this.data.musicCursor++;
    this.data.phase = 'stageIntro';
    this.changed();
  }

  /** End of the night: the awards one by one, then the final results. */
  finishEvening() {
    if (!['stageEnd', 'scoreboard', 'stageIntro'].includes(this.data.phase)) throw new GameError('Not now');
    this.clearTimer();
    this.data.pendingBonus = [];
    this.data.awards = this.computeAwards();
    this.data.awardIndex = 0;
    this.data.musicCursor++;
    if (this.data.awards.length) {
      this.data.outcome = null;
      this.data.phase = 'awards';
      this.changed();
      return;
    }
    this.showFinal();
  }

  /** Next award, or the final results after the last one. */
  nextAward() {
    if (this.data.phase !== 'awards') throw new GameError('Not showing awards');
    if (this.data.awards && this.data.awardIndex < this.data.awards.length - 1) {
      this.data.awardIndex++;
      this.changed();
      return;
    }
    this.showFinal();
  }

  skipAwards() {
    if (this.data.phase !== 'awards') throw new GameError('Not showing awards');
    this.showFinal();
  }

  private showFinal() {
    const teams = [...this.data.teams].sort((a, b) => b.points - a.points || b.wins.length - a.wins.length);
    const top = teams[0];
    const shared = top ? teams.filter((t) => t.points === top.points && t.wins.length === top.wins.length) : [];
    this.data.outcome = top
      ? {
          winnerId: top.id,
          tiedTeamIds: shared.length > 1 ? shared.map((t) => t.id) : [],
          message: shared.length > 1 ? `Shared win: ${shared.map((t) => t.name).join(' & ')}!` : `${top.name} wins the night with ${top.points} points!`,
          stage: null,
        }
      : null;
    this.data.pendingBonus = [];
    this.data.phase = 'finished';
    this.changed();
  }

  /** Fun awards from what happened tonight. Only awards that someone actually earned. */
  computeAwards(): Award[] {
    const teams = this.data.teams;
    if (!teams.length) return [];
    type St = { artists: number; wrong: number; near: number; lastSecond: number; lockTimes: number[] };
    const st = new Map<string, St>(teams.map((t) => [t.id, { artists: 0, wrong: 0, near: 0, lastSecond: 0, lockTimes: [] }]));
    let closest: { teamIds: string[]; dist: number; title: string; year: number } | null = null;
    for (const r of this.data.rounds) {
      if (!r.committed || r.practice) continue;
      const song = this.song(r.songId);
      for (const p of r.participants) {
        const x = st.get(p);
        if (!x) continue;
        if (r.judgments[p]?.artist) x.artists++;
        const a = r.answers[p];
        if (r.kind !== 'normal' || !a) continue;
        if (a.confirmed && r.startedAt) {
          x.lockTimes.push(Math.max(0, a.updatedAt - r.startedAt));
          if (r.endsAt && a.updatedAt <= r.endsAt && r.endsAt - a.updatedAt <= 5000) x.lastSecond++;
        }
        if (a.position !== null && !r.placementCorrect[p] && song?.year != null) {
          x.wrong++;
          const years = r.timelineYears[p] ?? [];
          const lo = a.position > 0 ? years[a.position - 1] : -Infinity;
          const hi = a.position < years.length ? years[a.position] : Infinity;
          const dist = song.year < lo ? lo - song.year : song.year - hi;
          if (dist <= 2) x.near++;
          if (dist > 0 && (!closest || dist < closest.dist)) closest = { teamIds: [p], dist, title: song.title, year: song.year };
          else if (closest && dist === closest.dist && closest.title === song.title && !closest.teamIds.includes(p)) closest.teamIds.push(p);
        }
      }
    }
    const best = (val: (s: St) => number, minimum = 1) => {
      let top = -Infinity;
      for (const t of teams) top = Math.max(top, val(st.get(t.id)!));
      if (top < minimum) return null;
      return { value: top, ids: teams.filter((t) => val(st.get(t.id)!) === top).map((t) => t.id) };
    };
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const out: Award[] = [];
    const add = (id: string, emoji: string, title: string, subtitle: string, teamIds: string[], detail: string) => out.push({ id, emoji, title, subtitle, teamIds, detail });

    const gamblers = best((s) => s.wrong);
    if (gamblers) add('gamblers', '🎲', 'The Gamblers', 'Most cards on the wrong spot', gamblers.ids, plural(gamblers.value, 'card on the wrong spot', 'cards on the wrong spot'));
    const unlucky = best((s) => s.near);
    if (unlucky) add('unlucky', '🍀', 'Unlucky Ones', 'Most often just 1 or 2 years off', unlucky.ids, plural(unlucky.value, 'time just 1 or 2 years off', 'times just 1 or 2 years off'));
    if (closest) add('close', '🤏', 'So Close!', 'The narrowest miss of the night', closest.teamIds, `${closest.title} (${closest.year}): only ${plural(closest.dist, 'year', 'years')} off`);
    const lastSecond = best((s) => s.lastSecond);
    if (lastSecond) add('lastsecond', '⏱️', 'Last Second Heroes', 'Most answers in the last 5 seconds', lastSecond.ids, plural(lastSecond.value, 'answer at the very last moment', 'answers at the very last moment'));
    const turns = this.data.rounds.filter((r) => r.committed && r.kind === 'normal' && !r.practice).length;
    const minLocks = Math.max(2, Math.ceil(turns * 0.3));
    const avg = (s: St) => (s.lockTimes.length >= minLocks ? s.lockTimes.reduce((x, y) => x + y, 0) / s.lockTimes.length : Infinity);
    const fastest = best((s) => -avg(s), -Infinity);
    if (fastest && Number.isFinite(fastest.value)) add('fastest', '⚡', 'Fastest Fingers', 'Quickest to lock in their answer', fastest.ids, -fastest.value < 1000 ? 'locked in within a second on average' : `locked in after ${Math.round(-fastest.value / 100) / 10} seconds on average`);
    const encyclopedia = best((s) => s.artists);
    if (encyclopedia) add('encyclopedia', '📚', 'Music Encyclopedia', 'Most artists right', encyclopedia.ids, plural(encyclopedia.value, 'artist right', 'artists right'));
    if (teams.length >= 2) {
      const low = Math.min(...teams.map((t) => t.points));
      const last = teams.filter((t) => t.points === low);
      if (last.length < teams.length) add('last', '🐢', 'Last But Not Least', 'Bottom of the table, top of the party', last.map((t) => t.id), `${low} points and all the fun`);
    }
    // the grand finale: tonight's winners
    const ranked = [...teams].sort((a, b) => b.points - a.points || b.wins.length - a.wins.length);
    const champ = ranked[0];
    const champs = ranked.filter((t) => t.points === champ.points && t.wins.length === champ.wins.length);
    out.push({
      id: 'champions',
      emoji: '🏆',
      title: 'Best Hitster Players of All Time',
      subtitle: 'giftcards.group Hall of Fame',
      teamIds: champs.map((t) => t.id),
      detail: `${champ.points} points${champ.wins.length ? ` · ${plural(champ.wins.length, 'round', 'rounds')} won` : ''}`,
      grand: true,
    });
    return out;
  }

  private pickSong(kind: 'normal' | 'bonus', songId?: string): Song {
    if (songId) {
      const s = this.song(songId);
      if (!s) throw new GameError('Unknown song');
      if (s.list === MUSIC_LIST) throw new GameError('That is scoreboard music');
      if (s.list === PRACTICE_LIST) throw new GameError('That is a practice song');
      if (s.year === null) throw new GameError(`"${s.title}" has no year yet`);
      return s;
    }
    const stagePool = this.stageSongs().filter(this.playable);
    if (kind === 'bonus') {
      const bonus = this.data.songs.filter((s) => s.list === BONUS_LIST && this.playable(s));
      const s = bonus[0] ?? stagePool[0];
      if (!s) throw new GameError('No bonus songs left. Add songs to the Bonus list.');
      return s;
    }
    const s = stagePool[0];
    if (!s) throw new GameError(`No songs with a year left in ${this.stage.name}. Add songs in the Songs tab.`);
    return s;
  }

  nextSong(songId?: string) {
    const ok: Phase[] = ['intro', 'stageIntro', 'scoreboard', 'ready'];
    if (!ok.includes(this.data.phase)) throw new GameError('Finish the current song first');
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
    const stage = this.data.currentStage;
    this.data.rounds.push({
      index: this.data.rounds.filter((r) => r.stage === stage && !r.practice).length + 1,
      stage,
      kind: bonus ? 'bonus' : 'normal',
      songId: song.id,
      participants,
      startedAt: null,
      endsAt: null,
      answers: {},
      judgments: {},
      placementCorrect: {},
      timelineYears,
      speedWinnerId: null,
      speedMs: null,
      committed: false,
    });
    this.data.phase = 'ready';
    this.changed();
  }

  /** Practice songs can be played until the first real song of the night. */
  private practiceAllowed() {
    return this.data.currentStage === 0 && !this.data.rounds.some((r) => !r.practice && r.startedAt);
  }
  private practiceSongs() {
    return this.data.songs.filter((s) => s.list === PRACTICE_LIST && this.playable(s));
  }

  /** Warm-up song: plays like a normal song but gives no points and no cards. */
  practiceSong() {
    if (!['intro', 'stageIntro', 'ready'].includes(this.data.phase)) throw new GameError('Practice songs are played before the first song');
    if (!this.practiceAllowed()) throw new GameError('The game has already started');
    const prev = this.round;
    if (this.data.phase === 'ready' && prev && !prev.startedAt) {
      const ps = this.song(prev.songId);
      if (ps) ps.used = false;
      this.data.rounds.pop();
    }
    const song = this.practiceSongs()[0];
    if (!song) throw new GameError('No practice songs left. Add them in Songs → Practice.');
    song.used = true;
    const timelineYears: Record<string, number[]> = {};
    for (const t of this.data.teams) timelineYears[t.id] = t.timeline.map((c) => c.year);
    this.data.rounds.push({
      index: this.data.rounds.filter((r) => r.practice).length + 1,
      stage: this.data.currentStage,
      kind: 'normal',
      practice: true,
      songId: song.id,
      participants: this.data.teams.map((t) => t.id),
      startedAt: null,
      endsAt: null,
      answers: {},
      judgments: {},
      placementCorrect: {},
      timelineYears,
      speedWinnerId: null,
      speedMs: null,
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
    if (!r.participants.includes(teamId)) throw new GameError('Your team is not playing this song');
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
    // the player confirmed a warning on their screen, so incomplete answers are allowed
    if (confirm) a.confirmed = true;
    a.updatedAt = Date.now();
    r.answers[teamId] = a;
    // Everyone (who is online) locked in: the answers show early, the music simply keeps playing.
    if (this.allLockedIn(r)) {
      this.changed();
      this.endRound();
      return;
    }
    this.changed();
  }

  /** All participants confirmed; teams whose device is offline don't hold up the round. */
  private allLockedIn(r: Turn) {
    const online = r.participants.filter((p) => this.team(p)?.connected);
    const waitFor = online.length ? online : r.participants;
    return waitFor.every((p) => r.answers[p]?.confirmed);
  }

  endRound() {
    const r = this.round;
    if (this.data.phase !== 'playing' || !r) return;
    this.clearTimer();
    for (const p of r.participants) if (!hasContent(r.answers[p])) delete r.answers[p];
    const song = this.song(r.songId)!;
    for (const p of r.participants) {
      const a = r.answers[p];
      r.placementCorrect[p] = r.kind === 'normal' && !!a && song.year !== null && isPlacementCorrect(r.timelineYears[p] ?? [], a.position, song.year);
      r.judgments[p] = { artist: null, title: null };
    }
    if (this.data.settings.autopilot && song) {
      for (const p of r.participants) {
        const a = r.answers[p];
        if (!a) continue;
        r.judgments[p] = { artist: a.artist.trim() ? matchArtist(a.artist, song.artist) : false, title: a.title.trim() ? matchTitle(a.title, song.title) : false };
      }
    }
    this.computeSpeed(r);
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
    if (!r.participants.includes(teamId)) throw new GameError('Team did not play this song');
    r.judgments[teamId] = { ...(r.judgments[teamId] ?? { artist: null, title: null }), [field]: value };
    this.changed();
  }

  overridePlacement(teamId: string, value: boolean) {
    const r = this.round;
    if (!r || r.kind !== 'normal' || (this.data.phase !== 'reveal' && this.data.phase !== 'answers')) throw new GameError('Not judging right now');
    r.placementCorrect[teamId] = value;
    this.computeSpeed(r);
    this.changed();
  }

  /** Speed bonus: the first team that locked in (confirmed) the right spot. */
  private computeSpeed(r: Turn) {
    r.speedWinnerId = null;
    r.speedMs = null;
    if (r.kind !== 'normal' || r.practice || !r.startedAt || this.data.settings.speedBonus <= 0) return;
    for (const p of r.participants) {
      const a = r.answers[p];
      if (!a?.confirmed || !r.placementCorrect[p]) continue;
      const ms = Math.max(0, a.updatedAt - r.startedAt);
      if (r.speedMs === null || ms < r.speedMs) {
        r.speedWinnerId = p;
        r.speedMs = ms;
      }
    }
  }

  private roundPoints(r: Turn, teamId: string) {
    const j = r.judgments[teamId];
    return (j?.artist ? 100 : 0) + (j?.title ? 100 : 0);
  }

  /** Apply the song: cards onto timelines, points, then decide round winner / tie. */
  commit() {
    const r = this.round;
    if (this.data.phase !== 'reveal' || !r) throw new GameError('Reveal the answer first');
    if (r.practice) {
      // practice is over: nothing counts, on to the real thing
      r.committed = true;
      this.data.musicCursor++;
      this.data.outcome = null;
      this.data.phase = 'stageIntro';
      this.changed();
      return;
    }
    const song = this.song(r.songId)!;
    for (const p of r.participants) {
      const t = this.team(p);
      if (!t) continue;
      const pts = this.roundPoints(r, p) + (r.speedWinnerId === p ? this.data.settings.speedBonus : 0);
      t.points += pts;
      t.stagePoints += pts;
      if (r.kind === 'normal' && r.placementCorrect[p] && song.year !== null) {
        t.timeline.push({ year: song.year, songId: song.id, title: song.title, artist: song.artist, coverUrl: song.coverUrl });
        t.timeline.sort((a, b) => a.year - b.year);
      }
    }
    r.committed = true;
    this.data.musicCursor++;
    const winner = this.decide(r);
    if (winner) {
      winner.points += this.data.settings.winBonus;
      winner.wins.push(this.data.currentStage + 1);
      this.data.phase = 'stageEnd';
    } else {
      this.data.phase = 'scoreboard';
    }
    this.changed();
  }

  /** Returns the round winner, or null (no winner yet / tie → bonus turn). */
  private decide(r: Turn): Team | null {
    const target = this.data.settings.targetCards;
    const byId = (ids: string[]) => ids.map((i) => this.team(i)).filter((t): t is Team => !!t);
    const stageNo = this.data.currentStage + 1;
    const win = (t: Team, message: string) => {
      this.data.outcome = { winnerId: t.id, tiedTeamIds: [], message, stage: this.data.currentStage };
      this.data.pendingBonus = [];
      return t;
    };
    const tie = (ids: string[], message: string) => {
      this.data.outcome = { winnerId: null, tiedTeamIds: ids, message, stage: this.data.currentStage };
      this.data.pendingBonus = ids;
      return null;
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
      if (closest.length === 1) return win(closest[0], `${closest[0].name} was closest to ${song.year} and wins round ${stageNo}!`);
      const bestPts = Math.max(...closest.map((t) => this.roundPoints(r, t.id)));
      const top = closest.filter((t) => this.roundPoints(r, t.id) === bestPts);
      if (top.length === 1) return win(top[0], `${top[0].name} wins round ${stageNo} on artist & title!`);
      return tie(top.map((t) => t.id), 'Still a tie! Another bonus song.');
    }

    const finishers = this.data.teams.filter((t) => t.timeline.length >= target);
    if (finishers.length === 0) {
      const left = this.stageSongs().filter(this.playable).length;
      if (left === 0 && this.data.teams.length) {
        const most = Math.max(...this.data.teams.map((t) => t.timeline.length));
        const leaders = this.data.teams.filter((t) => t.timeline.length === most);
        const pts = Math.max(...leaders.map((t) => t.stagePoints));
        const top = leaders.filter((t) => t.stagePoints === pts);
        if (top.length === 1) return win(top[0], `Out of songs! ${top[0].name} has the longest timeline and wins round ${stageNo}.`);
        return tie(top.map((t) => t.id), 'Out of songs and a tie! Bonus song.');
      }
      this.data.outcome = null;
      return null;
    }
    if (finishers.length === 1) return win(finishers[0], `${finishers[0].name} completed the timeline and wins round ${stageNo}!`);
    const pts = Math.max(...finishers.map((t) => t.stagePoints));
    const top = finishers.filter((t) => t.stagePoints === pts);
    if (top.length === 1) return win(top[0], `${top[0].name} wins round ${stageNo} on points!`);
    return tie(top.map((t) => t.id), `It's a tie! Bonus song for ${top.map((t) => t.name).join(' & ')}.`);
  }

  showScoreboard() {
    if (!['intro', 'stageIntro', 'ready', 'scoreboard'].includes(this.data.phase)) throw new GameError('Not now');
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
    if (!['scoreboard', 'intro', 'ready', 'stageIntro'].includes(this.data.phase)) throw new GameError('Not now');
    const r = this.round;
    if (this.data.phase === 'ready' && r && !r.startedAt) {
      const s = this.song(r.songId);
      if (s) s.used = false;
      this.data.rounds.pop();
    }
    this.data.phase = 'intro';
    this.changed();
  }

  /** Back to the lobby, keep teams and songs. */
  resetGame() {
    this.clearTimer();
    for (const t of this.data.teams) {
      t.timeline = [];
      t.points = 0;
      t.stagePoints = 0;
      t.wins = [];
    }
    for (const s of this.data.songs) s.used = false;
    this.data.rounds = [];
    this.data.currentStage = 0;
    this.data.outcome = null;
    this.data.pendingBonus = [];
    this.data.awards = null;
    this.data.awardIndex = 0;
    this.data.phase = 'lobby';
    this.changed();
  }

  // ---------- views ----------
  private publicTeam(t: Team): TeamPublic {
    const { token: _t, ...rest } = t;
    return rest;
  }

  musicSong(): Song | null {
    if (!MUSIC_PHASES.includes(this.data.phase)) return null;
    const list = this.data.songs.filter((s) => s.list === MUSIC_LIST && s.spotifyId);
    if (!list.length) return null;
    return list[this.data.musicCursor % list.length];
  }

  publicState(): PublicState {
    const r = this.round;
    const phase = this.data.phase;
    const afterPlay = ['answers', 'reveal', 'scoreboard', 'stageEnd', 'awards', 'finished'].includes(phase);
    const afterReveal = ['reveal', 'scoreboard', 'stageEnd', 'awards', 'finished'].includes(phase);
    const song = r ? this.song(r.songId) : null;
    const st = this.stage;
    return {
      game: this.info,
      phase,
      serverNow: Date.now(),
      settings: this.data.settings,
      stage: { index: this.data.currentStage, count: this.data.stages.length, name: st.name, startYears: st.startYears },
      teams: this.data.teams.map((t) => this.publicTeam(t)),
      round:
        r && phase !== 'stageIntro' && phase !== 'intro' && phase !== 'lobby'
          ? {
              index: r.index,
              stage: r.stage,
              kind: r.kind,
              practice: !!r.practice,
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
              speedWinnerId: afterReveal ? r.speedWinnerId : null,
              speedMs: afterReveal ? r.speedMs : null,
            }
          : null,
      outcome: this.data.outcome,
      pendingBonus: this.data.pendingBonus,
      songsLeft: this.stageSongs().filter(this.playable).length,
      practiceLeft: this.practiceAllowed() ? this.practiceSongs().length : 0,
      // awards are revealed one at a time
      awards: phase === 'awards' || phase === 'finished' ? (this.data.awards ?? []).slice(0, phase === 'awards' ? this.data.awardIndex + 1 : undefined) : null,
      awardIndex: this.data.awardIndex,
      awardCount: this.data.awards?.length ?? 0,
    };
  }

  adminState(): AdminState {
    const pub = this.publicState();
    const r = this.round;
    const song = r ? this.song(r.songId) : null;
    if (pub.round && r) {
      pub.round.answers = r.answers;
      pub.round.timelineYears = r.timelineYears;
      pub.round.placementCorrect = r.placementCorrect;
      pub.round.judgments = r.judgments;
      pub.round.speedWinnerId = r.speedWinnerId;
      pub.round.speedMs = r.speedMs;
      pub.round.song = song ? { title: song.title, artist: song.artist, year: song.year, coverUrl: song.coverUrl } : null;
    }
    // the game song keeps playing through answers and reveal; scoreboard screens get scoreboard music
    const songPhases: Phase[] = ['ready', 'playing', 'answers', 'reveal'];
    return {
      ...pub,
      autoAt: this.autoAt,
      songs: this.data.songs,
      stages: this.data.stages,
      currentSongId: r && songPhases.includes(this.data.phase) ? r.songId : null,
      musicSongId: this.musicSong()?.id ?? null,
    };
  }

  playerState(teamId: string | null, base?: PublicState): PlayerState {
    const pub = base ?? this.publicState();
    const t = teamId ? this.team(teamId) : null;
    const r = this.round;
    return {
      ...pub,
      me: t ? this.publicTeam(t) : null,
      myAnswer: t && r && pub.round ? (r.answers[t.id] ?? null) : null,
    };
  }
}

// ---------- fuzzy matching for the autopilot ----------
export function normalizeAnswer(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/ - .*$/, ' ') // "Song - Remastered 2011"
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

function similar(a: string, b: string) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  const allowed = Math.max(1, Math.floor(Math.max(x.length, y.length) * 0.2)); // small typos
  return levenshtein(x, y) <= allowed;
}

export const matchTitle = (guess: string, title: string) => similar(guess, title);

/** Any of the credited artists counts ("Beyonce" for "Beyoncé, JAY-Z"). */
export function matchArtist(guess: string, artist: string) {
  if (similar(guess, artist)) return true;
  return artist.split(/,|&| and | x | feat\.? | ft\.? /i).some((part) => part.trim().length > 1 && similar(guess, part));
}

function clampInt(v: unknown, min: number, max: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new GameError('Invalid number');
  return Math.min(max, Math.max(min, n));
}
