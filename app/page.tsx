'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type AudioExample = {
  id: string;
  label: string;
  source: '谱例' | '正文';
  display: string[];
  chords: string[];
  note?: string;
};

type ScoreEvent = { at: number; duration: number; notes: number[] };

type ScoreResult = {
  id: string;
  key?: string;
  imageSeq?: string;
  bpm: number;
  eventCount: number;
  events: ScoreEvent[];
  midiUrl: string;
  musicXmlUrl: string;
  engine: string;
};

type BookBlock = {
  id: string;
  volume: '基础篇' | '高级篇';
  html: string;
  text: string;
  kind: 'chapter' | 'section' | 'image' | 'text';
  audio: AudioExample[];
  score?: ScoreResult;
};

type SectionPage = {
  id: string;
  title: string;
  chapterTitle: string;
  volume: '基础篇' | '高级篇';
  blocks: BookBlock[];
};

type PlaybackState = { id: string; step: number } | null;
type ReaderFont = 'serif' | 'sans' | 'system';

const READER_FONT_STACKS: Record<ReaderFont, string> = {
  serif: '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
  sans: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
};

function blockAnchor(block: BookBlock) {
  if (block.kind === 'section') {
    const sectionNumber = block.text.match(/^(\d+[-－]\d+)/)?.[1]?.replace('－', '-');
    if (sectionNumber) return `section-${sectionNumber}`;
  }
  return `${block.kind}-${block.id}`;
}

function chapterMarker(title: string) {
  const chineseNumber = title.match(/^第([一二三四五六七八九十]+)章/)?.[1];
  const numbers: Record<string, string> = {
    一: '01', 二: '02', 三: '03', 四: '04', 五: '05', 六: '06', 七: '07', 八: '08', 九: '09', 十: '10',
    十一: '11', 十二: '12', 十三: '13',
  };
  if (chineseNumber) return numbers[chineseNumber] ?? chineseNumber;
  if (title.includes('前言')) return '序';
  if (title.includes('附录')) return '附';
  if (title.includes('自测')) return '测';
  return '•';
}

const NOTE_INDEX: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function normalizeSymbols(value: string) {
  return value.replaceAll('♯', '#').replaceAll('♭', 'b').replaceAll('–', '—')
    .replaceAll('→', '—').replace(/\s+/g, ' ').trim();
}

