import { chordToMidi, parseChord, type ParsedChord } from './chord-parser.ts';

const MIN_MIDI = 42;
const MAX_MIDI = 84;
const TARGET_CENTER = 63;

function uniqueCandidates(candidates: number[][]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function voicingCandidates(chord: ParsedChord) {
  const rootPosition = chordToMidi(chord.display);
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < rootPosition.length; inversion += 1) {
    const rotated = rootPosition.slice(inversion).concat(rootPosition.slice(0, inversion).map((note) => note + 12));
    for (let octave = -2; octave <= 2; octave += 1) {
      const candidate = rotated.map((note) => note + octave * 12);
      if (Math.min(...candidate) >= MIN_MIDI && Math.max(...candidate) <= MAX_MIDI) candidates.push(candidate);
    }
  }
  return uniqueCandidates(candidates);
}

function centerScore(notes: number[]) {
  const center = notes.reduce((sum, note) => sum + note, 0) / notes.length;
  return Math.abs(center - TARGET_CENTER) + (Math.max(...notes) - Math.min(...notes)) * 0.04;
}

function nearestMovement(previous: number[], candidate: number[]) {
  const forward = candidate.reduce((sum, note) => sum + Math.min(...previous.map((oldNote) => Math.abs(note - oldNote))), 0);
  const reverse = previous.reduce((sum, note) => sum + Math.min(...candidate.map((newNote) => Math.abs(note - newNote))), 0);
  const commonTones = candidate.filter((note) => previous.some((oldNote) => note % 12 === oldNote % 12)).length;
  const sizePenalty = Math.abs(previous.length - candidate.length) * 4;
  return forward + reverse * 0.35 + sizePenalty - commonTones * 3;
}

function chooseFirst(candidates: number[][]) {
  return candidates.reduce((best, candidate) => centerScore(candidate) < centerScore(best) ? candidate : best, candidates[0]);
}

function chooseNearest(previous: number[], candidates: number[][]) {
  return candidates.reduce((best, candidate) => nearestMovement(previous, candidate) < nearestMovement(previous, best) ? candidate : best, candidates[0]);
}

/** Deterministic, conservative voicing for prose chord symbols only. */
export function progressionToMidi(symbols: string[]) {
  let previous: number[] | null = null;
  return symbols.map((symbol) => {
    const parsed = parseChord(symbol);
    const candidates = parsed ? voicingCandidates(parsed) : [[48, 52, 55]];
    const chosen = previous ? chooseNearest(previous, candidates) : chooseFirst(candidates);
    previous = chosen;
    return chosen;
  });
}
