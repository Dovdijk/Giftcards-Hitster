import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, isPlacementCorrect } from '../server/game.js';

const song = (title: string, year: number, bonus = false) => ({
  spotifyId: null, spotifyUrl: null, title, artist: 'A', coverUrl: null, year,
  spotifyYear: null, musicbrainzYear: null, needsCheck: false, bonus,
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

test('full game, tie on cards & points, bonus round decides', () => {
  const g = new Game();
  g.updateSettings({ targetCards: 3 });
  g.addSongs([song('s1', 1990), song('s2', 2000), song('s3', 1970), song('b1', 1984, true), song('b2', 1999, true)]);
  const a = g.join('A').id;
  const b = g.join('B').id;
  const c = g.join('C').id;
  g.startShow();
  // round 1: 1990 -> after 1987 is position 1
  play(g, { [a]: { position: 1 }, [b]: { position: 1 }, [c]: { position: 0 } }, { [a]: [true, false], [b]: [true, false] });
  assert.equal(g.team(a)!.timeline.length, 2);
  assert.equal(g.team(c)!.timeline.length, 1);
  assert.equal(g.team(a)!.points, 100);
  // round 2: 2000, timeline [1987,1990] -> position 2; unconfirmed draft still counts
  play(g, { [a]: { position: 2 }, [b]: { position: 2 } });
  // both have 3 cards & 100 points -> tie -> bonus
  assert.deepEqual(new Set(g.data.pendingBonus), new Set([a, b]));
  assert.equal(g.data.phase, 'scoreboard');
  // bonus: song b1 = 1984, both guess 3 off -> tie on year; A gets title -> A wins
  g.nextSong();
  assert.equal(g.round!.kind, 'bonus');
  assert.deepEqual(g.round!.participants.sort(), [a, b].sort());
  assert.throws(() => g.submitAnswer(c, { yearGuess: 1984 }, true));
  g.startRound();
  g.submitAnswer(a, { yearGuess: 1981 }, true);
  g.submitAnswer(b, { yearGuess: 1987 }, true); // all confirmed -> ends automatically
  assert.equal(g.data.phase, 'answers');
  g.reveal();
  g.judge(a, 'title', true);
  g.commit();
  assert.equal(g.data.phase, 'finished');
  assert.equal(g.data.outcome!.winnerId, a);
});

test('single finisher wins, confirm requires position', () => {
  const g = new Game();
  g.updateSettings({ targetCards: 2 });
  g.addSongs([song('s1', 1995)]);
  const a = g.join('A').id;
  g.join('B');
  g.startShow();
  g.nextSong();
  g.startRound();
  assert.throws(() => g.submitAnswer(a, { title: 'x' }, true), /Drag/);
  g.submitAnswer(a, { position: 1 }, true);
  g.endRound();
  g.reveal();
  g.commit();
  assert.equal(g.data.outcome!.winnerId, a);
});
