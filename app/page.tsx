'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pianoEngine, type PianoEngineStatus } from '../lib/audio/piano-engine';
import {
  extractAbsoluteProgressions,
  extractRomanProgressions,
  normalizeProgressionSymbols,
} from '../lib/harmony/progression-detector';
import {
  describeChord,
  NOTE_INDEX,
} from '../lib/harmony/chord-parser';
import { progressionToMidi } from '../lib/harmony/voice-leading';

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

const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function publicAsset(path: string): string {
  if (!path.startsWith('/')) return path;
  return `${PUBLIC_BASE}${path}`;
}

function prefixBookAssets(source: string): string {
  if (!PUBLIC_BASE) return source;
  return source.replace(/\b(src|href)="\//g, `$1="${PUBLIC_BASE}/`);
}
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

function normalizeSymbols(value: string) {
  return normalizeProgressionSymbols(value);
}

type HarmonyContext = { tonic: string; mode: 'major' | 'minor' };

type RomanAst = {
  display: string;
  degree: number;
  accidental: number;
  quality: 'major' | 'minor' | 'diminished' | 'half-diminished' | 'augmented';
  extension?: string;
  inversion?: number;
  secondaryOf?: RomanAst;
};

function detectHarmonyContext(text: string, fallback: HarmonyContext = { tonic: 'C', mode: 'major' }): HarmonyContext {
  const match = text.match(/([A-Ga-g](?:#|b|♯|♭)?)\s*(大调|小调|major|minor|maj|moll)/);
  if (!match) return fallback;
  const tonic = normalizeSymbols(match[1]).replace(/^([a-g])$/, (_, letter: string) => letter.toUpperCase());
  return { tonic, mode: /小调|minor|moll/.test(match[2]) ? 'minor' : 'major' };
}

function pitchName(pitchClass: number, preferFlats: boolean) {
  const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return (preferFlats ? flatNames : sharpNames)[(pitchClass + 120) % 12];
}

function parseRomanAst(token: string): RomanAst {
  const clean = normalizeSymbols(token).replace(/[()\s]/g, '');
  if (/^(?:[#b]?)(?:v|V|iv|IV|iii|III|ii|II|i|I|vi|VI|vii|VII)(?:[°ø+]?\d{0,2})?(?:\/(?:[#b]?)(?:v|V|iv|IV|iii|III|ii|II|i|I|vi|VI|vii|VII))?$/.test(clean)) {
    const expanded = clean.match(/^([#b]?)(vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I)(?:(°|ø|\+)?(\d{1,2})?|Δ)?(?:\/([#b]?)(vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I))?$/);
    if (expanded) {
      const [, accidentalSymbol, roman, mark, extension, secondaryAccidental, secondaryRoman] = expanded;
      const degreeMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
      const degree = degreeMap[roman.toUpperCase()] ?? 1;
      const accidental = accidentalSymbol === '#' ? 1 : accidentalSymbol === 'b' ? -1 : 0;
      const quality = mark === '°' ? 'diminished' : mark === 'ø' ? 'half-diminished' : mark === '+' ? 'augmented' : roman === roman.toLowerCase() ? 'minor' : 'major';
      const inversion = extension === '6' ? 1 : extension === '64' ? 2 : extension === '65' ? 1 : extension === '43' ? 2 : extension === '42' ? 3 : undefined;
      const ast: RomanAst = { display: clean, degree, accidental, quality, extension, inversion };
      if (secondaryRoman) ast.secondaryOf = parseRomanAst(`${secondaryAccidental ?? ''}${secondaryRoman}`);
      return ast;
    }
  }
  const special = clean.match(/^(?:([#b]?)(Ger|Gr|Fr|It)\+6|([#b]?)N6|k46)$/i);
  if (special) {
    const symbol = special[2] ? `${special[1] ?? ''}${special[2]}+6` : special[3] !== undefined ? `${special[3]}N6` : 'k46';
    return { display: symbol, degree: special[2] ? 6 : 2, accidental: -1, quality: special[2] ? 'augmented' : 'major', inversion: 1 };
  }
  const match = clean.match(/^([#b]?)(vii|VII|vi|VI|iv|IV|iii|III|ii|II|i|I)(?:(°|ø|\+)?(\d{1,2})?|Δ)?(?:\/([#b]?)(vii|VII|vi|VI|iii|III|ii|II|i|I))?$/);
  if (!match) return { display: clean || 'I', degree: 1, accidental: 0, quality: 'major' };
  const [, accidentalSymbol, roman, mark, extension, secondaryAccidental, secondaryRoman] = match;
  const degreeMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
  const degree = degreeMap[roman.toUpperCase()] ?? 1;
  const accidental = accidentalSymbol === '#' ? 1 : accidentalSymbol === 'b' ? -1 : 0;
  const quality = mark === '°' ? 'diminished' : mark === 'ø' ? 'half-diminished' : mark === '+' ? 'augmented' : roman === roman.toLowerCase() ? 'minor' : 'major';
  const inversion = extension === '6' ? 1 : extension === '64' ? 2 : extension === '65' ? 1 : extension === '43' ? 2 : extension === '42' ? 3 : undefined;
  const ast: RomanAst = { display: clean, degree, accidental, quality, extension, inversion };
  if (secondaryRoman) ast.secondaryOf = parseRomanAst(`${secondaryAccidental ?? ''}${secondaryRoman}`);
  return ast;
}

function romanAstToChord(ast: RomanAst, context: HarmonyContext, baseContext = context): string {
  if (/^(?:[#b]?)(Ger|Gr|Fr|It)\+6$/i.test(ast.display)) {
    const flatSix = pitchName((NOTE_INDEX[context.tonic] ?? 0) + 8, true);
    return `${flatSix}7`;
  }
  if (/^k46$/i.test(ast.display)) {
    const tonicPitch = NOTE_INDEX[context.tonic] ?? 0;
    const fifth = pitchName(tonicPitch + 7, /b|♭/.test(context.tonic));
    return `${context.tonic}/${fifth}`;
  }
  if (/^[#b]?N6$/i.test(ast.display)) {
    const root = pitchName((NOTE_INDEX[context.tonic] ?? 0) + (context.mode === 'minor' ? 1 : 1), true);
    return `${root}/${pitchName((NOTE_INDEX[context.tonic] ?? 0) + 5, true)}`;
  }
  const scale = baseContext.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const targetRoot = ast.secondaryOf ? romanAstToChord(ast.secondaryOf, context, baseContext).match(/^[A-G](?:#|b)?/)?.[0] : context.tonic;
  const targetPitch = NOTE_INDEX[targetRoot ?? context.tonic] ?? 0;
  const pitchClass = targetPitch + scale[ast.degree - 1] + ast.accidental;
  const root = pitchName(pitchClass, ast.accidental < 0 || /b|♭/.test(context.tonic));
  const seventh = Boolean(ast.extension && /7|Δ/.test(ast.extension));
  const suffix = ast.quality === 'diminished' ? (seventh ? 'dim7' : 'dim')
    : ast.quality === 'half-diminished' ? 'm7b5'
      : ast.quality === 'augmented' ? `aug${seventh ? '7' : ''}`
        : ast.quality === 'minor' ? (seventh ? 'm7' : 'm')
          : ast.extension === 'Δ' ? 'maj7' : seventh ? '7' : '';
  if (ast.inversion) {
    const intervals = ast.quality === 'minor' ? [0, 3, 7] : [0, 4, 7];
    const bassInterval = ast.inversion === 1 ? intervals[1] : ast.inversion === 2 ? intervals[2] : 10;
    return `${root}${suffix}/${pitchName(pitchClass + bassInterval, /b|♭/.test(root))}`;
  }
  return `${root}${suffix}`;
}

function romanTokenToChord(token: string, context: HarmonyContext) {
  return romanAstToChord(parseRomanAst(token), context);
}

function digitsToProgression(digits: string, context: HarmonyContext) {
  const cleanDigits = digits.replace(/[\s—-]/g, '').replaceAll('♭', 'b').replaceAll('♯', '#');
  const labels = context.mode === 'minor' ? ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'VII'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  return {
    display: [...cleanDigits].map((digit) => labels[Number(digit) - 1]).filter(Boolean),
    chords: [...cleanDigits].map((digit) => romanTokenToChord(labels[Number(digit) - 1] ?? 'I', context)).filter(Boolean),
  };
}

function detectTextProgressions(text: string, blockId: string, emphasis: string[] = [], inheritedContext?: HarmonyContext): AudioExample[] {
  const normalized = normalizeSymbols(text);
  const context = detectHarmonyContext(normalized, inheritedContext);
  const found: AudioExample[] = [];
  const seen = new Set<string>();
  const add = (display: string[], chords: string[], label?: string) => {
    const key = `${display.join('—')}|${chords.join('—')}`;
    if (seen.has(key) || display.length < 2 || chords.length < 2) return;
    seen.add(key);
    found.push({ id: `${blockId}-${found.length}`, label: label ?? `${display.join('—')}｜正文进行`, source: '正文', display, chords });
  };
  const sources = [...emphasis, normalized];
  const progressionContext = /进行|终止|套路|序进|连接|循环|演奏|弹奏/.test(normalized);
  for (const [sourceIndex, source] of sources.entries()) {
    for (const sequence of extractAbsoluteProgressions(source)) {
      add(sequence, sequence, `${sequence.join('—')}｜正文和弦进行`);
    }
    for (const sequence of extractRomanProgressions(source)) {
      add(sequence, sequence.map((token) => romanTokenToChord(token, context)), `${sequence.join('—')}｜正文级数进行`);
    }
    for (const match of source.matchAll(/[“"（(]((?:[1-7](?:\s*[-—]\s*[b#]?[1-7]){2,12})|[1-7]{3,12})[”"）)]/g)) {
      if (sourceIndex === sources.length - 1 && !progressionContext) continue;
      const progression = digitsToProgression(match[1], context);
      add(progression.display, progression.chords, `${match[1]}｜正文级数进行`);
    }
  }
  if (/属七和弦[^。；，,]{0,16}(?:解决|进入)[^。；，,]{0,12}(?:主和弦|主音)/.test(normalized)) {
    add(['V7', 'I'], [romanTokenToChord('V7', context), romanTokenToChord('I', context)], '属到主｜正文语义进行');
  }
  if (/下属和弦[^。；，,]{0,16}(?:进入|到|接)[^。；，,]{0,8}属和弦/.test(normalized) && /主和弦|主音/.test(normalized)) {
    add(['IV', 'V', 'I'], ['IV', 'V7', 'I'].map((token) => romanTokenToChord(token, context)), '下属—属—主｜正文语义进行');
  }
  if (normalized.includes('I—V—vi—iii—IV—I—ii或IV—V')) {
    add(['I', 'V', 'vi', 'iii', 'IV', 'I', 'ii', 'V'], ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G'], '卡农进行｜ii 版本');
    add(['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'], '卡农进行｜IV 版本');
  }
  return found.slice(0, 16);
}

function parseBook(source: string, scoreResults: ScoreResult[], volume: '基础篇' | '高级篇'): BookBlock[] {
  const documentNode = new DOMParser().parseFromString(prefixBookAssets(source), 'text/html');
  const allNodes = [...documentNode.body.children];
  const blocks: BookBlock[] = [];
  const volumeKey = volume === '基础篇' ? 'basic' : 'advanced';
  const scoresById = new Map(scoreResults.map((score) => [score.id, score]));
  const scoresByImage = new Map(scoreResults.filter((score) => score.imageSeq).map((score) => [score.imageSeq as string, score]));
  let pendingScoreNumber: string | null = null;
  let pendingScorePatience = 0;
  let pendingScoreHasImage = false;
  let generatedIndex = 0;
  let inheritedHarmonyContext: HarmonyContext = { tonic: 'C', mode: 'major' };

  const addBlock = (node: Element, kindOverride?: BookBlock['kind']) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const className = node.getAttribute('class') ?? '';
    if (className.includes('headline-level-5')) {
      node.setAttribute('role', 'heading');
      node.setAttribute('aria-level', '3');
    } else if (className.includes('headline-level-6')) {
      node.setAttribute('role', 'heading');
      node.setAttribute('aria-level', '4');
    }
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
    const emphasis = [...node.querySelectorAll('i, em, strong, b')]
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);
    const audio = isScoreCaption ? [] : detectTextProgressions(text, id, emphasis, inheritedHarmonyContext);
    const explicitContext = text.match(/([A-Ga-g](?:#|b|♯|♭)?)\s*(大调|小调|major|minor|maj|moll)/);
    if (explicitContext) inheritedHarmonyContext = detectHarmonyContext(explicitContext[0], inheritedHarmonyContext);
    const imageSeq = node.querySelector('img')?.getAttribute('data-seq') ?? undefined;
    const score = kind === 'image'
      ? (imageSeq ? scoresByImage.get(imageSeq) : undefined)
        ?? (pendingScoreNumber ? scoresById.get(pendingScoreNumber) : undefined)
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
        <span className="score-downloads"><a href={publicAsset(score.midiUrl)} download>下载 MIDI</a><a href={publicAsset(score.musicXmlUrl)} download>MusicXML</a></span>
      </div>
      <p className="score-disclaimer">由 HOMR 从谱例图片自动识别，未用正文和弦替代；正式版仍需逐条听校。</p>
    </section>
  );
}

export default function Home() {
  const [blocks, setBlocks] = useState<BookBlock[]>([]);
  const [loadError, setLoadError] = useState('');
  const [playback, setPlayback] = useState<PlaybackState>(null);
  const [audioStatus, setAudioStatus] = useState<PianoEngineStatus>('idle');
  const [audioError, setAudioError] = useState('');
  const [readingProgress, setReadingProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [readerFont, setReaderFont] = useState<ReaderFont>('serif');
  const [readerFontSize, setReaderFontSize] = useState(16);
  const [readerLineHeight, setReaderLineHeight] = useState(2);
  const [currentSectionId, setCurrentSectionId] = useState('');
  const [settingsReady, setSettingsReady] = useState(false);
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
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setMobileTocOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (!mobileTocOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      document.querySelector('.mobile-toc-drawer a.active')?.scrollIntoView({ block: 'center' });
    });
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileTocOpen]);

  useEffect(() => {
    Promise.all([
      fetch(publicAsset('/books/basic.html')).then((response) => {
        if (!response.ok) throw new Error('无法读取基础篇');
        return response.text();
      }),
      fetch(publicAsset('/books/advanced.html')).then((response) => {
        if (!response.ok) throw new Error('无法读取高级篇');
        return response.text();
      }),
      fetch(publicAsset('/score-audio/manifest.json')).then((response) => {
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
    pianoEngine.stop();
    setPlayback(null);
    setAudioStatus((status) => status === 'loading' ? 'idle' : status);
  }, []);

  const play = useCallback(async (example: AudioExample, tempo: number, loop: boolean) => {
    stop();
    setAudioError('');
    setAudioStatus('loading');
    setPlayback({ id: example.id, step: 0 });
    try {
      const notes = progressionToMidi(example.chords);
      if (process.env.NODE_ENV === 'development') {
        console.groupCollapsed(`[Harmony Audio] ${example.display.join('—')}`);
        example.chords.forEach((symbol, index) => {
          const description = describeChord(symbol);
          console.log(
            `${example.display[index] ?? symbol}${index < example.chords.length - 1 ? ' →' : ''}`,
            `Canonical: ${description?.canonical ?? symbol}`,
            `Notes: ${description?.notes.join(' ') ?? ''}`,
            'MIDI:',
            notes[index],
          );
        });
        console.groupEnd();
      }
      await pianoEngine.playProgression(
        notes,
        tempo,
        loop,
        {
          onStep: (step) => setPlayback({ id: example.id, step }),
          onEnd: () => setPlayback(null),
          onStatus: setAudioStatus,
        },
      );
      setAudioStatus('ready');
    } catch {
      setPlayback(null);
      setAudioStatus('error');
      setAudioError('钢琴音色加载失败，请重试。');
    }
  }, [stop]);

  const playScore = useCallback(async (score: ScoreResult, selectedTempo: number) => {
    stop();
    setAudioError('');
    setAudioStatus('loading');
    const playbackKey = score.key ?? score.imageSeq ?? score.id;
    setPlayback({ id: `score-${playbackKey}`, step: 0 });
    try {
      await pianoEngine.playEvents(score.events, selectedTempo, {
        onStep: (step) => setPlayback({ id: `score-${playbackKey}`, step }),
        onEnd: () => setPlayback(null),
        onStatus: setAudioStatus,
      });
      setAudioStatus('ready');
    } catch {
      setPlayback(null);
      setAudioStatus('error');
      setAudioError('钢琴音色加载失败，请重试。');
    }
  }, [stop]);

  useEffect(() => () => pianoEngine.dispose(), []);
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
    setMobileTocOpen(false);
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
      <button className="mobile-toc-trigger" type="button" aria-expanded={mobileTocOpen} aria-controls="mobile-toc-drawer" onClick={() => { setSettingsOpen(false); setMobileTocOpen(true); }}><span aria-hidden="true">目</span>目录</button>
      {mobileTocOpen && (
        <>
          <button className="mobile-toc-backdrop" type="button" aria-label="关闭目录" onClick={() => setMobileTocOpen(false)} />
          <aside className="mobile-toc-drawer" id="mobile-toc-drawer" role="dialog" aria-modal="true" aria-label="阅读目录">
            <header><div><small>阅读目录</small><strong>{activePage?.title ?? '图解和声'}</strong></div><button type="button" aria-label="关闭目录" onClick={() => setMobileTocOpen(false)}>×</button></header>
            <nav aria-label="完整章节目录">
              {volumeNavigation.map(({ volume, chapters }) => <section className="drawer-volume" key={volume}><h2>{volume}</h2>{chapters.map((chapter) => (
                <div className="drawer-chapter" key={`${volume}-${chapter.id}`}>
                  <a className="drawer-chapter-link" href={`#${chapter.sections[0]?.id ?? chapter.id}`} onClick={(event) => { event.preventDefault(); if (chapter.sections[0]) goToSection(chapter.sections[0].id); }}>{chapter.title}</a>
                  {chapter.sections.map((section) => <a className={activePage?.id === section.id ? 'active' : ''} aria-current={activePage?.id === section.id ? 'page' : undefined} href={`#${section.id}`} key={section.id} onClick={(event) => { event.preventDefault(); goToSection(section.id); }}>{section.title}</a>)}
                </div>
              ))}</section>)}
            </nav>
          </aside>
        </>
      )}
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
          <section className="reader-intro reader-cover">
            <h1>图解和声</h1>
            <p className="cover-author">叶小胖 著</p>
          </section>
          {(audioStatus === 'loading' || audioStatus === 'error') && <p className={`load-state ${audioStatus === 'error' ? 'error' : ''}`} role="status" aria-live="polite">{audioStatus === 'loading' ? '正在加载钢琴音色…' : audioError}</p>}
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
