'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  bpm: number;
  eventCount: number;
  events: ScoreEvent[];
  midiUrl: string;
  musicXmlUrl: string;
  engine: string;
};

type BookBlock = {
  id: string;
  html: string;
  text: string;
  kind: 'chapter' | 'section' | 'image' | 'text';
  audio: AudioExample[];
  score?: ScoreResult;
};

type PlaybackState = { id: string; step: number } | null;

function blockAnchor(block: BookBlock) {
  if (block.kind === 'chapter') {
    return block.text.startsWith('第一章') ? 'chapter-one' : 'chapter-two';
  }
  if (block.kind === 'section') {
    const sectionNumber = block.text.match(/^(\d+[-－]\d+)/)?.[1]?.replace('－', '-');
    if (sectionNumber) return `section-${sectionNumber}`;
  }
  return block.id;
}

const ROMAN_TO_C: Record<string, string> = {
  I: 'C', i: 'Cm', II: 'D', ii: 'Dm', III: 'E', iii: 'Em',
  IV: 'F', iv: 'Fm', V: 'G', v: 'Gm', VI: 'A', vi: 'Am',
  VII: 'B', vii: 'Bdim', 'vii°': 'Bdim',
};

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
  if (/dim|°/.test(quality)) intervals = [0, 3, 6];
  else if (/^m(?!aj)/.test(quality)) intervals = [0, 3, 7];
  else if (/\+|aug/.test(quality)) intervals = [0, 4, 8];
  if (/maj7/.test(quality)) intervals.push(11);
  else if (/7/.test(quality)) intervals.push(10);
  const notes = intervals.map((interval) => root + interval);
  if (slashBass && NOTE_INDEX[slashBass] !== undefined) {
    let bass = 36 + NOTE_INDEX[slashBass];
    while (bass >= notes[0]) bass -= 12;
    notes.unshift(bass);
  }
  return notes;
}

function romanTokenToChord(token: string) {
  const clean = token.replace(/[()]/g, '');
  const seventh = /7|Δ/.test(clean);
  const roman = clean.replace(/7|Δ/g, '');
  const base = ROMAN_TO_C[roman] ?? 'C';
  if (!seventh) return base;
  if (base === 'G') return 'G7';
  if (base.endsWith('m')) return `${base}7`;
  return `${base}maj7`;
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

  const chordToken = '[A-G](?:#|b)?(?:m|dim|°|\\+)?(?:7|maj7|Δ)?(?:\\/[A-G](?:#|b)?)?';
  const chordPattern = new RegExp(`(${chordToken}(?:—${chordToken}){1,12})`, 'g');
  for (const match of normalized.matchAll(chordPattern)) {
    const sequence = match[1].split('—');
    add(sequence, sequence);
  }
  const romanToken = '(?:vii°|VII°|vii|VII|vi|VI|iv|IV|iii|III|ii|II|i|I)(?:\\(7\\)|7|Δ)?';
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
  return found.slice(0, 6);
}

