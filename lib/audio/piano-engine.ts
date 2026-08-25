import { SplendidGrandPiano } from 'smplr';

export type PianoEngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PianoEvent = {
  at: number;
  duration: number;
  notes: number[];
  velocity?: number;
};

type PianoCallbacks = {
  onStep?: (step: number) => void;
  onEnd?: () => void;
  onStatus?: (status: PianoEngineStatus) => void;
};

type PianoInstance = ReturnType<typeof SplendidGrandPiano>;

const DEFAULT_VELOCITY = 82;

function getAudioContextConstructor() {
  const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? browserWindow.webkitAudioContext;
}

function clampVelocity(value: number | undefined) {
  return Math.max(1, Math.min(127, Math.round(value ?? DEFAULT_VELOCITY)));
}

/** Shared browser-side piano sampler for both prose progressions and HOMR events. */
export class PianoEngine {
  private context: AudioContext | null = null;
  private piano: PianoInstance | null = null;
  private loading: Promise<void> | null = null;
  private timers = new Set<number>();
  private generation = 0;
  private status: PianoEngineStatus = 'idle';

  private setStatus(status: PianoEngineStatus, callback?: PianoCallbacks['onStatus']) {
    this.status = status;
    callback?.(status);
  }

  private clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
  }

  private timer(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, Math.max(0, delay));
    this.timers.add(timer);
  }

  private async ensureReady(callback?: PianoCallbacks['onStatus']) {
    if (this.piano && this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    if (this.loading) {
      await this.loading;
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) throw new Error('当前浏览器不支持 Web Audio');
    this.context = new AudioContextConstructor();
    this.setStatus('loading', callback);
    this.loading = (async () => {
      try {
        this.piano = SplendidGrandPiano(this.context as AudioContext, {
          velocity: DEFAULT_VELOCITY,
          volume: 92,
          onLoadProgress: () => undefined,
        });
        await this.piano.ready;
        if (this.context?.state === 'suspended') await this.context.resume();
        this.setStatus('ready', callback);
      } catch (error) {
        this.piano?.dispose();
        this.piano = null;
        this.setStatus('error', callback);
        throw error;
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
  }

  getStatus() {
    return this.status;
  }

  stop() {
    this.generation += 1;
    this.clearTimers();
    this.piano?.stop();
  }

  async playProgression(
    chords: number[][],
    tempo: number,
    loop: boolean,
    callbacks: PianoCallbacks = {},
  ) {
    this.stop();
    const run = this.generation;
    try {
      await this.ensureReady(callbacks.onStatus);
    } catch (error) {
      if (run === this.generation) callbacks.onEnd?.();
      throw error;
    }
    if (!this.piano || !this.context || run !== this.generation) return;

    const chordDuration = (60 / Math.max(1, tempo)) * 1.8;
    const cycleDuration = chords.length * chordDuration;
    const scheduleCycle = () => {
      if (!this.piano || !this.context || run !== this.generation) return;
      const cycleStart = this.context.currentTime + 0.06;
      chords.forEach((notes, index) => {
        const start = cycleStart + index * chordDuration;
        notes.forEach((note) => {
          this.piano?.start({
            note,
            velocity: DEFAULT_VELOCITY,
            time: start,
            duration: Math.max(0.08, chordDuration * 0.94),
          });
        });
        this.timer(() => {
          if (run === this.generation) callbacks.onStep?.(index);
        }, (index * chordDuration + 0.06) * 1000);
      });
      this.timer(() => {
        if (run !== this.generation) return;
        if (loop) scheduleCycle();
        else callbacks.onEnd?.();
      }, (cycleDuration + 0.08) * 1000);
    };
    scheduleCycle();
  }

  async playEvents(events: PianoEvent[], tempo: number, callbacks: PianoCallbacks = {}) {
    this.stop();
    const run = this.generation;
    try {
      await this.ensureReady(callbacks.onStatus);
    } catch (error) {
      if (run === this.generation) callbacks.onEnd?.();
      throw error;
    }
    if (!this.piano || !this.context || run !== this.generation) return;

    const secondsPerBeat = 60 / Math.max(1, tempo);
    const startAt = this.context.currentTime + 0.06;
    events.forEach((event, index) => {
      const start = startAt + event.at * secondsPerBeat;
      event.notes.forEach((note) => {
        this.piano?.start({
          note,
          velocity: clampVelocity(event.velocity),
          time: start,
          duration: Math.max(0.08, event.duration * secondsPerBeat),
        });
      });
      this.timer(() => {
        if (run === this.generation) callbacks.onStep?.(index);
      }, (event.at * secondsPerBeat + 0.06) * 1000);
    });

    const finalEvent = events.at(-1);
    const totalBeats = finalEvent ? finalEvent.at + finalEvent.duration : 0;
    this.timer(() => {
      if (run === this.generation) callbacks.onEnd?.();
    }, (totalBeats * secondsPerBeat + 0.12) * 1000);
  }

  dispose() {
    this.stop();
    this.piano?.dispose();
    this.piano = null;
    const context = this.context;
    this.context = null;
    this.status = 'idle';
    if (context && context.state !== 'closed') void context.close();
  }
}

export const pianoEngine = new PianoEngine();
