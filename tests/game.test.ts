import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, isPlacementCorrect } from '../server/game.js';

const mk = (list: string) => (title: string, year: number) => ({
  spotifyId: null, spotifyUrl: null, title, artist: 'A', coverUrl: null, year,
  spotifyYear: null, musicbrainzYear: null, needsCheck: false, list, startAt: 0,
});

test('placement rule', () => {
  assert.equal(isPlacementCorrect([1987], 0, 1980), true);
  assert.equal(isPlacementCorrect([1987], 1, 1980), false);
  assert.equal(isPlacementCorrect([1987, 2001], 1, 1995), true);
  assert.equal(isPlacementCorrect([1987, 2001], 1, 1987), true); // equal year either side
  assert.equal(isPlacementCorrect([1987, 2001], 0, 1987), true);
  assert.equal(isPlacementCorrect([1987, 2001], 2, 1995), false);
  assert.equal(isPlacementCorrect([1987], null, 1995), false);
});

function play(g: Game, answers: Record<string, any>, judge: Record<string, [boolean, boolean]> = {}) {
  g.nextSong();
  g.startRound();
  for (const [t, a] of Object.entries(answers)) g.submitAnswer(t, a, false);
  g.endRound();
  g.reveal();
  for (const [t, [ar, ti]] of Object.entries(judge)) {
    g.judge(t, 'artist', ar);
    g.judge(t, 'title', ti);
  }
  g.commit();
}

test('songs play in the set order, round winner gets the bonus and a medal, next round resets timelines', () => {
  const g = new Game();
  g.updateSettings({ targetCards: 3 });
  const s1 = g.data.stages[0].id;
  g.addStage();
  const s2 = g.data.stages[1].id;
  g.updateStage(s2, { startYears: [1980, 2000] });
  g.addSongs([mk(s1)('first', 1990), mk(s1)('second', 2000), mk(s1)('third', 1970)]);
  g.addSongs([mk(s2)('r2a', 1990), mk(s2)('r2b', 2010)]);
  const a = g.join('A').id;
  const b = g.join('B').id;
  g.startShow();
  assert.equal(g.team(a)!.timeline.length, 1);
  play(g, { [a]: { position: 1 }, [b]: { position: 0 } }, { [a]: [true, false] });
  assert.equal(g.data.songs.find((s) => s.title === 'first')!.used, true);
  assert.equal(g.data.songs.find((s) => s.title === 'second')!.used, false);
  assert.equal(g.data.phase, 'scoreboard');
  play(g, { [a]: { position: 2 }, [b]: { position: 1 } });
  assert.equal(g.data.phase, 'stageEnd');
  assert.equal(g.data.outcome!.winnerId, a);
  assert.deepEqual(g.team(a)!.wins, [1]);
  assert.equal(g.team(a)!.points, 1100);
  g.nextStage();
  assert.equal(g.data.phase, 'stageIntro');
  assert.deepEqual(g.team(a)!.timeline.map((c) => c.year), [1980, 2000]);
  assert.equal(g.team(a)!.points, 1100); // points carry over
  g.nextSong();
  assert.equal(g.data.songs.find((s) => s.id === g.round!.songId)!.title, 'r2a');
  assert.equal(g.round!.index, 1);
});

test('tie on cards and round points goes to a bonus song, then the night is finished on total points', () => {
  const g = new Game();
  g.updateSettings({ targetCards: 2 });
  const s1 = g.data.stages[0].id;
  g.addSongs([mk(s1)('s1', 1995), mk('bonus')('b1', 1984)]);
  const a = g.join('A').id;
  const b = g.join('B').id;
  const c = g.join('C').id;
  g.startShow();
  play(g, { [a]: { position: 1 }, [b]: { position: 1 } }, { [c]: [true, true] });
  assert.equal(g.data.phase, 'scoreboard');
  assert.deepEqual(new Set(g.data.pendingBonus), new Set([a, b]));
  g.nextSong();
  assert.equal(g.round!.kind, 'bonus');
  g.startRound();
  assert.throws(() => g.submitAnswer(c, { yearGuess: 1984 }, true), /not playing/);
  g.submitAnswer(a, { yearGuess: 1981 }, true);
  g.submitAnswer(b, { yearGuess: 1987 }, true);
  g.reveal();
  g.judge(a, 'title', true);
  g.commit();
  assert.equal(g.data.phase, 'stageEnd');
  assert.equal(g.data.outcome!.winnerId, a);
  assert.throws(() => g.nextStage(), /last round/);
  g.finishEvening();
  assert.equal(g.data.phase, 'awards');
  while (g.data.phase === 'awards') g.nextAward();
  assert.equal(g.data.phase, 'finished');
  assert.equal(g.data.outcome!.winnerId, a); // 1100 vs C's 200
});

