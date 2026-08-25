# Harmony Audio Book 🎹

[简体中文](README.zh-CN.md) | **English**

> Turn music theory textbooks into readable, playable, and interactive study material.

Harmony Audio Book is a browser-based reader for music theory textbooks. It parses the bundled HTML books, detects explicit harmony examples, and connects textbook score images and harmony symbols to a shared sampled-piano playback engine.

## Features

### Harmony recognition

The reader can detect explicit chord-symbol and Roman-numeral progressions in textbook prose, including examples such as:

```text
C—F—C
Dm7—G7—Cmaj7
C—Fm—C
Bø—C
```

The harmony parser currently covers common major, minor, sixth, seventh, ninth, diminished, half-diminished, augmented, suspended, added-tone, slash-chord, accidental, and Roman-numeral forms. Parsed symbols retain their display spelling while being converted into canonical chord data and MIDI pitches. Text progressions use deterministic nearest-voicing voice leading before playback.

### Score discovery and recognition

The score-discovery layer scans the book HTML for likely notation resources, including regular and lazy-loaded images, `picture`/`figure` containers, linked images, inline SVG, and nearby score context. It records candidates and distinguishes found scores, references to earlier scores, and unresolved score mentions.

Eligible staff-notation images can be processed through the existing HOMR pipeline:

```text
Book HTML → score candidate discovery → HOMR → MusicXML → MIDI/events → reader playback
```

HOMR is not a universal transcription system. Numbered-notation and rhythm-only teaching graphics may require a separate transcription workflow and are not silently converted into invented pitches.

### Shared sampled-piano playback

Both text progressions and HOMR event streams use the same browser-side `PianoEngine` and `smplr`'s `SplendidGrandPiano` sampler:

```text
Harmony symbols or score events
              ↓
          Note events
              ↓
        PianoEngine
              ↓
    SplendidGrandPiano samples
              ↓
        Web Audio output
```

The engine reuses one `AudioContext` and sampler instance, handles suspended mobile-browser contexts, reports initial sample loading, preserves event timing, and stops scheduled notes and timers when playback changes or the reader unmounts.

## Architecture

```text
                 Textbook HTML
                 /            \
                /              \
      Harmony detector      Score detector
              |                   |
        Chord/Roman parser       HOMR
              |                   |
       Voice-leading MIDI      MusicXML/MIDI
                \              /
                 \            /
                    Note events
                         |
                    PianoEngine
                         |
                    Audio output
```

Important modules:

- `app/page.tsx` — reader, chapter navigation, and playback controls.
- `lib/harmony/` — chord parsing, progression detection, and voice leading.
- `lib/audio/piano-engine.ts` — shared sampled-piano lifecycle and scheduling.
- `scripts/score_discovery.py` — DOM-aware score candidate discovery.
- `scripts/build_full_score_library.py` — score download, HOMR processing, and manifest export.
- `public/score-audio/manifest.json` — browser-playable score events and download links.

## Tech stack

- Next.js-compatible React application with Vinext/Vite tooling
- TypeScript
- Web Audio API
- [`smplr`](https://github.com/danigb/smplr) and `SplendidGrandPiano`
- MusicXML and MIDI
- [HOMR](https://github.com/Quackone/homr_gui) for supported staff-notation images
- Node.js and Python tooling for extraction and audit scripts

## Local development

Requirements: Node.js 22 or newer. Python is only needed for score-discovery and HOMR preparation scripts.

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

Run the harmony regression tests:

```bash
npm run test:progressions
```

The reader loads the bundled books from `public/books/` and score data from `public/score-audio/`.

## Roadmap

- Improve score-candidate review and coverage reports.
- Add a dedicated numbered-notation transcription path.
- Expand contextual harmony extraction and key tracking.
- Improve automatic voice leading toward educational SATB examples.
- Add more instrument choices and textbook collections.

These items are planned; the current reader should not be interpreted as a complete automatic transcription or harmony-analysis system.

## Contribution

Contributions are welcome in:

- music-theory and harmony parsing,
- score discovery and music information retrieval,
- HOMR/MusicXML post-processing,
- Web Audio and sampler reliability,
- accessible music-education interfaces.

Please keep generated score assets and manifests reproducible, and include focused tests for parser or playback changes.

## License

No project license has been selected yet.

## Vision

> Music theory should not only be read—it should be heard.
