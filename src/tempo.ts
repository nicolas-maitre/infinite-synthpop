/**
 * A deck's clock: the tempo of each bar and the time each bar starts. A song plays at one tempo,
 * except in DJ mode, where a song mixed in at the outgoing song's tempo glides to its own, one bar
 * at a time (steps of a few hundredths of a BPM, far below what anyone hears). Bars before 0 (a
 * DJ's mix-in intro) play at the starting tempo.
 */

/** How a song's tempo runs: `bpm`, then from `glide.start` a glide to `glide.to` over
 * `glide.bars` bars. */
export interface TempoShape {
  bpm: number;
  glide?: { to: number; start: number; bars: number };
}

export class TempoMap {
  /** Bar seconds through the glide, and the time from the glide's start to each of its bars. */
  private readonly glideSeconds: number[] = [];
  private readonly glideStarts: number[] = [];

  /** `origin`: timeline time where bar 0 starts. */
  constructor(
    readonly origin: number,
    readonly shape: TempoShape,
  ) {
    const g = shape.glide;
    if (g && g.bars > 0 && g.to !== shape.bpm) {
      let t = 0;
      for (let i = 0; i < g.bars; i++) {
        const bpm = shape.bpm + ((g.to - shape.bpm) * (i + 1)) / g.bars;
        this.glideStarts.push(t);
        this.glideSeconds.push(240 / bpm);
        t += 240 / bpm;
      }
      this.glideStarts.push(t);
    }
  }

  /** The clock on which bar `bar` starts at timeline time `at`. */
  static anchored(shape: TempoShape, bar: number, at: number): TempoMap {
    return new TempoMap(at - new TempoMap(0, shape).time(bar), shape);
  }

  /** A clock at one tempo. */
  static steady(bpm: number, bar: number, at: number): TempoMap {
    return TempoMap.anchored({ bpm }, bar, at);
  }

  private get glideStart(): number {
    return this.shape.glide?.start ?? Infinity;
  }

  /** The tempo bar `bar` plays at. */
  bpmAt(bar: number): number {
    const i = bar - this.glideStart;
    const seconds = this.glideSeconds[i];
    if (i >= 0 && seconds !== undefined) return 240 / seconds;
    if (i >= 0 && this.glideSeconds.length) return this.shape.glide!.to;
    return this.shape.bpm;
  }

  barSeconds(bar: number): number {
    return 240 / this.bpmAt(bar);
  }

  /** Timeline time where bar `bar` (a whole number) starts. */
  time(bar: number): number {
    const steady = 240 / this.shape.bpm;
    const start = this.glideStart;
    const n = this.glideSeconds.length;
    if (!n || bar <= start) return this.origin + bar * steady;
    const into = Math.min(bar - start, n);
    const after = bar - start - into;
    return (
      this.origin + start * steady + this.glideStarts[into]! + after * (240 / this.shape.glide!.to)
    );
  }

  /** The bar playing at timeline time `t`, with its fraction (bar 3.5: halfway through bar 3). */
  barAt(t: number): number {
    const steady = 240 / this.shape.bpm;
    const start = this.glideStart;
    const n = this.glideSeconds.length;
    const rel = t - this.origin;
    if (!n || rel <= start * steady) return rel / steady;
    const g = rel - start * steady;
    const total = this.glideStarts[n]!;
    if (g >= total) return start + n + (g - total) / (240 / this.shape.glide!.to);
    // The glide's bar holding `g`.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.glideStarts[mid]! <= g) lo = mid;
      else hi = mid - 1;
    }
    return start + lo + (g - this.glideStarts[lo]!) / this.glideSeconds[lo]!;
  }
}