test('two start cards; an incomplete answer can be confirmed and counts as wrong', () => {
  const g = new Game();
  const s1 = g.data.stages[0].id;
  g.updateStage(s1, { startYears: [2005, 1975] });
  g.addSongs([mk(s1)('x', 1990)]);
  const a = g.join('A').id;
  g.startShow();
  assert.deepEqual(g.team(a)!.timeline.map((c) => c.year), [1975, 2005]);
  g.nextSong();
  g.startRound();
  g.submitAnswer(a, { title: 'x' }, true);
  assert.equal(g.data.phase, 'answers'); // everyone locked in
  assert.equal(g.round!.placementCorrect[a], false);
});

test('old saved games are migrated', () => {
  const old: any = {
    phase: 'lobby',
    settings: { defaultStartYear: 1979, roundSeconds: 60, targetCards: 10, answersSeconds: 6, joinOpen: true },
    songs: [{ id: 'a', title: 'x', artist: 'y', year: 1990, bonus: false, used: false }, { id: 'b', title: 'z', artist: 'y', year: 1991, bonus: true, used: false }],
    teams: [{ id: 't', token: 'k', name: 'T', photoVersion: 0, startYear: 2001, timeline: [], points: 0, connected: false }],
    rounds: [], outcome: null, pendingBonus: [],
  };
  const g = new Game(old);
  assert.deepEqual(g.data.stages[0].startYears, [1979]);
  assert.equal(g.data.songs[0].list, g.data.stages[0].id);
  assert.equal(g.data.songs[1].list, 'bonus');
  assert.deepEqual(g.data.teams[0].startYears, [2001]);
});

test('awards are computed from what happened', () => {
  const g = new Game();
  g.updateSettings({ targetCards: 10 });
  const s1 = g.data.stages[0].id;
  g.addSongs([mk(s1)('Africa', 1982), mk(s1)('Wonderwall', 1995), mk(s1)('Toxic', 2003)]);
  const a = g.join('A').id;
  const b = g.join('B').id;
  const c = g.join('C').id;
  g.startShow();
  // start card 1987: Africa (1982) belongs before it
  play(g, { [a]: { position: 0 }, [b]: { position: 1 }, [c]: { position: 1 } }, { [a]: [true, true], [c]: [true, false] });
  // Wonderwall (1995): B again wrong
  play(g, { [a]: { position: 2 }, [b]: { position: 0 }, [c]: { position: 2 } }, { [a]: [true, false] });
  g.finishEvening();
  const byId = Object.fromEntries(g.data.awards!.map((x) => [x.id, x]));
  assert.deepEqual(byId.gamblers.teamIds, [b]);
  assert.deepEqual(byId.encyclopedia.teamIds, [a]);
  assert.equal(byId.encyclopedia.detail, '2 artists right');
  assert.ok(byId.close.detail.startsWith('Africa (1982): only 5 years off'));
  assert.deepEqual(byId.last.teamIds, [b]);
  // awards are revealed one at a time
  assert.equal(g.publicState().awards!.length, 1);
  g.nextAward();
  assert.equal(g.publicState().awards!.length, 2);
  g.skipAwards();
  assert.equal(g.data.phase, 'finished');
  assert.equal(g.data.outcome!.winnerId, a);
});
