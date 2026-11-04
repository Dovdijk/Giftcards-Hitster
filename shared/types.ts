export type Phase =
  | 'lobby' // teams join
  | 'intro' // explanation animation on the show screen
  | 'ready' // song loaded, waiting for the admin to press play
  | 'playing' // 60 second guessing window
  | 'answers' // all team answers on the show screen
  | 'reveal' // correct answer shown, admin judges artist/title
  | 'scoreboard' // timelines + points
  | 'finished'; // winner

export type RoundKind = 'normal' | 'bonus';

export interface Song {
  id: string;
  spotifyId: string | null;
  spotifyUrl: string | null;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  spotifyYear: number | null;
  musicbrainzYear: number | null;
  needsCheck: boolean; // year sources disagree or missing
  bonus: boolean; // reserved for bonus rounds
  used: boolean;
}

export interface TimelineCard {
  year: number;
  songId: string | null; // null = start card
  title: string | null;
  artist: string | null;
  coverUrl: string | null;
}

export interface Answer {
  position: number | null; // insert index in the timeline (0..timeline.length)
  yearGuess: number | null; // bonus rounds only
  artist: string;
  title: string;
  confirmed: boolean;
  updatedAt: number;
}

export interface Judgment {
  artist: boolean | null;
  title: boolean | null;
}

export interface Round {
  index: number;
  kind: RoundKind;
  songId: string;
  participants: string[];
  startedAt: number | null;
  endsAt: number | null;
  answers: Record<string, Answer>;
  judgments: Record<string, Judgment>;
  placementCorrect: Record<string, boolean>;
  // snapshot of each team's timeline years when the round started
  timelineYears: Record<string, number[]>;
  committed: boolean;
}

export interface Settings {
  defaultStartYear: number;
  roundSeconds: number;
  targetCards: number;
  answersSeconds: number; // how long team answers are shown before the reveal
  joinOpen: boolean;
}

export interface TeamPublic {
  id: string;
  name: string;
  photoVersion: number; // 0 = no photo
  startYear: number | null; // null = default
  timeline: TimelineCard[];
  points: number;
  connected: boolean;
}

export interface Outcome {
  winnerId: string | null;
  tiedTeamIds: string[]; // teams going into a bonus round
  message: string;
}

/** What the show screen and players receive: never contains the song before the reveal. */
export interface PublicState {
  phase: Phase;
  serverNow: number;
  settings: Settings;
  teams: TeamPublic[];
  round: null | {
    index: number;
    kind: RoundKind;
    participants: string[];
    startedAt: number | null;
    endsAt: number | null;
    confirmedTeamIds: string[];
    answeredTeamIds: string[];
    // only from 'answers' on
    answers: Record<string, Answer> | null;
    timelineYears: Record<string, number[]> | null;
    // only from 'reveal' on
    song: Pick<Song, 'title' | 'artist' | 'year' | 'coverUrl'> | null;
    placementCorrect: Record<string, boolean> | null;
    judgments: Record<string, Judgment> | null;
  };
  outcome: Outcome | null;
  pendingBonus: string[]; // tied teams waiting for a bonus round
  songsLeft: number;
}

export interface AdminState extends PublicState {
  songs: Song[];
  currentSongId: string | null;
}

export interface PlayerState extends PublicState {
  me: TeamPublic | null;
  myAnswer: Answer | null;
}
