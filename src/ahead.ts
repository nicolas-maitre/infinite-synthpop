/**
 * Render-ahead playback. Instead of the synths playing live (where any CPU hiccup breaks the music
 * up), the music is rendered offline ahead of the speaker and the live context only plays the
 * rendered audio back. When rendering falls behind, playback pauses for a few seconds while it
 * catches up, instead of struggling along.
 *
 * The timeline is planned as **pieces**, by the engine (engine.ts `planFrom`): a song's body, then
 * a transition piece where the outgoing and incoming songs play together, then the next song's
 * body, and so on. Each piece is one offline render with a deck (its own `Instruments`) per song in
 * it, so a transition sounds as one mix: the outgoing song's tails ring over the incoming song's
 * first bars. Today a transition is a short handoff (the last bar and the next song's first bars);
 * a DJ mode (two decks overlapping for 16–32 bars) plans longer ones in the same shape.
 *
 * Each piece renders a bar of pre-roll before its start (so notes and echoes from before the join
 * are there) and a bar past its end, and neighbouring pieces crossfade over a few milliseconds at
 * each join. A change cuts the timeline at a bar line: another song or a jump at the next one (or
 * at once), a fader or a setting at the first one the new render can reach in time. The pieces
 * after the cut are dropped, and the rest is planned and rendered again.
 *
 * The render streams out of the offline context as it goes, through an AudioWorklet tap, and
 * suspends every couple of seconds to schedule the next bars (as render.ts does) and to wait while
 * it is more than the buffer ahead of what is heard.
 */
import * as Tone from "tone";
import { arrangeBar, type BarEvents } from "./arranger";
import type { Song } from "./composer";
import type { BassTone, LeadTone } from "./genres";
import { songSound } from "./profile";
import { autoVolumes, Instruments, softClipper, type LeadPatch, type Track } from "./instruments";
import { scheduleBar } from "./schedule";
import type { TempoMap } from "./tempo";

/** The mixer as the renders apply it. */
export interface RenderMix {
  /** Faders set by hand; the others follow each song's own mix (its genre's, at its style). */
  manual: Partial<Record<Track, number>>;
  muted: readonly Track[];
  soloed: readonly Track[];
  leadPatch: LeadPatch;
}

/** The continuous part of a song's sound, which can change from bar to bar: the auto faders
 * (dB, before manual ones), the bass tone and the voice's mix. */
export interface DeckSound {
  volumes: Record<Track, number>;
  bassTone: BassTone;
  leadTone: LeadTone;
}

/** One song in a piece, on its own instruments. */
export interface Deck<M> {
  song: Song;
  /** When each bar starts on the timeline, and its tempo. */
  clock: TempoMap;
  /** The bars it plays in the piece, [from, to). */
  from: number;
  to: number;
  /** The earliest bar it has (a pre-roll goes no further back): 0, or below for a DJ's mix-in
   * intro. */
  first?: number;
  /** What it plays in a bar; the song's own bar by default. A DJ filters the bars around a
   * handoff, and plays a groove before bar 0. */
  arrange?: (bar: number) => BarEvents;
  /** Its sound in a bar, gliding from bar to bar (a DJ's morph); the song's own throughout by
   * default. */
  sound?: (bar: number) => DeckSound;
  /** The bars reported as playing (onBar), [from, to). Overlapping decks report one at a time. */
  shown: [number, number];
  /** The engine's own data about the song (where it came from). */
  meta: M;
}

/** A stretch of the timeline rendered in one go: one song's body, or a transition. */
export interface Piece<M> {
  decks: Deck<M>[];
  /** The timeline span heard, [start, end). */
  start: number;
  end: number;
  /** A DJ transition's name, shown while it plays. */
  label?: string;
  /** The song a DJ transition leads into, while it has no deck of its own yet (a morph). */
  into?: Song;
}

export interface AheadEvents<M> {
  /** The piece that follows this one. */
  plan: (after: Piece<M>) => Piece<M>;
  /** A deck's bar starts being heard, at `time` on the audio clock. */
  onBar: (piece: Piece<M>, deck: Deck<M>, bar: number, time: number) => void;
  /** Playback paused to let the render catch up, or went on again. */
  onBuffering: (buffering: boolean) => void;
}

export interface AheadOptions<M> {
  lite: boolean;
  /** How far ahead of the speaker to render (seconds). */
  window: number;
  mix: RenderMix;
  master: number;
  events: AheadEvents<M>;
}

/** Whether this browser can render ahead (an AudioWorklet to stream the render out). */
export const AHEAD_SUPPORTED = typeof AudioWorkletNode !== "undefined";