function chordToMidi(symbol: string): number[] {
  const clean = normalizeSymbols(symbol).replace(/[()]/g, '').replace('Δ', 'maj7');
  const [body, slashBass] = clean.split('/');
  const match = body.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return [48, 52, 55];
  const rootName = match[1];
  const quality = match[2];
  const root = 48 + (NOTE_INDEX[rootName] ?? 0);
  let intervals = [0, 4, 7];
  if (/dim7/.test(quality)) intervals = [0, 3, 6, 9];
  else if (/m7b5|ø/.test(quality)) intervals = [0, 3, 6, 10];
  else if (/dim|°/.test(quality)) intervals = [0, 3, 6];
  else if (/^m(?!aj)/.test(quality)) intervals = [0, 3, 7];
  else if (/\+|aug/.test(quality)) intervals = [0, 4, 8];
  if (intervals.length === 3 && /maj7/.test(quality)) intervals.push(11);
  else if (intervals.length === 3 && /7/.test(quality)) intervals.push(10);
  const notes = intervals.map((interval) => root + interval);
  if (slashBass && NOTE_INDEX[slashBass] !== undefined) {
    let bass = 36 + NOTE_INDEX[slashBass];
    while (bass >= notes[0]) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

function romanTokenToChord(token: string) {
  const clean = normalizeSymbols(token).replace(/[()]/g, '');
  const accidental = clean.match(/^[#b]/)?.[0] ?? '';
  const roman = clean.replace(/^[#b]/, '').match(/^(?:vii|VII|vi|VI|iv|IV|iii|III|ii|II|i|I)/)?.[0] ?? 'I';
  const degreeOffsets: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
  let pitchClass = degreeOffsets[roman.toUpperCase()] ?? 0;
  if (accidental === '#') pitchClass += 1;
  if (accidental === 'b') pitchClass -= 1;
  const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const root = (accidental === 'b' ? flatNames : sharpNames)[(pitchClass + 12) % 12];
  const seventh = /7|Δ/.test(clean);
  if (/ø/.test(clean)) return `${root}m7b5`;
  if (/°/.test(clean)) return `${root}${seventh ? 'dim7' : 'dim'}`;
  if (/\+/.test(clean)) return `${root}aug${seventh ? '7' : ''}`;
  const minor = roman === roman.toLowerCase();
  if (!seventh) return `${root}${minor ? 'm' : ''}`;
  if (/Δ/.test(clean)) return `${root}maj7`;
  return `${root}${minor ? 'm7' : '7'}`;
}

function digitsToProgression(digits: string) {
  const mapping: Record<string, [string, string]> = {
    '1': ['I', 'C'], '2': ['ii', 'Dm'], '3': ['iii', 'Em'], '4': ['IV', 'F'],
    '5': ['V', 'G'], '6': ['vi', 'Am'], '7': ['vii°', 'Bdim'],
  };
  return {
    display: [...digits].map((digit) => mapping[digit][0]),
    chords: [...digits].map((digit) => mapping[digit][1]),
  };
}

function detectTextProgressions(text: string, blockId: string): AudioExample[] {
  const normalized = normalizeSymbols(text);
  const found: AudioExample[] = [];
  const seen = new Set<string>();
  const add = (display: string[], chords: string[], label?: string) => {
    const key = display.join('—');
    if (seen.has(key) || display.length < 2) return;
    seen.add(key);
    found.push({ id: `${blockId}-${found.length}`, label: label ?? `${key}｜正文进行`, source: '正文', display, chords });
  };

  const chordToken = '[A-G](?:#|b)?(?:maj7|m7b5|dim7|m7|dim|m|°7|°|\\+7|\\+|7|Δ)?(?:\\/[A-G](?:#|b)?)?';
  const chordPattern = new RegExp(`(${chordToken}(?:—${chordToken}){1,12})`, 'g');
  if (/和弦|进行|终止|套路|连接|解决|序进/.test(normalized)) {
    for (const match of normalized.matchAll(chordPattern)) {
      const sequence = match[1].split('—');
      add(sequence, sequence);
    }
  }
  const romanToken = '[#b]?(?:vii|VII|vi|VI|iv|IV|iii|III|ii|II|i|I)(?:°|ø|\\+)?(?:\\(?(?:7|Δ)\\)?)?';
  const romanPattern = new RegExp(`(${romanToken}(?:—${romanToken}){1,12})`, 'g');
  for (const match of normalized.matchAll(romanPattern)) {
    const sequence = match[1].split('—');
    add(sequence, sequence.map(romanTokenToChord));
  }
  for (const match of normalized.matchAll(/[“"（(]([1-7]{3,8})[”"）)]/g)) {
    const progression = digitsToProgression(match[1]);
    add(progression.display, progression.chords, `${match[1]}｜正文级数进行`);
  }
  if (normalized.includes('I—V—vi—iii—IV—I—ii或IV—V')) {
    add(['I', 'V', 'vi', 'iii', 'IV', 'I', 'ii', 'V'], ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G'], '卡农进行｜ii 版本');
    add(['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'], '卡农进行｜IV 版本');
  }
  return found.slice(0, 12);
}

function parseBook(source: string, scoreResults: ScoreResult[], volume: '基础篇' | '高级篇'): BookBlock[] {
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const allNodes = [...documentNode.body.children];
  const blocks: BookBlock[] = [];
  const volumeKey = volume === '基础篇' ? 'basic' : 'advanced';
  const scoresById = new Map(scoreResults.map((score) => [score.id, score]));
  const scoresByImage = new Map(scoreResults.filter((score) => score.imageSeq).map((score) => [score.imageSeq as string, score]));
  let pendingScoreNumber: string | null = null;
  let pendingScorePatience = 0;
  let pendingScoreHasImage = false;
  let generatedIndex = 0;

  const addBlock = (node: Element, kindOverride?: BookBlock['kind']) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const className = node.getAttribute('class') ?? '';
    const scoreReference = text.match(/谱例\s*([0-9]+(?:\.[0-9]+)+)/);
    const isScoreCaption = /^谱例\s*[0-9]/.test(text);
    if (scoreReference) {
      pendingScoreNumber = scoreReference[1];
      pendingScorePatience = 3;
      pendingScoreHasImage = false;
    }
    node.querySelectorAll('img').forEach((image) => {
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      image.removeAttribute('width');
      image.removeAttribute('height');
    });
    const kind: BookBlock['kind'] = kindOverride ?? (className.includes('headline-level-1') ? 'chapter'
      : className.includes('headline-level-2') ? 'section' : node.querySelector('img') ? 'image' : 'text');
    const id = `${volumeKey}-block-${generatedIndex++}`;
    const audio = isScoreCaption ? [] : detectTextProgressions(text, id);
    const imageSeq = node.querySelector('img')?.getAttribute('data-seq') ?? undefined;
    const score = kind === 'image' && pendingScoreNumber
      ? (imageSeq ? scoresByImage.get(imageSeq) : undefined) ?? scoresById.get(pendingScoreNumber)
      : undefined;
    blocks.push({ id, volume, html: node.outerHTML, text, kind, audio, score });
    if (pendingScoreNumber && kind === 'image') pendingScoreHasImage = true;
    else if (pendingScoreNumber && !scoreReference && text) {
      pendingScorePatience -= 1;
      if (pendingScoreHasImage || pendingScorePatience <= 0) pendingScoreNumber = null;
    }
  };

  const addSyntheticChapter = (title: string) => {
    const element = documentNode.createElement('p');
    element.className = 'headline headline-level-1';
    element.textContent = title;
    addBlock(element, 'chapter');
  };

  if (volume === '基础篇') {
    allNodes.forEach((node) => {
      if (node.tagName === 'H1') return;
      addBlock(node);
    });
  } else {
    const advancedChapters: Record<string, string> = {
      '11': '第十一章 转调与调性布局',
      '12': '第十二章 调式与民族调性',
      '13': '第十三章 音集与现代调性',
    };
    let activeChapterKey = '';
    allNodes.forEach((node) => {
      if (node.tagName !== 'H1') {
        addBlock(node);
        return;
      }
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text === '下一篇') return;
      const chapterNumber = text.match(/^(\d+)-\d+/)?.[1];
      const chapterKey = chapterNumber ?? `appendix-${text}`;
      if (chapterKey !== activeChapterKey) {
        addSyntheticChapter(chapterNumber ? advancedChapters[chapterNumber] ?? `第${chapterNumber}章` : '附录');
        activeChapterKey = chapterKey;
      }
      addBlock(node, 'section');
    });
  }
  return blocks;
}

function paginateBook(blocks: BookBlock[]): SectionPage[] {
  const pages: SectionPage[] = [];
  let chapterTitle = '';
  let chapterId = '';
  let chapterVolume: SectionPage['volume'] = '基础篇';
  let chapterLead: BookBlock[] = [];
  let currentPage: SectionPage | null = null;

  const finishChapterLead = () => {
    if (chapterLead.length === 0 || !chapterTitle) return;
    pages.push({ id: chapterId, title: chapterTitle, chapterTitle, volume: chapterVolume, blocks: chapterLead });
    chapterLead = [];
  };

  blocks.forEach((block) => {
    if (block.kind === 'chapter') {
      if (currentPage) pages.push(currentPage);
      else finishChapterLead();
      currentPage = null;
      chapterTitle = block.text;
      chapterId = blockAnchor(block);
      chapterVolume = block.volume;
      chapterLead = [];
      return;
    }
    if (block.kind === 'section') {
      if (currentPage) pages.push(currentPage);
      currentPage = {
        id: blockAnchor(block),
        title: block.text,
        chapterTitle,
        volume: block.volume,
        blocks: [...chapterLead, block],
      };
      chapterLead = [];
      return;
    }
    if (currentPage) currentPage.blocks.push(block);
    else chapterLead.push(block);
  });
  if (currentPage) pages.push(currentPage);
  else finishChapterLead();
  return pages;
}

function scheduleNotes(context: AudioContext, destination: AudioNode, midiNotes: number[], start: number, duration: number, nodes: OscillatorNode[]) {
  midiNotes.forEach((midi, noteIndex) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const partials: Array<[OscillatorType, number, number]> = [['sine', 1, 0.075], ['triangle', 2, 0.018], ['sine', 3, 0.008]];
    partials.forEach(([type, multiple, volume]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency * multiple;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume / Math.max(1, noteIndex * 0.15 + 1), start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.94);
      oscillator.connect(gain).connect(destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
      nodes.push(oscillator);
    });
  });
}

function scheduleChord(context: AudioContext, destination: AudioNode, chord: string, start: number, duration: number, nodes: OscillatorNode[]) {
  scheduleNotes(context, destination, chordToMidi(chord), start, duration, nodes);
}

function AudioCard({ example, playback, onPlay, onStop }: {
  example: AudioExample;
  playback: PlaybackState;
  onPlay: (example: AudioExample, tempo: number, loop: boolean) => void;
  onStop: () => void;
}) {
  const [tempo, setTempo] = useState(88);
  const [loop, setLoop] = useState(false);
  const active = playback?.id === example.id;
  return (
    <section className={`audio-card ${active ? 'is-playing' : ''}`} aria-label={example.label}>
      <div className="audio-card-topline">
        <span className={`source-badge ${example.source === '谱例' ? 'score' : ''}`}>{example.source === '谱例' ? '谱例音频' : '正文进行'}</span>
        <span className="audio-label">{example.label}</span>
      </div>
      <div className="audio-controls">
        <button type="button" className="play-button" onClick={() => (active ? onStop() : onPlay(example, tempo, loop))} aria-label={active ? '停止播放' : '播放和弦进行'}>
          <span aria-hidden="true">{active ? '■' : '▶'}</span>{active ? '停止' : '试听'}
        </button>
        <div className="chord-track" aria-label={`和弦：${example.display.join('、')}`}>
          {example.display.map((chord, index) => (
            <span className={`chord-chip ${active && playback.step === index ? 'current' : ''}`} key={`${chord}-${index}`}>{chord}</span>
          ))}
        </div>
      </div>
      <div className="audio-options">
        <label>速度<input type="range" min="56" max="132" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /><output>{tempo} BPM</output></label>
        <label className="loop-option"><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />循环</label>
      </div>
      {example.note && <p className="audio-note">{example.note}</p>}
    </section>
  );
}

function ScoreAudioCard({ score, playback, onPlay, onStop }: {
  score: ScoreResult;
  playback: PlaybackState;
  onPlay: (score: ScoreResult, tempo: number) => void;
  onStop: () => void;
}) {
  const [tempo, setTempo] = useState(score.bpm);
  const playbackKey = score.key ?? score.imageSeq ?? score.id;
  const active = playback?.id === `score-${playbackKey}`;
  const progress = active && score.eventCount > 1
    ? (playback.step / (score.eventCount - 1)) * 100
    : 0;

  return (
    <section className={`score-audio-card ${active ? 'is-playing' : ''}`} aria-label={`谱例 ${score.id} MIDI`}>
      <div className="score-audio-heading">
        <span className="source-badge score">HOMR 识谱</span>
        <strong>谱例 {score.id} · MIDI 播放</strong>
        <span className="verified-dot">已转换</span>
      </div>
      <div className="score-player-row">
        <button type="button" className="play-button" onClick={() => active ? onStop() : onPlay(score, tempo)}>
          <span aria-hidden="true">{active ? '■' : '▶'}</span>{active ? '停止' : '播放原谱'}
        </button>
        <div className="midi-progress" aria-label="播放进度"><span style={{ width: `${progress}%` }} /></div>
        <span className="event-count">{score.eventCount} 个音符事件</span>
      </div>
      <div className="score-meta-row">
        <label>速度<input type="range" min="56" max="132" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /><output>{tempo} BPM</output></label>
        <span className="score-downloads"><a href={score.midiUrl} download>下载 MIDI</a><a href={score.musicXmlUrl} download>MusicXML</a></span>
      </div>
      <p className="score-disclaimer">由 HOMR 从谱例图片自动识别，未用正文和弦替代；正式版仍需逐条听校。</p>
    </section>
  );
}

export default function Home() {
  const [blocks, setBlocks] = useState<BookBlock[]>([]);
  const [loadError, setLoadError] = useState('');
  const [playback, setPlayback] = useState<PlaybackState>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerFont, setReaderFont] = useState<ReaderFont>('serif');
  const [readerFontSize, setReaderFontSize] = useState(16);
  const [readerLineHeight, setReaderLineHeight] = useState(2);
  const [currentSectionId, setCurrentSectionId] = useState('');
  const [settingsReady, setSettingsReady] = useState(false);
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('harmony-reader-settings') ?? '{}') as {
        font?: ReaderFont;
        fontSize?: number;
        lineHeight?: number;
      };
      if (saved.font && READER_FONT_STACKS[saved.font]) setReaderFont(saved.font);
      if (saved.fontSize && saved.fontSize >= 13 && saved.fontSize <= 22) setReaderFontSize(saved.fontSize);
      if (saved.lineHeight && saved.lineHeight >= 1.5 && saved.lineHeight <= 2.5) setReaderLineHeight(saved.lineHeight);
    } catch {
      // Ignore invalid local preferences and retain comfortable defaults.
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-font-family', READER_FONT_STACKS[readerFont]);
    document.documentElement.style.setProperty('--reader-font-size', `${readerFontSize}px`);
    document.documentElement.style.setProperty('--reader-line-height', String(readerLineHeight));
    if (settingsReady) {
      localStorage.setItem('harmony-reader-settings', JSON.stringify({ font: readerFont, fontSize: readerFontSize, lineHeight: readerLineHeight }));
    }
  }, [readerFont, readerFontSize, readerLineHeight, settingsReady]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/books/basic.html').then((response) => {
        if (!response.ok) throw new Error('无法读取基础篇');
        return response.text();
      }),
      fetch('/books/advanced.html').then((response) => {
        if (!response.ok) throw new Error('无法读取高级篇');
        return response.text();
      }),
      fetch('/score-audio/manifest.json').then((response) => {
        if (!response.ok) throw new Error('无法读取谱例音频');
        return response.json() as Promise<{ scores: ScoreResult[] }>;
      }),
    ]).then(([basicSource, advancedSource, manifest]) => setBlocks([
      ...parseBook(basicSource, manifest.scores, '基础篇'),
      ...parseBook(advancedSource, manifest.scores, '高级篇'),
    ]))
      .catch(() => setLoadError('书稿或谱例音频载入失败，请刷新页面重试。'));
  }, []);

  useEffect(() => {
    const updateProgress = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setReadingProgress(scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0);
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    return () => window.removeEventListener('scroll', updateProgress);
  }, []);

  const stop = useCallback(() => {
    stopRef.current();
    stopRef.current = () => undefined;
    setPlayback(null);
  }, []);

  const play = useCallback((example: AudioExample, tempo: number, loop: boolean) => {
    stopRef.current();
    const context = new window.AudioContext();
    const master = context.createGain();
    master.gain.value = 0.88;
    master.connect(context.destination);
    const nodes: OscillatorNode[] = [];
    const timers: number[] = [];
    let cancelled = false;
    const chordDuration = (60 / tempo) * 1.8;
    const runCycle = () => {
      if (cancelled) return;
      const cycleStart = context.currentTime + 0.06;
      example.chords.forEach((chord, index) => {
        scheduleChord(context, master, chord, cycleStart + index * chordDuration, chordDuration, nodes);
        timers.push(window.setTimeout(() => !cancelled && setPlayback({ id: example.id, step: index }), (index * chordDuration + 0.06) * 1000));
      });
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        if (loop) runCycle(); else setPlayback(null);
      }, (example.chords.length * chordDuration + 0.08) * 1000));
    };
    setPlayback({ id: example.id, step: 0 });
    runCycle();
    stopRef.current = () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      nodes.forEach((node) => { try { node.stop(); } catch { /* already finished */ } });
      void context.close();
    };
  }, []);

  const playScore = useCallback((score: ScoreResult, selectedTempo: number) => {
    stopRef.current();
    const context = new window.AudioContext();
    const master = context.createGain();
    master.gain.value = 0.95;
    master.connect(context.destination);
    const nodes: OscillatorNode[] = [];
    const timers: number[] = [];
    let cancelled = false;
    const secondsPerBeat = 60 / selectedTempo;
    const startAt = context.currentTime + 0.06;
    const playbackKey = score.key ?? score.imageSeq ?? score.id;

    score.events.forEach((event, index) => {
      scheduleNotes(
        context,
        master,
        event.notes,
        startAt + event.at * secondsPerBeat,
        Math.max(0.08, event.duration * secondsPerBeat),
        nodes,
      );
      timers.push(window.setTimeout(() => {
        if (!cancelled) setPlayback({ id: `score-${playbackKey}`, step: index });
      }, (event.at * secondsPerBeat + 0.06) * 1000));
    });

    const finalEvent = score.events.at(-1);
    const totalBeats = finalEvent ? finalEvent.at + finalEvent.duration : 0;
    timers.push(window.setTimeout(() => !cancelled && setPlayback(null), (totalBeats * secondsPerBeat + 0.12) * 1000));
    setPlayback({ id: `score-${playbackKey}`, step: 0 });
    stopRef.current = () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      nodes.forEach((node) => { try { node.stop(); } catch { /* already finished */ } });
      void context.close();
    };
  }, []);

  useEffect(() => () => stopRef.current(), []);
  const textAudioCount = blocks.reduce((total, block) => total + block.audio.length, 0);
  const scoreAudioCount = blocks.filter((block) => block.score).length;
  const sectionPages = useMemo(() => paginateBook(blocks), [blocks]);
  const activePageIndex = Math.max(0, sectionPages.findIndex((page) => page.id === currentSectionId));
  const activePage = sectionPages[activePageIndex];
  const previousPage = activePageIndex > 0 ? sectionPages[activePageIndex - 1] : null;
  const nextPage = activePageIndex < sectionPages.length - 1 ? sectionPages[activePageIndex + 1] : null;

  useEffect(() => {
    if (sectionPages.length === 0) return;
    const requestedId = decodeURIComponent(window.location.hash.slice(1));
    setCurrentSectionId((current) => {
      if (sectionPages.some((page) => page.id === current)) return current;
      return sectionPages.find((page) => page.id === requestedId)?.id ?? sectionPages[0].id;
    });
  }, [sectionPages]);

  const goToSection = (sectionId: string) => {
    if (!sectionPages.some((page) => page.id === sectionId)) return;
    stop();
    setCurrentSectionId(sectionId);
    window.history.replaceState(null, '', `#${sectionId}`);
    window.requestAnimationFrame(() => document.getElementById('section-reading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const chapterNavigation: Array<{ id: string; title: string; volume: SectionPage['volume']; sections: Array<{ id: string; title: string }> }> = [];
  sectionPages.forEach((page) => {
    const previousChapter = chapterNavigation.at(-1);
    if (!previousChapter || previousChapter.title !== page.chapterTitle || previousChapter.volume !== page.volume) {
      chapterNavigation.push({ id: page.id, title: page.chapterTitle, volume: page.volume, sections: [] });
    }
    chapterNavigation.at(-1)?.sections.push({ id: page.id, title: page.title });
  });
  const volumeNavigation = (['基础篇', '高级篇'] as const).map((volume) => ({
    volume,
    chapters: chapterNavigation.filter((chapter) => chapter.volume === volume),
    firstPage: sectionPages.find((page) => page.volume === volume),
  }));

  return (
    <div className="site-shell">
      <div className="ambient-scene" aria-hidden="true">
        <span className="floating-cloud cloud-one" />
        <span className="floating-cloud cloud-two" />
        <span className="drifting-leaf leaf-one">⌁</span>
        <span className="drifting-leaf leaf-two">⌁</span>
      </div>
      <div className="reading-progress" style={{ width: `${readingProgress}%` }} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到页首"><span className="brand-mark" aria-hidden="true">♫</span><span><strong>图解和声</strong><small>叶小胖 著</small></span></a>
        <nav aria-label="章节导航">
          {volumeNavigation.map(({ volume, firstPage }) => <a href={`#${firstPage?.id ?? 'top'}`} key={volume} onClick={(event) => { event.preventDefault(); if (firstPage) goToSection(firstPage.id); }}>{volume}</a>)}
        </nav>
        <div className="header-actions"><button className="settings-trigger" type="button" aria-expanded={settingsOpen} aria-controls="reader-settings" onClick={() => setSettingsOpen((value) => !value)}><span>Aa</span> 阅读设置</button><span className="demo-pill">基础篇 · 高级篇</span></div>
      </header>
      {settingsOpen && (
        <section className="reader-settings" id="reader-settings" aria-label="阅读设置">
          <div className="settings-heading"><div><p className="eyebrow">阅读设置</p><h2>让正文更适合你的屏幕</h2></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭阅读设置">×</button></div>
          <div className="font-choice" aria-label="字体风格">
            {([['serif', '宋体'], ['sans', '黑体'], ['system', '系统']] as Array<[ReaderFont, string]>).map(([value, label]) => <button className={readerFont === value ? 'active' : ''} type="button" key={value} onClick={() => setReaderFont(value)}>{label}</button>)}
          </div>
          <label className="setting-slider"><span>正文字号 <output>{readerFontSize}px</output></span><input type="range" min="13" max="22" step="1" value={readerFontSize} onChange={(event) => setReaderFontSize(Number(event.target.value))} /></label>
          <label className="setting-slider"><span>正文行距 <output>{readerLineHeight.toFixed(1)}</output></span><input type="range" min="1.5" max="2.5" step="0.1" value={readerLineHeight} onChange={(event) => setReaderLineHeight(Number(event.target.value))} /></label>
          <div className="settings-preview" aria-live="polite">和声从稳定出发，经过运动与紧张，最终回到新的平衡。</div>
          <button className="settings-reset" type="button" onClick={() => { setReaderFont('serif'); setReaderFontSize(16); setReaderLineHeight(2); }}>恢复默认</button>
        </section>
      )}
      <div className="page-layout" id="top">
        <aside className="chapter-rail">
          <p className="eyebrow">阅读目录</p>
          {volumeNavigation.map(({ volume, chapters }) => <section className="toc-volume" key={volume}><h2>{volume}</h2>{chapters.map((chapter) => (
              <div className="toc-group" key={`${volume}-${chapter.id}`}>
                <a className="toc-chapter" href={`#${chapter.sections[0]?.id ?? chapter.id}`} onClick={(event) => { event.preventDefault(); if (chapter.sections[0]) goToSection(chapter.sections[0].id); }}><span>{chapterMarker(chapter.title)}</span><strong>{chapter.title.replace(/^第.+?章\s*/, '')}</strong></a>
                <div className="toc-sections">
                  {chapter.sections.map((section) => <a className={activePage?.id === section.id ? 'active' : ''} aria-current={activePage?.id === section.id ? 'page' : undefined} href={`#${section.id}`} key={section.id} onClick={(event) => { event.preventDefault(); goToSection(section.id); }}>{section.title}</a>)}
                </div>
              </div>
            ))}</section>)}
        </aside>
        <main className="reader">
          <section className="reader-intro">
            <div className="storybook-landscape" aria-hidden="true">
              <span className="hero-sun" />
              <span className="hero-cloud hero-cloud-one" />
              <span className="hero-cloud hero-cloud-two" />
              <span className="hero-hill hill-back" />
              <span className="hero-hill hill-front" />
              <span className="wind-note note-one">♪</span>
              <span className="wind-note note-two">♫</span>
            </div>
            <p className="eyebrow">叶小胖 著 · 基础篇与高级篇完整听觉阅读</p>
            <h1>图解和声</h1>
            <p className="hero-tagline">翻开书页，让和弦随风响起</p>
            <p className="hero-description">完整收录基础篇与高级篇的书稿原文和插图，并为书中的谱例与明确写出的和声进行补充声音。</p>
            <div className="legend" aria-label="音频标记说明"><span><i className="legend-score" />HOMR 谱例 MIDI</span><span><i className="legend-text" />正文和声进行</span><span><i className="legend-image" />自动识谱待听校</span></div>
          </section>
          <section className="listening-preface" aria-labelledby="listening-preface-title">
            <div className="preface-copy">
              <p className="eyebrow">关于本页的声音</p>
              <h2 id="listening-preface-title">正文不猜，谱图走 OMR</h2>
              <p>和声进行只读取正文中的明确写法；谱例图片由 HOMR 转为 MusicXML 与 MIDI，并保留下载结果供校对。</p>
            </div>
            <div className="preface-count" aria-label={`${textAudioCount + scoreAudioCount} 条可试听内容`}>
              <strong>{textAudioCount + scoreAudioCount || '—'}</strong>
              <span>条可试听内容</span>
              <small>{scoreAudioCount} 个谱例 · {textAudioCount} 条正文进行</small>
            </div>
            {playback && <button className="preface-stop" type="button" onClick={stop}><span>■</span> 停止当前音频</button>}
          </section>
          <details className="mobile-toc">
            <summary>展开完整目录</summary>
            {volumeNavigation.map(({ volume, chapters }) => <section className="mobile-volume" key={volume}><h2>{volume}</h2>{chapters.map((chapter) => (
              <div key={`${volume}-${chapter.id}`}><a className="mobile-chapter-link" href={`#${chapter.sections[0]?.id ?? chapter.id}`} onClick={(event) => { event.preventDefault(); if (chapter.sections[0]) goToSection(chapter.sections[0].id); }}>{chapter.title}</a>{chapter.sections.map((section) => <a className={activePage?.id === section.id ? 'active' : ''} aria-current={activePage?.id === section.id ? 'page' : undefined} href={`#${section.id}`} key={section.id} onClick={(event) => { event.preventDefault(); goToSection(section.id); }}>{section.title}</a>)}</div>
            ))}</section>)}
          </details>
          {loadError && <p className="load-state error">{loadError}</p>}
          {!loadError && blocks.length === 0 && <p className="load-state">正在整理基础篇与高级篇内容…</p>}
          {activePage && (
            <section className="section-reading" id="section-reading" aria-labelledby="current-section-title">
              <header className="section-page-header">
                <div><p>{activePage.volume} · {activePage.chapterTitle}</p><span>第 {activePageIndex + 1} / {sectionPages.length} 节</span></div>
                <h2 id="current-section-title">{activePage.title}</h2>
                <div className="section-progress" aria-label={`全书进度 ${Math.round(((activePageIndex + 1) / sectionPages.length) * 100)}%`}><span style={{ width: `${((activePageIndex + 1) / sectionPages.length) * 100}%` }} /></div>
              </header>
              <article className="book-content" id={activePage.id}>
                {activePage.blocks.filter((block) => block.kind !== 'section').map((block) => (
                  <div className={`book-block book-${block.kind}`} key={block.id}>
                    <div dangerouslySetInnerHTML={{ __html: block.html }} />
                    {block.score && <ScoreAudioCard score={block.score} playback={playback} onPlay={playScore} onStop={stop} />}
                    {block.audio.map((example) => <AudioCard key={example.id} example={example} playback={playback} onPlay={play} onStop={stop} />)}
                  </div>
                ))}
              </article>
              <nav className="section-pagination" aria-label="小节翻页">
                <button type="button" disabled={!previousPage} onClick={() => previousPage && goToSection(previousPage.id)}><small>← 上一节</small><strong>{previousPage?.title ?? '已经是第一节'}</strong></button>
                <button type="button" disabled={!nextPage} onClick={() => nextPage && goToSection(nextPage.id)}><small>下一节 →</small><strong>{nextPage?.title ?? '已读完全书'}</strong></button>
              </nav>
            </section>
          )}
        </main>
      </div>
      <footer><span>《图解和声》· 叶小胖 著 · 基础篇与高级篇听觉阅读</span><a href="#top">回到页首 ↑</a></footer>
    </div>
  );
}
