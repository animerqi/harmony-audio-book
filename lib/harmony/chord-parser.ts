export const NOTE_INDEX: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

export type ChordQuality =
  | 'major'
  | 'minor'
  | 'major6'
  | 'minor6'
  | 'dominant7'
  | 'minor7'
  | 'major7'
  | 'dominant9'
  | 'minor9'
  | 'major9'
  | 'diminished'
  | 'diminished7'
  | 'half-diminished'
  | 'augmented'
  | 'augmented7'
  | 'sus2'
  | 'sus4'
  | 'add9';

export type ParsedChord = {
  display: string;
  canonical: string;
  rootName: string;
  rootPitchClass: number;
  quality: ChordQuality;
  intervals: number[];
  pitchClasses: number[];
  slashBass?: string;
};

const QUALITY_DEFINITIONS: Array<{ pattern: RegExp; quality: ChordQuality; suffix: string; intervals: number[] }> = [
  { pattern: /^(?:m7b5|ø7?|min7b5)$/, quality: 'half-diminished', suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { pattern: /^(?:dim7|°7)$/, quality: 'diminished7', suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { pattern: /^(?:dim|°)$/, quality: 'diminished', suffix: 'dim', intervals: [0, 3, 6] },
  { pattern: /^(?:maj9)$/, quality: 'major9', suffix: 'maj9', intervals: [0, 4, 7, 11, 14] },
  { pattern: /^(?:m9|min9)$/, quality: 'minor9', suffix: 'm9', intervals: [0, 3, 7, 10, 14] },
  { pattern: /^(?:9)$/, quality: 'dominant9', suffix: '9', intervals: [0, 4, 7, 10, 14] },
  { pattern: /^(?:maj7|Δ7?|\(Δ\))$/, quality: 'major7', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { pattern: /^(?:m7|min7)$/, quality: 'minor7', suffix: 'm7', intervals: [0, 3, 7, 10] },
  { pattern: /^(?:7)$/, quality: 'dominant7', suffix: '7', intervals: [0, 4, 7, 10] },
  { pattern: /^(?:m6|min6)$/, quality: 'minor6', suffix: 'm6', intervals: [0, 3, 7, 9] },
  { pattern: /^(?:6)$/, quality: 'major6', suffix: '6', intervals: [0, 4, 7, 9] },
  { pattern: /^(?:aug7|\+7)$/, quality: 'augmented7', suffix: 'aug7', intervals: [0, 4, 8, 10] },
  { pattern: /^(?:aug|\+)$/, quality: 'augmented', suffix: 'aug', intervals: [0, 4, 8] },
  { pattern: /^(?:sus2)$/, quality: 'sus2', suffix: 'sus2', intervals: [0, 2, 7] },
  { pattern: /^(?:sus4)$/, quality: 'sus4', suffix: 'sus4', intervals: [0, 5, 7] },
  { pattern: /^(?:add9)$/, quality: 'add9', suffix: 'add9', intervals: [0, 4, 7, 14] },
  { pattern: /^(?:m|min|minor)$/, quality: 'minor', suffix: 'm', intervals: [0, 3, 7] },
  { pattern: /^(?:maj|major|\(\))$/, quality: 'major', suffix: '', intervals: [0, 4, 7] },
];

export function normalizeChordSymbol(value: string) {
  return value
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .replace(/\s+/g, '')
    .replace(/^([a-g])/, (_, letter: string) => letter.toUpperCase());
}

function definitionForQuality(rawQuality: string) {
  const quality = rawQuality.replace(/^\((.*)\)$/, '$1').replace('Δ', 'maj7');
  return QUALITY_DEFINITIONS.find((definition) => definition.pattern.test(quality))
    ?? { quality: 'major' as const, suffix: '', intervals: [0, 4, 7] };
}

export function parseChord(value: string): ParsedChord | null {
  const display = value.trim();
  const clean = normalizeChordSymbol(display);
  const match = clean.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match || NOTE_INDEX[match[1]] === undefined) return null;

  const [, rootName, suffixAndBass] = match;
  const [rawQuality, rawBass] = suffixAndBass.split('/');
  const definition = definitionForQuality(rawQuality);
  const slashBass = rawBass && NOTE_INDEX[rawBass] !== undefined ? rawBass : undefined;
  const canonical = `${rootName}${definition.suffix}${slashBass ? `/${slashBass}` : ''}`;
  const rootPitchClass = NOTE_INDEX[rootName];
  const pitchClasses = definition.intervals.map((interval) => (rootPitchClass + interval) % 12);
  if (slashBass && !pitchClasses.includes(NOTE_INDEX[slashBass])) pitchClasses.unshift(NOTE_INDEX[slashBass]);

  return {
    display,
    canonical,
    rootName,
    rootPitchClass,
    quality: definition.quality,
    intervals: definition.intervals,
    pitchClasses,
    slashBass,
  };
}

export function chordToMidi(symbol: string, baseMidi = 48) {
  const parsed = parseChord(symbol);
  if (!parsed) return [48, 52, 55];
  const root = baseMidi + parsed.rootPitchClass;
  const notes = parsed.intervals.map((interval) => root + interval);
  if (parsed.slashBass) {
    let bass = baseMidi - 12 + NOTE_INDEX[parsed.slashBass];
    while (bass >= notes[0]) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function chordPitchClassNames(chord: ParsedChord) {
  const preferFlats = chord.rootName.includes('b')
    || (!chord.rootName.includes('#') && ['minor', 'minor7', 'minor9', 'half-diminished', 'dominant7', 'dominant9', 'diminished7', 'diminished'].includes(chord.quality));
  return chord.pitchClasses.map((pitchClass, index) => {
    // A diminished seventh is conventionally spelled with a flattened seventh
    // even when the root itself was written with a sharp.
    const useFlats = preferFlats || (chord.quality === 'diminished7' && chord.intervals[index] === 9);
    const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
    return names[(pitchClass + 12) % 12];
  });
}

export function describeChord(symbol: string) {
  const chord = parseChord(symbol);
  if (!chord) return null;
  return {
    display: chord.display,
    canonical: chord.canonical,
    notes: chordPitchClassNames(chord),
    midi: chordToMidi(symbol),
  };
}