/** Half of the crossfade at each join between pieces (seconds). */
const FADE = 0.02;
/** Bars rendered before a piece starts, so what rings into it is there (the longest notes ring
 * about a bar and a half past their bar's start). */
const PREROLL_BARS = 2;
/**
 * Whether a render can suspend to schedule as it goes. Firefox's can't: the whole render is
 * scheduled before it starts, which for a song's body blocks the page for seconds and leaves the
 * render slower than real time under every pending event. There, pieces render in segments of
 * about this long (seconds), joined as pieces are.
 */
const SUSPENDABLE =
  typeof OfflineAudioContext !== "undefined" &&
  typeof OfflineAudioContext.prototype.suspend === "function";
const SEGMENT_SECONDS = 12;
/** Silence before the first event of a render. */
const LEAD = 0.05;
/** Offline seconds scheduled per suspension of the render. */
const WINDOW = 2;
/** How far ahead of the speaker rendered audio is handed to the live context. */
const HORIZON = 1.5;
const PUMP_MS = 100;
/** Below this much audio ready ahead of the speaker, playback pauses (seconds). */
const LOW = 0.25;
/** Audio ready before playback starts, and before it goes on after a pause (at most half the
 * buffer). */
const START_SECONDS = 1.5;
const RESUME_SECONDS = 4;
/** Frames per message from the render's tap (a multiple of the 128-frame render quantum). */
const BATCH = 4096;
const TAP = "synthpop-render-tap";
/** An equal-power fade from 1 to 0. */
const FADE_OUT = Float32Array.from({ length: 32 }, (_, i) => Math.cos(((i / 31) * Math.PI) / 2));

