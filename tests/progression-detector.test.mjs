import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAbsoluteProgressions,
  extractRomanProgressions,
} from '../lib/harmony/progression-detector.ts';

const absoluteCases = [
  ['C—F—C', ['C', 'F', 'C']],
  ['C—Fm—C', ['C', 'Fm', 'C']],
  ['C — Fm — C', ['C', 'Fm', 'C']],
  ['C–Fm–C', ['C', 'Fm', 'C']],
  ['C - Fm - C', ['C', 'Fm', 'C']],
  ['C→Fm→C', ['C', 'Fm', 'C']],
  ['C → Fm → C', ['C', 'Fm', 'C']],
  ['Dm7—G7—Cmaj7', ['Dm7', 'G7', 'Cmaj7']],
  ['Am—Dm—E7—Am', ['Am', 'Dm', 'E7', 'Am']],
  ['F♯m6—B7—Emaj9', ['F#m6', 'B7', 'Emaj9']],
  ['Csus4—Cadd9—C/G', ['Csus4', 'Cadd9', 'C/G']],
  ['Bø7—E7—Am9', ['Bø7', 'E7', 'Am9']],
  ['Eb—G(7)—C', ['Eb', 'G(7)', 'C']],
];

for (const [source, expected] of absoluteCases) {
  test(`recognizes absolute progression: ${source}`, () => {
    assert.deepEqual(extractAbsoluteProgressions(source), [expected]);
  });
}

test('recognizes separate progressions in one DOM block', () => {
  assert.deepEqual(extractAbsoluteProgressions('C—F—C vs. C—Fm—C'), [
    ['C', 'F', 'C'],
    ['C', 'Fm', 'C'],
  ]);
});

test('recognizes major and borrowed-minor Roman progressions', () => {
  assert.deepEqual(extractRomanProgressions('I—IV—I vs. I—iv—I'), [
    ['I', 'IV', 'I'],
    ['I', 'iv', 'I'],
  ]);
});

test('does not recognize isolated chord-like capital letters', () => {
  for (const source of ['C', 'F', 'A']) {
    assert.deepEqual(extractAbsoluteProgressions(source), []);
  }
});

test('does not recognize ordinary English prose', () => {
  assert.deepEqual(extractAbsoluteProgressions('A clear introduction to harmony for beginners.'), []);
  assert.deepEqual(extractAbsoluteProgressions('Chords can create color and forward motion.'), []);
  assert.deepEqual(extractAbsoluteProgressions('A-B testing is ordinary English terminology.'), []);
});

test('does not turn explicit pitch or chord-tone lists into progressions', () => {
  assert.deepEqual(extractAbsoluteProgressions('C-D-E-F-G-A-B-C是C大调音阶。'), []);
  assert.deepEqual(extractAbsoluteProgressions('G和弦包括G-B-D三个音。'), []);
  assert.deepEqual(extractAbsoluteProgressions('旋律音列为C—D—E—F。'), []);
});
