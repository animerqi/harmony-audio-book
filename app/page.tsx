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

type BookBlock = {
  id: string;
  html: string;
  text: string;
  kind: 'chapter' | 'section' | 'image' | 'text';
  audio: AudioExample[];
};

type PlaybackState = { id: string; step: number } | null;

const SCORE_EXAMPLES: Record<string, Omit<AudioExample, 'id'>> = {
  '2.1': {
    label: '《生日快乐》C 大调｜正文和声骨架',
    source: '谱例',
    display: ['C', 'G', 'C', 'G', 'C', 'F', 'C', 'G', 'C'],
    chords: ['C', 'G', 'C', 'G', 'C', 'F', 'C', 'G', 'C'],
    note: '不识别图片旋律；依据紧随谱例的正文说明，播放简化和声骨架。',
  },
  '2.2': {
    label: '《生日快乐》G 大调｜移调和声骨架',
    source: '谱例',
    display: ['G', 'D', 'G', 'D', 'G', 'C', 'G', 'D', 'G'],
    chords: ['G', 'D', 'G', 'D', 'G', 'C', 'G', 'D', 'G'],
    note: '按谱例标题的 G 大调，将正文中的基础和声骨架移调示范。',
  },
  '2.3': {
    label: '《送别》F 大调｜正三和弦示范',
    source: '谱例',
    display: ['F', 'C', 'F', 'B♭', 'F', 'C', 'F'],
    chords: ['F', 'C', 'F', 'Bb', 'F', 'C', 'F'],
    note: '正文要求使用 F 大调正三和弦；这里演示一条简化骨架，不读取图片旋律。',
  },
};

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

function parseBook(source: string): BookBlock[] {
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const allNodes = [...documentNode.body.children];
  const firstChapter = allNodes.findIndex((node) => node.textContent?.trim().startsWith('第一章'));
  const thirdChapter = allNodes.findIndex((node) => node.textContent?.trim().startsWith('第三章'));
  const selected = allNodes.slice(firstChapter, thirdChapter);
  const blocks: BookBlock[] = [];
  let pendingScore: { number: string; audio: Omit<AudioExample, 'id'> } | null = null;
  let inSecondChapter = false;
  selected.forEach((node, index) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const className = node.getAttribute('class') ?? '';
    if (text.startsWith('第二章')) inSecondChapter = true;
    const scoreMatch = text.match(/^谱例(2\.[123])/);
    if (scoreMatch && SCORE_EXAMPLES[scoreMatch[1]]) {
      pendingScore = { number: scoreMatch[1], audio: SCORE_EXAMPLES[scoreMatch[1]] };
    }
    node.querySelectorAll('img').forEach((image) => {
      image.setAttribute('loading', 'lazy');
      image.removeAttribute('width');
      image.removeAttribute('height');
    });
    const kind: BookBlock['kind'] = className.includes('headline-level-1') ? 'chapter'
      : className.includes('headline-level-2') ? 'section' : node.querySelector('img') ? 'image' : 'text';
    const id = `book-block-${index}`;
    const audio = scoreMatch || !inSecondChapter ? [] : detectTextProgressions(text, id);
    if (kind === 'image' && pendingScore) {
      audio.unshift({ ...pendingScore.audio, id: `score-${pendingScore.number}` });
      pendingScore = null;
    }
    blocks.push({ id, html: node.outerHTML, text, kind, audio });
  });
  return blocks;
}

function scheduleChord(context: AudioContext, destination: AudioNode, chord: string, start: number, duration: number, nodes: OscillatorNode[]) {
  chordToMidi(chord).forEach((midi, noteIndex) => {
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

export default function Home() {
  const [blocks, setBlocks] = useState<BookBlock[]>([]);
  const [loadError, setLoadError] = useState('');
  const [playback, setPlayback] = useState<PlaybackState>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    fetch('/book-source.html').then((response) => {
      if (!response.ok) throw new Error('无法读取书稿');
      return response.text();
    }).then((source) => setBlocks(parseBook(source))).catch(() => setLoadError('书稿载入失败，请刷新页面重试。'));
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

  useEffect(() => () => stopRef.current(), []);
  const audioCount = blocks.reduce((total, block) => total + block.audio.length, 0);

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
          <a href="#chapter-one"><span>01</span>循环与网格图</a>
          <a href="#chapter-two"><span>02</span>大调和声</a>
          <div className="rail-note"><b>{audioCount || '—'}</b><span>条可试听内容</span><small>谱例 + 正文进行</small></div>
        </aside>
        <main className="reader">
          <section className="reader-intro">
            <p className="eyebrow">Harmony you can hear</p>
            <h1>读到和弦，也立刻听见和弦</h1>
            <p>本 Demo 保留书稿原文与插图。橙色卡片来自谱例，蓝色卡片来自正文中明确写出的和声进行；点击即可试听。</p>
            <div className="legend" aria-label="音频标记说明"><span><i className="legend-score" />谱例音频</span><span><i className="legend-text" />正文进行</span><span><i className="legend-image" />原图不做内容识别</span></div>
          </section>
          {loadError && <p className="load-state error">{loadError}</p>}
          {!loadError && blocks.length === 0 && <p className="load-state">正在整理第一、二章内容…</p>}
          <article className="book-content">
            {blocks.map((block) => (
              <div className={`book-block book-${block.kind}`} id={block.kind === 'chapter' ? block.text.startsWith('第一章') ? 'chapter-one' : 'chapter-two' : block.id} key={block.id}>
                <div dangerouslySetInnerHTML={{ __html: block.html }} />
                {block.audio.map((example) => <AudioCard key={example.id} example={example} playback={playback} onPlay={play} onStop={stop} />)}
              </div>
            ))}
          </article>
        </main>
        <aside className="listening-rail">
          <div className="listening-card"><span className="sound-orbit" aria-hidden="true">♪</span><p className="eyebrow">试听规则</p><h2>正文优先，谱图不猜</h2><p>谱例只采用标题与相邻正文能确认的和声骨架，不读取图片内的旋律和配器细节。</p></div>
          {playback && <button className="floating-stop" type="button" onClick={stop}><span>■</span> 停止当前音频</button>}
        </aside>
      </div>
      <footer><span>图解和声 · 第一、二章听觉阅读 Demo</span><a href="#top">回到页首 ↑</a></footer>
    </div>
  );
}
