import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chordPitchClassNames,
  chordToMidi,
  parseChord,
} from '../lib/harmony/chord-parser.ts';
import { progressionToMidi } from '../lib/harmony/voice-leading.ts';

const names = (symbol) => chordPitchClassNames(parseChord(symbol));
const midi = (symbol) => chordToMidi(symbol);

test('half-diminished aliases resolve to B D F A', () => {
  for (const symbol of ['Bø', 'Bø7', 'Bm7b5', 'Bm7♭5']) {
    assert.deepEqual(names(symbol), ['B', 'D', 'F', 'A']);
    assert.equal(parseChord(symbol).canonical, 'Bm7b5');
  }
});

test('fully diminished seventh aliases resolve to B D F Ab', () => {
  for (const symbol of ['B°7', 'Bdim7']) {
    assert.deepEqual(names(symbol), ['B', 'D', 'F', 'Ab']);
    assert.equal(parseChord(symbol).canonical, 'Bdim7');
  }
});

test('diminished triad aliases resolve to B D F and stay distinct from dim7', () => {
  for (const symbol of ['B°', 'Bdim']) {
    assert.deepEqual(names(symbol), ['B', 'D', 'F']);
    assert.equal(parseChord(symbol).canonical, 'Bdim');
  }
  assert.notEqual(parseChord('B°').canonical, parseChord('B°7').canonical);
  assert.notDeepEqual(names('B°'), names('B°7'));
});

test('MIDI keeps A and Ab one semitone apart', () => {
  assert.deepEqual(midi('Bø'), [59, 62, 65, 69]);
  assert.deepEqual(midi('B°7'), [59, 62, 65, 68]);
  assert.deepEqual(midi('B°'), [59, 62, 65]);
});

test('quality handling is not hard-coded to B', () => {
  assert.deepEqual(names('Cø'), ['C', 'Eb', 'Gb', 'Bb']);
  assert.deepEqual(names('C°7'), ['C', 'Eb', 'Gb', 'A']);
  assert.deepEqual(names('C#ø'), ['C#', 'E', 'G', 'B']);
  assert.deepEqual(names('C#°7'), ['C#', 'E', 'G', 'Bb']);
  assert.deepEqual(names('Bbø'), ['Bb', 'Db', 'E', 'Ab']);
  assert.deepEqual(names('Bb°7'), ['Bb', 'Db', 'E', 'G']);
});

test('common chord grammar remains supported', () => {
  assert.deepEqual(names('C'), ['C', 'E', 'G']);
  assert.deepEqual(names('Cm'), ['C', 'Eb', 'G']);
  assert.deepEqual(names('C7'), ['C', 'E', 'G', 'Bb']);
  assert.deepEqual(names('Cm7'), ['C', 'Eb', 'G', 'Bb']);
  assert.deepEqual(names('Cmaj7'), ['C', 'E', 'G', 'B']);
  assert.deepEqual(names('Cdim'), ['C', 'Eb', 'Gb']);
  assert.deepEqual(names('C+'), ['C', 'E', 'G#']);
  assert.deepEqual(names('C/E'), ['C', 'E', 'G']);
});

test('voice leading keeps half-diminished and diminished seventh MIDI distinct', () => {
  const half = progressionToMidi(['Bø', 'C']);
  const full = progressionToMidi(['B°7', 'C']);
  assert.notDeepEqual(half[0], full[0]);
  assert.ok(half[0].includes(69));
  assert.ok(full[0].includes(68));
  assert.deepEqual(half[1], full[1]);
  assert.ok(Math.abs(Math.min(...half[1]) - Math.min(...half[0])) <= 12);
});
