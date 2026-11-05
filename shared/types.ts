export type Phase =
  | 'lobby' // teams join
  | 'intro' // explanation animation on the show screen
  | 'stageIntro' // "Round 2" title card, timelines reset
  | 'ready' // song loaded, waiting for the host to press play
  | 'playing' // guessing window
  | 'answers' // all team answers on the show screen
  | 'reveal' // correct answer shown, host judges artist/title
  | 'scoreboard' // timelines + points
  | 'stageEnd' // a team won this round
  | 'awards' // fun awards, one by one
  | 'finished'; // final results of the night

export interface Award {
  id: string;
  emoji: string;
  title: string;
  grand?: boolean; // the final award of the night
  subtitle: string; // what the award is for
  teamIds: string[]; // winners (ties share the award)
  detail: string; // e.g. "12 artists right"
}

export type TurnKind = 'normal' | 'bonus';

/** A round of the night: its own song list, start cards and winner. */
export interface Stage {
  id: string;
  name: string;
  startYears: number[]; // 1 or 2 start cards
}

/** Special song lists next to the stages. */
export const BONUS_LIST = 'bonus';
export const MUSIC_LIST = 'music';
export const PRACTICE_LIST = 'practice';

export interface Song {
  id: string;
  list: string; // stage id, BONUS_LIST, MUSIC_LIST or PRACTICE_LIST
  spotifyId: string | null;
  spotifyUrl: string | null;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  spotifyYear: number | null;
  musicbrainzYear: number | null;
  needsCheck: boolean; // year sources disagree or missing
  startAt: number; // seconds, used for scoreboard music (chorus)
  used: boolean;
}

export interface TimelineCard {
  year: number;
  songId: string | null; // null = start card
  title: string | null;
  artist: string | null;
  coverUrl: string | null;
  n?: number; // song number in its round: decides the card's colour (start cards have none)
}

export interface Answer {
  position: number | null; // insert index in the timeline (0..timeline.length)
  yearGuess: number | null; // bonus turns only
  artist: string;
  title: string;
  confirmed: boolean;
  updatedAt: number;
}

export interface Judgment {
  artist: boolean | null;
  title: boolean | null;
}

/** One song being played. */
export interface Turn {
  index: number; // song number within the stage
  stage: number; // stage index
  kind: TurnKind;
  songId: string;
  participants: string[];
  startedAt: number | null;
  endsAt: number | null;
  answers: Record<string, Answer>;
  judgments: Record<string, Judgment>;
  placementCorrect: Record<string, boolean>;
  timelineYears: Record<string, number[]>;
  speedWinnerId: string | null; // first team to lock in the right spot
  speedMs: number | null; // how fast, from the start of the song
  practice?: boolean; // warm-up song: no points, no cards
  committed: boolean;
}

export interface Settings {
  roundSeconds: number; // music + answer time per song
  targetCards: number; // cards needed to win a round (start cards included)
  answersSeconds: number; // how long team answers are shown before the reveal
  winBonus: number; // points for winning a round
  speedBonus: number; // points for the first team to lock in the right spot (0 = off)
  blind: boolean; // host panel hides titles/artists/years so the host can play along
  autopilot: boolean; // the game moves on by itself (host can still click)
  autoRevealSeconds: number; // autopilot: time on the reveal before the scoreboard
  autoScoreboardSeconds: number; // autopilot: time on the scoreboard before the next song
  joinOpen: boolean;
}

export interface TeamPublic {
  id: string;
  name: string;
  photoVersion: number; // 0 = no photo
  startYears: number[] | null; // per-team override, null = stage default
  timeline: TimelineCard[];
  points: number; // total for the night
  stagePoints: number; // artist/title points in the current round (tie-breaker)
  wins: number[]; // round numbers (1-based) this team won
  connected: boolean;
}

export interface Outcome {
  winnerId: string | null;
  tiedTeamIds: string[]; // teams going into a bonus turn, or sharing the final win
  message: string;
  stage: number | null; // stage that was won, null for the final result
}

/** What the show screen and players receive: never contains the song before the reveal. */
export interface PublicState {
  game: GameInfo;
  phase: Phase;
  serverNow: number;
  settings: Settings;
  stage: { index: number; count: number; name: string; startYears: number[] };
  teams: TeamPublic[];
  round: null | {
    index: number;
    stage: number;
    kind: TurnKind;
    practice: boolean;
    participants: string[];
    startedAt: number | null;
    endsAt: number | null;
    confirmedTeamIds: string[];
    answeredTeamIds: string[];
    answers: Record<string, Answer> | null;
    timelineYears: Record<string, number[]> | null;
    song: Pick<Song, 'title' | 'artist' | 'year' | 'coverUrl'> | null;
    placementCorrect: Record<string, boolean> | null;
    judgments: Record<string, Judgment> | null;
    speedWinnerId: string | null;
    speedMs: number | null;
  };
  outcome: Outcome | null;
  pendingBonus: string[];
  songsLeft: number; // in the current stage
  practiceLeft: number; // practice songs that can still be played before the game starts
  awards: Award[] | null;
  awardIndex: number;
  awardCount: number;
}

export interface AdminState extends PublicState {
  autoAt: number | null; // autopilot: when the next step happens
  songs: Song[];
  stages: Stage[];
  currentSongId: string | null;
  musicSongId: string | null; // scoreboard music to play now
}

export interface PlayerState extends PublicState {
  me: TeamPublic | null;
  myAnswer: Answer | null;
}

export interface GameSummary {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  teams: number;
  songs: number;
  stages: number;
  songsToCheck: number;
  bonusSongs: number;
}

export interface GameInfo {
  id: string;
  code: string;
  name: string;
}
