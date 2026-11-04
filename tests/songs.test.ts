import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSpotifyTrackIds } from '../server/songs.js';

test('extracts track ids from pasted text', () => {
  const text = `https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc
https://open.spotify.com/intl-nl/track/7tFiyTwD0nx5a1eklYtX2J
spotify:track:4uLU6hMCjMI75M1A2tKUQC
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`;
  assert.deepEqual(extractSpotifyTrackIds(text), ['4uLU6hMCjMI75M1A2tKUQC', '7tFiyTwD0nx5a1eklYtX2J']);
});