/** The worklet that copies the render out as it goes, in batches, and passes it through. */
const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.end = options.processorOptions.end;
    this.done = false;
    this.fresh();
  }
  fresh() {
    this.l = new Float32Array(${BATCH});
    this.r = new Float32Array(${BATCH});
    this.n = 0;
    this.at = -1;
  }
  process(inputs, outputs) {
    if (this.done) return false;
    const input = inputs[0] || [];
    const l = input[0];
    const r = input[1] || l;
    const out = outputs[0];
    if (l) {
      out[0].set(l);
      if (out[1]) out[1].set(r);
      this.l.set(l, this.n);
      this.r.set(r, this.n);
    }
    if (this.at < 0) this.at = currentFrame;
    this.n += 128;
    const last = currentFrame + 128 >= this.end;
    if (this.n >= ${BATCH} || last) {
      const l = this.n < ${BATCH} ? this.l.slice(0, this.n) : this.l;
      const r = this.n < ${BATCH} ? this.r.slice(0, this.n) : this.r;
      this.port.postMessage({ frame: this.at, l, r, last }, [l.buffer, r.buffer]);
      this.fresh();
      this.done = last;
    }
    return true;
  }
}
registerProcessor("${TAP}", Tap);
`;
let tapUrl: string | null = null;

/** A piece being rendered and played. */
interface Live<M> {
  /** What this renders: the planned piece, or a segment of it. */
  piece: Piece<M>;
  /** The planned piece (the engine knows it by identity). */
  owner: Piece<M>;
  /** Timeline time of the render's frame 0 (on the frame grid). */
  t0: number;
  /** Rendered audio, by frame. */
  chunks: { frame: number; l: Float32Array; r: Float32Array }[];
  /** Frames received without a gap from frame 0. */
  received: number;
  started: boolean;
  complete: boolean;
  dropped: boolean;
  /** Frame up to which it was handed to the live context. */
  cursor: number;
  /** Bars reported as playing: [timeline time, deck, bar], in time order; the next to report. */
  bars: [number, Deck<M>, number][];
  nextBar: number;
  /** Wakes the render loop when the piece is dropped or complete. */
  settle: () => void;
  settled: Promise<void>;
  /** For a piece wanted at once (the first, or after a cut): when its render began (ms), until
   * it had enough to play, to measure how long a fresh render takes to get going. */
  timing: number | null;
}

interface Source {
  node: AudioBufferSourceNode;
  gain: GainNode;
  /** Timeline span. */
  from: number;
  to: number;
  /** Already fading out (a cut). */
  fading: boolean;
}

export class AheadPlayer<M> {
  readonly fft = new Tone.Analyser("fft", 256);
  readonly waveform = new Tone.Analyser("waveform", 1024);
  private readonly output = new Tone.Volume(0);
  private readonly ctx = Tone.getContext().rawContext as unknown as AudioContext;
  private readonly rate = this.ctx.sampleRate;
  private pieces: Live<M>[] = [];
  private last: Piece<M> | null = null;
  private sources: Source[] = [];
  private timers: { at: number; id: ReturnType<typeof setTimeout> }[] = [];
  private gates: { at: number; open: () => void }[] = [];
  private running = false;
  private generation = 0;
  private buffering = true;
  /** Where playback paused (timeline), and whether it has played yet. */
  private stallAt = 0;
  private played = false;
  /** Timeline time `anchorT` plays at `anchorCtx` on the audio clock. */
  private anchorT = 0;
  private anchorCtx = 0;
  /** A fade-in to apply at this timeline time (after a pause). */
  private fadeInAt: number | null = null;
  /** The last cut: a pause right there is the change still rendering, not the render falling
   * behind, so it goes on as soon as a start would. */
  private cutAt = -Infinity;
  private quickResume = true;
  /** Seconds a fresh render takes to have enough to play (measured; a guess until then). */
  private startup = 2;
  private window: number;
  private mix: RenderMix;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: AheadOptions<M>) {
    this.window = options.window;
    this.mix = options.mix;
    this.output.volume.value = options.master;
    this.output.fan(this.fft, this.waveform);
    this.output.toDestination();
  }

  /** Starts playing from this piece. */
  start(first: Piece<M>): void {
    this.running = true;
    this.stallAt = this.anchorT = this.snap(first.start);
    this.anchorCtx = this.ctx.currentTime;
    this.add(first, true).timing = 0;
    this.options.events.onBuffering(true);
    void this.renderLoop(this.generation);
    this.pump();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    for (const t of this.timers) clearTimeout(t.id);
    this.timers = [];
    for (const s of this.sources) {
      stopSource(s.node);
      s.node.disconnect();
    }
    this.sources = [];
    for (const p of this.pieces) this.drop(p);
    this.pieces = [];
    for (const g of this.gates) g.open();
    this.gates = [];
    const output = this.output;
    // Let the analysers fall quiet with the music before they go.
    setTimeout(() => {
      output.dispose();
      this.fft.dispose();
      this.waveform.dispose();
    }, 200);
  }

  setMaster(db: number): void {
    this.output.volume.value = db;
  }

  setWindow(seconds: number): void {
    this.window = seconds;
  }

  setMix(mix: RenderMix): void {
    this.mix = mix;
  }

  /** The timeline time heard now. */
  playhead(): number {
    const t = this.anchorT + (this.ctx.currentTime - this.anchorCtx);
    return this.buffering ? Math.min(this.stallAt, t) : t;
  }

  /**
   * The earliest a change can take over without a pause: far enough ahead for a fresh render to
   * get going (as measured), with some slack.
   */
  readyAfter(): number {
    return this.playhead() + Math.min(this.window / 2, this.startup * 1.25 + 0.25);
  }

  /** Seconds rendered ahead of what is heard. */
  ahead(): number {
    return Math.max(0, this.available() - this.playhead());
  }

  get isBuffering(): boolean {
    return this.buffering;
  }

  /**
   * The first bar line heard at or after `time`, of the deck shown there: where a change can
   * take over. Null when nothing is planned there.
   */
  barLineAfter(time: number): { time: number; deck: Deck<M>; bar: number } | null {
    let best: { time: number; deck: Deck<M>; bar: number } | null = null;
    for (const { piece } of this.pieces) {
      if (piece.end <= time) continue;
      for (const deck of piece.decks) {
        const bar = Math.max(deck.shown[0], Math.ceil(deck.clock.barAt(time) - 1e-6));
        const at = deck.clock.time(bar);
        if (bar >= deck.shown[1] || at >= piece.end || at < piece.start) continue;
        if (!best || at < best.time) best = { time: at, deck, bar };
      }
    }
    return best;
  }

  /**
   * Replaces everything heard from `time` on with `next` (which starts there): what plays now
   * fades out over a few milliseconds at `time`, and the timeline after is planned again.
   */
  cut(time: number, next: Piece<M>): void {
    time = this.snap(time);
    // In place: the engine knows the piece by identity (a cued switch).
    next.start = time;
    for (const t of this.timers.filter((t) => t.at >= time - 1e-6)) clearTimeout(t.id);
    this.timers = this.timers.filter((t) => t.at < time - 1e-6);
    const fadeFrom = this.ctxTime(time - FADE);
    const fadeTo = this.ctxTime(time + FADE);
    for (const s of this.sources) {
      if (s.to <= time - FADE) continue;
      if (s.from >= time + FADE) {
        stopSource(s.node);
        continue;
      }
      // Equal power, as the next piece fades in.
      const g = s.gain.gain;
      const from = Math.max(this.ctx.currentTime + 0.005, fadeFrom);
      if (from >= fadeTo) {
        stopSource(s.node);
        continue;
      }
      g.cancelScheduledValues(0);
      g.setValueCurveAtTime(FADE_OUT, from, fadeTo - from);
      s.fading = true;
      stopSource(s.node, fadeTo);
    }
    for (const p of this.pieces) {
      if (p.piece.start >= time) this.drop(p);
      else if (p.piece.end > time) {
        p.piece.end = time;
        p.owner.end = Math.min(p.owner.end, time);
        p.bars = p.bars.filter(([at]) => at < time);
        p.nextBar = Math.min(p.nextBar, p.bars.length);
        this.checkComplete(p);
      }
    }
    this.pieces = this.pieces.filter((p) => !p.dropped);
    this.add(next, false).timing = 0;
    this.cutAt = time;
    this.generation++;
    void this.renderLoop(this.generation);
  }

  // ── Planning and rendering ────────────────────────────────────────────────────────────────

  /** Adds a planned piece, in segments where renders can't suspend; returns its first part. */
  private add(piece: Piece<M>, first: boolean): Live<M> {
    const parts = SUSPENDABLE ? [piece] : this.segments(piece);
    const head = this.addPart(parts[0]!, piece, first);
    for (const part of parts.slice(1)) this.addPart(part, piece, false);
    this.last = piece;
    return head;
  }

  /** A one-song piece cut at its bar lines into segments of about SEGMENT_SECONDS. */
  private segments(piece: Piece<M>): Piece<M>[] {
    const deck = piece.decks[0];
    if (piece.decks.length !== 1 || !deck) return [piece];
    const { clock } = deck;
    const every = Math.max(1, Math.round(SEGMENT_SECONDS / clock.barSeconds(deck.from)));
    const parts: Piece<M>[] = [];
    let start = piece.start;
    let bar = Math.ceil(clock.barAt(start) - 1e-6) + every;
    // The last segment takes up to one and a half segments, rather than leaving a sliver.
    while (clock.barAt(piece.end) - 1e-6 > bar + every / 2) {
      const end = this.snap(clock.time(bar));
      parts.push({ decks: piece.decks, start, end });
      start = end;
      bar += every;
    }
    parts.push({ decks: piece.decks, start, end: piece.end });
    return parts;
  }

  private addPart(piece: Piece<M>, owner: Piece<M>, first: boolean): Live<M> {
    const events = renderEvents(piece);
    const t0 = this.snap(Math.min(events[0]?.[0] ?? piece.start, piece.start - FADE) - LEAD);
    const bars: Live<M>["bars"] = [];
    for (const deck of piece.decks) {
      for (
        let bar = Math.max(deck.from, deck.shown[0]);
        bar < Math.min(deck.to, deck.shown[1]);
        bar++
      ) {
        const at = deck.clock.time(bar);
        if (at >= piece.start - 1e-6 && at < piece.end) bars.push([at, deck, bar]);
      }
    }
    bars.sort((a, b) => a[0] - b[0]);
    let settle = () => {};
    const settled = new Promise<void>((done) => (settle = done));
    const live: Live<M> = {
      piece,
      owner,
      t0,
      chunks: [],
      received: 0,
      started: false,
      complete: false,
      dropped: false,
      // The very first piece starts where it starts; later ones fade in across their join.
      cursor: Math.max(
        0,
        Math.round(((first ? piece.start : piece.start - FADE) - t0) * this.rate),
      ),
      bars,
      nextBar: 0,
      settle,
      settled,
      timing: null,
    };
    this.pieces.push(live);
    return live;
  }

  private drop(p: Live<M>): void {
    p.dropped = true;
    p.chunks = [];
    p.settle();
  }

  private checkComplete(p: Live<M>): void {
    if (p.complete) return;
    if (p.t0 + p.received / this.rate >= p.piece.end + FADE) {
      p.complete = true;
      p.settle();
    }
  }

  /** Renders the pieces one after the other, planning the next as each one is under way. */
  private async renderLoop(generation: number): Promise<void> {
    while (this.running && generation === this.generation) {
      const p = this.pieces.find((q) => !q.started && !q.dropped);
      if (!p) {
        const after = this.last;
        if (!after) return;
        this.add(this.options.events.plan(after), false);
        continue;
      }
      p.started = true;
      // Don't build the next piece's instruments before it is due within the buffer.
      await this.gate(p.t0);
      if (!this.running || generation !== this.generation || p.dropped) {
        // A cut while waiting: render this one when the new loop gets to it.
        if (!p.dropped) p.started = false;
        return;
      }
      if (p.timing !== null) p.timing = performance.now();
      const render = renderPiece(p.piece, p.t0, this.mix, this.rate, this.options.lite, {
        chunk: (frame, l, r, last) => this.receive(p, frame, l, r, last),
        gate: (offline) => this.gate(p.t0 + offline),
        alive: () => this.running && !p.dropped && !p.complete,
      }).catch((error: unknown) => {
        console.error("Couldn't render ahead", error);
        // Skip what couldn't be rendered rather than waiting for it forever.
        p.received = Math.ceil((p.piece.end + FADE - p.t0) * this.rate);
        this.checkComplete(p);
      });
      await Promise.race([render, p.settled]);
      if (!p.complete && !p.dropped) {
        // The render finished without its last frames arriving yet: give them a moment.
        await Promise.race([p.settled, new Promise((done) => setTimeout(done, 500))]);
        if (!p.complete && !p.dropped) {
          p.received = Math.ceil((p.piece.end + FADE - p.t0) * this.rate);
          this.checkComplete(p);
        }
      }
    }
  }

  private receive(
    p: Live<M>,
    frame: number,
    l: Float32Array,
    r: Float32Array,
    last: boolean,
  ): void {
    if (p.dropped) return;
    p.chunks.push({ frame, l, r });
    if (frame <= p.received) p.received = Math.max(p.received, frame + l.length);
    if (last) p.received = Math.max(p.received, Math.ceil((p.piece.end + FADE - p.t0) * this.rate));
    this.checkComplete(p);
  }

  /** Resolves once rendering up to `time` (timeline) stays within the buffer. */
  private gate(time: number): Promise<void> {
    if (!this.running || time - this.playhead() <= this.window) return Promise.resolve();
    return new Promise((open) => this.gates.push({ at: time, open }));
  }

  // ── Playing ───────────────────────────────────────────────────────────────────────────────

  /** The timeline is rendered without a gap up to here. */
  private available(): number {
    let until = Infinity;
    for (const p of this.pieces) {
      if (p.complete || p.dropped) continue;
      until = Math.min(until, Math.max(p.piece.start - FADE, p.t0 + p.received / this.rate));
    }
    return until;
  }

  private readonly pump = (): void => {
    if (!this.running) return;
    try {
      this.step();
    } catch (error) {
      // Logged, and the pump keeps going: a stopped pump would leave playback silent for good.
      console.error("Render-ahead playback hiccup", error);
    }
    this.pumpTimer = setTimeout(this.pump, PUMP_MS);
  };

  private step(): void {
    const now = this.ctx.currentTime;
    const available = this.available();
    this.measure();
    if (this.buffering) {
      const need = Math.min(this.quickResume ? START_SECONDS : RESUME_SECONDS, this.window / 2);
      if (available - this.stallAt >= need) {
        this.anchorCtx = Math.max(now + 0.05, this.ctxTime(this.stallAt));
        this.anchorT = this.stallAt;
        if (this.played) this.fadeInAt = this.stallAt;
        this.buffering = false;
        this.played = true;
        this.options.events.onBuffering(false);
      }
    }
    if (!this.buffering) {
      const playhead = this.playhead();
      this.schedule(Math.min(available, playhead + HORIZON));
      if (available - playhead < LOW) this.pause(available);
    }
    const playhead = this.playhead();
    const open = this.gates.filter((g) => g.at - playhead <= this.window);
    this.gates = this.gates.filter((g) => g.at - playhead > this.window);
    for (const g of open) g.open();
    this.forget(playhead);
  }

  /** The render fell behind: what is scheduled plays out (fading at the end), then silence. */
  private pause(at: number): void {
    this.buffering = true;
    this.stallAt = at;
    this.quickResume = Math.abs(at - this.cutAt) < 0.5;
    const fadeFrom = this.ctxTime(at - 0.03);
    for (const s of this.sources) {
      if (s.fading || s.to <= at - 0.03 || s.from >= at) continue;
      s.fading = true;
      s.gain.gain.setValueAtTime(1, Math.max(this.ctx.currentTime, fadeFrom));
      s.gain.gain.linearRampToValueAtTime(
        0,
        Math.max(this.ctx.currentTime + 0.01, this.ctxTime(at)),
      );
    }
    this.options.events.onBuffering(true);
  }

  /** Hands the rendered audio up to `until` (timeline) to the live context, and its bars to the
   * engine. */
  private schedule(until: number): void {
    for (const p of this.pieces) {
      if (p.dropped) continue;
      const { piece, owner } = p;
      const endFrame = Math.min(
        Math.round((until - p.t0) * this.rate),
        Math.round((piece.end + FADE - p.t0) * this.rate),
      );
      // Not in slivers: at least a 20th of a second, unless the piece ends there.
      const finalFrame = Math.round((piece.end + FADE - p.t0) * this.rate);
      if (endFrame - p.cursor < this.rate / 20 && endFrame < finalFrame) continue;
      if (endFrame > p.cursor) {
        this.play(p, p.cursor, endFrame);
        p.cursor = endFrame;
      }
      while (p.nextBar < p.bars.length) {
        const [at, deck, bar] = p.bars[p.nextBar]!;
        if (at >= until) break;
        p.nextBar++;
        const time = this.ctxTime(at);
        const id = setTimeout(
          () => {
            this.timers = this.timers.filter((t) => t.id !== id);
            this.options.events.onBar(owner, deck, bar, time);
          },
          Math.max(0, (time - this.ctx.currentTime) * 1000),
        );
        this.timers.push({ at, id });
      }
    }
  }

  /** Plays frames [from, to) of a piece's render, with its fades baked in. */
  private play(p: Live<M>, from: number, to: number): void {
    const frames = to - from;
    const buffer = this.ctx.createBuffer(2, frames, this.rate);
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    for (const c of p.chunks) {
      const a = Math.max(from, c.frame);
      const b = Math.min(to, c.frame + c.l.length);
      if (b <= a) continue;
      l.set(c.l.subarray(a - c.frame, b - c.frame), a - from);
      r.set(c.r.subarray(a - c.frame, b - c.frame), a - from);
    }
    const { start, end } = p.piece;
    const fromT = p.t0 + from / this.rate;
    const toT = p.t0 + to / this.rate;
    if (fromT < start + FADE || toT > end - FADE) {
      for (let i = 0; i < frames; i++) {
        const t = fromT + i / this.rate;
        const g =
          equalPower((t - (start - FADE)) / (2 * FADE)) * equalPower((end + FADE - t) / (2 * FADE));
        l[i] = (l[i] ?? 0) * g;
        r[i] = (r[i] ?? 0) * g;
      }
    }
    buffer.copyToChannel(l, 0);
    buffer.copyToChannel(r, 1);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    const gain = this.ctx.createGain();
    node.connect(gain);
    Tone.connect(gain, this.output);
    const at = this.ctxTime(fromT);
    if (this.fadeInAt !== null && fromT <= this.fadeInAt + 1e-6 && toT > this.fadeInAt) {
      gain.gain.setValueAtTime(0, this.ctxTime(this.fadeInAt));
      gain.gain.linearRampToValueAtTime(1, this.ctxTime(this.fadeInAt + 0.03));
    }
    const source: Source = { node, gain, from: fromT, to: toT, fading: false };
    node.onended = () => {
      gain.disconnect();
      this.sources = this.sources.filter((s) => s !== source);
    };
    // A source due in the past (a late pump) starts at once, that far into its audio.
    const now = this.ctx.currentTime;
    node.start(Math.max(now, at), Math.max(0, now - at));
    this.sources.push(source);
  }

  /** How long the pieces wanted at once took to have enough to play. */
  private measure(): void {
    for (const p of this.pieces) {
      if (!p.timing) continue;
      if (p.dropped) p.timing = null;
      else if (p.t0 + p.received / this.rate >= p.piece.start + START_SECONDS) {
        const took = (performance.now() - p.timing) / 1000;
        this.startup = (this.startup + took) / 2;
        p.timing = null;
      }
    }
  }

  /** Frees the audio already heard, and the pieces done with. */
  private forget(playhead: number): void {
    if (this.fadeInAt !== null && playhead > this.fadeInAt + 0.1) this.fadeInAt = null;
    for (const p of this.pieces) {
      const heard = Math.round((playhead - 1 - p.t0) * this.rate);
      p.chunks = p.chunks.filter((c) => c.frame + c.l.length > Math.min(heard, p.cursor));
    }
    this.pieces = this.pieces.filter(
      (p) => !(p.complete && p.piece.end + FADE < playhead - 1 && p.nextBar >= p.bars.length),
    );
  }

  private ctxTime(timeline: number): number {
    return this.anchorCtx + (timeline - this.anchorT);
  }

  /** Onto the frame grid, so pieces and their buffers line up sample for sample. */
  private snap(time: number): number {
    return Math.round(time * this.rate) / this.rate;
  }
}

function stopSource(node: AudioBufferSourceNode, when?: number): void {
  try {
    node.stop(when);
  } catch {
    // Stopped already (some browsers allow it once).
  }
}

function equalPower(x: number): number {
  return x >= 1 ? 1 : x <= 0 ? 0 : Math.sin((x * Math.PI) / 2);
}

/** The bars a piece's render schedules (with pre-roll and a bar past the end): [timeline time,
 * deck, bar], in time order. A segment renders only the bars around its own span. */
function renderEvents<M>(piece: Piece<M>): [number, Deck<M>, number][] {
  const events: [number, Deck<M>, number][] = [];
  for (const deck of piece.decks) {
    const { clock } = deck;
    const first = Math.floor(clock.barAt(piece.start) + 1e-6);
    const last = Math.ceil(clock.barAt(piece.end) - 1e-6);
    const from = Math.max(deck.first ?? 0, Math.max(deck.from, first) - PREROLL_BARS);
    const to = Math.min(deck.song.totalBars, Math.min(deck.to, last) + 1);
    for (let bar = from; bar < to; bar++) events.push([clock.time(bar), deck, bar]);
  }
  return events.sort((a, b) => a[0] - b[0]);
}

interface RenderSink {
  /** Rendered audio from `frame` on. `last`: the render's final batch. */
  chunk: (frame: number, l: Float32Array, r: Float32Array, last: boolean) => void;
  /** Resolves when the render may go on past `offline` seconds. */
  gate: (offline: number) => Promise<void>;
  /** False once the render isn't wanted any more. */
  alive: () => boolean;
}

/**
 * Renders a piece offline, streaming it to `sink`. As render.ts's renderSong: a native
 * OfflineAudioContext suspended every few seconds to schedule what comes next (Chrome's render slows
 * down with every pending automation event), with Tone's clock ticked ahead by hand. Browsers
 * without OfflineAudioContext.suspend() (Firefox) render pieces in short segments (`add`), each
 * scheduled up front a bar at a time, through the standardized-audio-context wrapper.
 */
async function renderPiece<M>(
  piece: Piece<M>,
  t0: number,
  mix: RenderMix,
  sampleRate: number,
  lite: boolean,
  sink: RenderSink,
): Promise<void> {
  const seconds = piece.end + FADE + 0.05 - t0;
  const frames = Math.ceil(seconds * sampleRate);
  const suspendable = typeof OfflineAudioContext.prototype.suspend === "function";
  const raw = suspendable ? new OfflineAudioContext(2, frames, sampleRate) : null;
  const context = raw
    ? new Tone.OfflineContext(raw)
    : new Tone.OfflineContext(2, frames / sampleRate, sampleRate);
  const clock = context as unknown as { _currentTime: number };
  const tickTo = (time: number) => {
    while (clock._currentTime < time) {
      context.emit("tick");
      clock._currentTime += 128 / context.sampleRate;
    }
  };

  // The render's output, tapped on its way to the destination.
  tapUrl ??= URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
  const tapOptions = {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit" as const,
    processorOptions: { end: frames },
  };
  let tap: AudioWorkletNode;
  if (raw) {
    await raw.audioWorklet.addModule(tapUrl);
    tap = new AudioWorkletNode(raw, TAP, tapOptions);
  } else {
    // On the wrapped context itself, not through Tone's addAudioWorkletModule: Tone loads one
    // module per context, whatever the URL, so its own worklets (the guitar's comb filters) would
    // never load.
    const wrapped = context.rawContext as unknown as { audioWorklet: AudioWorklet };
    await wrapped.audioWorklet.addModule(tapUrl);
    tap = context.createAudioWorkletNode(TAP, tapOptions) as unknown as AudioWorkletNode;
  }
  tap.port.onmessage = (
    e: MessageEvent<{ frame: number; l: Float32Array; r: Float32Array; last: boolean }>,
  ) => {
    sink.chunk(e.data.frame, e.data.l, e.data.r, e.data.last);
  };
  // A deck per song, built while the offline context is Tone's global (synchronously: the page's
  // own engine keeps using the global context meanwhile). Two decks' sum gets the master's soft
  // clipper again, as each deck's own peaks reach just under full scale.
  const original = Tone.getContext();
  const decks = new Map<Deck<M>, Instruments>();
  Tone.setContext(context);
  try {
    if (piece.decks.length > 1) context.destination.chain(...softClipper(lite), tap);
    else context.destination.chain(tap);
    for (const deck of piece.decks) decks.set(deck, Instruments.create({ lite }));
  } finally {
    Tone.setContext(original);
  }
  for (const [deck, inst] of decks) {
    await inst.ready;
    await inst.drums.loadAll();
    setUpDeck(inst, deck.song, deck.clock.bpmAt(deck.from), mix);
    if (deck.sound) applySound(inst, deck.sound(deck.from), mix, null);
  }

  const events = renderEvents(piece);
  let next = 0;
  const scheduleUntil = (offline: number) => {
    for (; next < events.length; next++) {
      const [at, deck, bar] = events[next]!;
      if (at - t0 >= offline) break;
      const inst = decks.get(deck);
      const ev = deck.arrange ? deck.arrange(bar) : arrangeBar(deck.song, bar);
      if (inst && deck.sound) applySound(inst, deck.sound(bar), mix, at - t0);
      if (inst) scheduleBar(inst, ev, at - t0, deck.clock.bpmAt(bar));
    }
    tickTo(offline);
  };

  if (!raw) {
    // A bar at a time, letting the page breathe in between: the whole segment up front, as this
    // render can't suspend. To its end, not Infinity, which tickTo would never reach.
    for (const [at] of events) {
      if (!sink.alive()) return;
      scheduleUntil(at - t0 + 1e-6);
      await new Promise((go) => setTimeout(go, 0));
    }
    scheduleUntil(seconds);
    await (context.rawContext as unknown as OfflineAudioContext).startRendering();
    return;
  }
  scheduleUntil(WINDOW);
  for (let w = WINDOW; w < seconds; w += WINDOW) {
    void raw.suspend(w - 0.25).then(async () => {
      if (!sink.alive()) return; // Left suspended: dropped with the context.
      await sink.gate(w - 0.25);
      if (!sink.alive()) return;
      scheduleUntil(w + WINDOW);
      void raw.resume();
    });
  }
  await raw.startRendering();
}

/**
 * Dev only: renders consecutive pieces offline through the same path as playback, joined at their
 * starts, as one stereo buffer from the first piece's start (for listening checks of DJ
 * transitions, silently).
 */
export async function renderPiecesOffline<M>(
  pieces: readonly Piece<M>[],
  mix: RenderMix,
  sampleRate: number,
): Promise<{ l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer> }> {
  const first = pieces[0];
  const last = pieces.at(-1);
  if (!first || !last) return { l: new Float32Array(0), r: new Float32Array(0) };
  const frames = Math.ceil((last.end - first.start) * sampleRate);
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (const piece of pieces) {
    const events = renderEvents(piece);
    const t0 = Math.min(events[0]?.[0] ?? piece.start, piece.start - FADE) - LEAD;
    const from = Math.round((piece.start - first.start) * sampleRate);
    const to = Math.round((piece.end - first.start) * sampleRate);
    await renderPiece(piece, t0, mix, sampleRate, false, {
      chunk: (frame, cl, cr) => {
        for (let i = 0; i < cl.length; i++) {
          const at = Math.round((t0 - first.start) * sampleRate) + frame + i;
          if (at < from || at >= to) continue;
          l[at] = cl[i] ?? 0;
          r[at] = cr[i] ?? 0;
        }
      },
      gate: () => Promise.resolve(),
      alive: () => true,
    });
  }
  return { l, r };
}

/** A bar's sound on a deck: the tones at once (the steps of a glide are small), the auto faders
 * ramping to theirs by the bar's start (or set now, with `at` null). Faders set by hand and muted
 * tracks keep theirs. */
function applySound(inst: Instruments, sound: DeckSound, mix: RenderMix, at: number | null): void {
  inst.setBassTone(sound.bassTone);
  inst.setLeadTone(sound.leadTone);
  for (const [track, db] of Object.entries(sound.volumes) as [Track, number][]) {
    if (track in mix.manual || mix.muted.includes(track)) continue;
    const volume = inst.channels[track].volume;
    if (at === null) volume.value = db;
    else volume.linearRampToValueAtTime(db, at);
  }
}

/** Points a deck's instruments at its song, with the mixer applied (as engine.ts applySong). */
function setUpDeck(inst: Instruments, song: Song, bpm: number, mix: RenderMix): void {
  const kit = song.kit !== "synth" && !inst.drums.hasSamples(song.kit) ? "synth" : song.kit;
  inst.drums.use(kit);
  const sound = songSound(song);
  inst.setBassTone(sound.bassTone);
  inst.setLeadTone(sound.leadTone);
  inst.setSnareGate(sound.drums.gatedSnare);
  inst.drums.setKickWeight(sound.drums.kickWeight ?? 0);
  inst.setVoices(sound.voices);
  inst.setTempo(bpm);
  inst.setLeadPatch(mix.leadPatch);
  for (const track of mix.soloed) inst.channels[track].solo = true;
  const volumes = { ...autoVolumes(sound.mix), ...mix.manual };
  for (const [track, db] of Object.entries(volumes) as [Track, number][]) {
    inst.channels[track].volume.value = db;
  }
  // After the levels: setting a channel's volume unmutes it.
  for (const track of mix.muted) inst.channels[track].mute = true;
}