function parseBook(source: string, scoreResults: ScoreResult[]): BookBlock[] {
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const allNodes = [...documentNode.body.children];
  const firstChapter = allNodes.findIndex((node) => node.textContent?.trim().startsWith('第一章'));
  const thirdChapter = allNodes.findIndex((node) => node.textContent?.trim().startsWith('第三章'));
  const selected = allNodes.slice(firstChapter, thirdChapter);
  const blocks: BookBlock[] = [];
  const scoresById = new Map(scoreResults.map((score) => [score.id, score]));
  let pendingScoreNumber: string | null = null;
  let inSecondChapter = false;
  selected.forEach((node, index) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const className = node.getAttribute('class') ?? '';
    if (text.startsWith('第二章')) inSecondChapter = true;
    const scoreMatch = text.match(/^谱例(2\.[123])/);
    if (scoreMatch) pendingScoreNumber = scoreMatch[1];
    node.querySelectorAll('img').forEach((image) => {
      image.setAttribute('loading', 'lazy');
      image.removeAttribute('width');
      image.removeAttribute('height');
    });
    const kind: BookBlock['kind'] = className.includes('headline-level-1') ? 'chapter'
      : className.includes('headline-level-2') ? 'section' : node.querySelector('img') ? 'image' : 'text';
    const id = `book-block-${index}`;
    const audio = scoreMatch || !inSecondChapter ? [] : detectTextProgressions(text, id);
    const score = kind === 'image' && pendingScoreNumber
      ? scoresById.get(pendingScoreNumber)
      : undefined;
    if (kind === 'image' && pendingScoreNumber) pendingScoreNumber = null;
    blocks.push({ id, html: node.outerHTML, text, kind, audio, score });
  });
  return blocks;
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
  const active = playback?.id === `score-${score.id}`;
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
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    Promise.all([
      fetch('/book-source.html').then((response) => {
        if (!response.ok) throw new Error('无法读取书稿');
        return response.text();
      }),
      fetch('/score-audio/manifest.json').then((response) => {
        if (!response.ok) throw new Error('无法读取谱例音频');
        return response.json() as Promise<{ scores: ScoreResult[] }>;
      }),
    ]).then(([source, manifest]) => setBlocks(parseBook(source, manifest.scores)))
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
        if (!cancelled) setPlayback({ id: `score-${score.id}`, step: index });
      }, (event.at * secondsPerBeat + 0.06) * 1000));
    });

    const finalEvent = score.events.at(-1);
    const totalBeats = finalEvent ? finalEvent.at + finalEvent.duration : 0;
    timers.push(window.setTimeout(() => !cancelled && setPlayback(null), (totalBeats * secondsPerBeat + 0.12) * 1000));
    setPlayback({ id: `score-${score.id}`, step: 0 });
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
  const chapterNavigation: Array<{ id: string; title: string; sections: Array<{ id: string; title: string }> }> = [];
  blocks.forEach((block) => {
    if (block.kind === 'chapter') {
      chapterNavigation.push({ id: blockAnchor(block), title: block.text, sections: [] });
    } else if (block.kind === 'section' && chapterNavigation.length > 0) {
      chapterNavigation.at(-1)?.sections.push({ id: blockAnchor(block), title: block.text });
    }
  });

  return (
    <div className="site-shell">
      <div className="reading-progress" style={{ width: `${readingProgress}%` }} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到页首"><span className="brand-mark" aria-hidden="true">♫</span><span><strong>图解和声</strong><small>听觉阅读 Demo</small></span></a>
        <nav aria-label="章节导航"><a href="#chapter-one">第一章</a><a href="#chapter-two">第二章</a></nav>
        <span className="demo-pill">第一、二章</span>
      </header>
      <div className="page-layout" id="top">
        <aside className="chapter-rail">
          <p className="eyebrow">阅读目录</p>
          {chapterNavigation.map((chapter, chapterIndex) => (
            <div className="toc-group" key={chapter.id}>
              <a className="toc-chapter" href={`#${chapter.id}`}><span>{String(chapterIndex + 1).padStart(2, '0')}</span><strong>{chapter.title.replace(/^第.+?章\s*/, '')}</strong></a>
              <div className="toc-sections">
                {chapter.sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}
              </div>
            </div>
          ))}
          <div className="rail-note"><b>{textAudioCount + scoreAudioCount || '—'}</b><span>条可试听内容</span><small>{scoreAudioCount} 个谱例 · {textAudioCount} 条正文进行</small></div>
        </aside>
        <main className="reader">
          <section className="reader-intro">
            <p className="eyebrow">Harmony you can hear</p>
            <h1>读到和弦，也立刻听见和弦</h1>
            <p>本 Demo 保留书稿原文与插图。橙色卡片是 HOMR 从谱例图片识别得到的 MIDI，蓝色卡片只来自正文中明确写出的和声进行。</p>
            <div className="legend" aria-label="音频标记说明"><span><i className="legend-score" />HOMR 谱例 MIDI</span><span><i className="legend-text" />正文和声进行</span><span><i className="legend-image" />自动识谱待听校</span></div>
          </section>
          <details className="mobile-toc">
            <summary>展开完整目录</summary>
            {chapterNavigation.map((chapter) => (
              <div key={chapter.id}><a className="mobile-chapter-link" href={`#${chapter.id}`}>{chapter.title}</a>{chapter.sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</div>
            ))}
          </details>
          {loadError && <p className="load-state error">{loadError}</p>}
          {!loadError && blocks.length === 0 && <p className="load-state">正在整理第一、二章内容…</p>}
          <article className="book-content">
            {blocks.map((block) => (
              <div className={`book-block book-${block.kind}`} id={blockAnchor(block)} key={block.id}>
                <div dangerouslySetInnerHTML={{ __html: block.html }} />
                {block.score && <ScoreAudioCard score={block.score} playback={playback} onPlay={playScore} onStop={stop} />}
                {block.audio.map((example) => <AudioCard key={example.id} example={example} playback={playback} onPlay={play} onStop={stop} />)}
              </div>
            ))}
          </article>
        </main>
        <aside className="listening-rail">
          <div className="listening-card"><span className="sound-orbit" aria-hidden="true">♪</span><p className="eyebrow">试听规则</p><h2>正文不猜，谱图走 OMR</h2><p>和声进行只读取正文中的明确写法；谱例图片由 HOMR 转为 MusicXML 与 MIDI，并保留下载结果供校对。</p></div>
          {playback && <button className="floating-stop" type="button" onClick={stop}><span>■</span> 停止当前音频</button>}
        </aside>
      </div>
      <footer><span>图解和声 · 第一、二章听觉阅读 Demo</span><a href="#top">回到页首 ↑</a></footer>
    </div>
  );
}
