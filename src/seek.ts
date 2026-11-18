/**
 * Instant seeking in render-ahead playback (ahead.ts): where on the timeline a bar is already
 * rendered, ahead of the speaker or kept behind it, and how much heard audio to keep.
 *
 * A seek re-anchors playback onto a rendered bar, and playback then goes on through whatever the
 * timeline holds after it. So a bar only counts where what follows it is still what should play:
 * - not before the last cut (a jump, a switch, a re-render for a change), heard or pending: going
 *   on from there would play the old timeline again, up to the cut and its jump;
 * - behind the playhead, only within the run of bars the heard one belongs to: one song's bars,
 *   one after the other, back to its start or to the last cut.
 */

/** A bar on the timeline: when it starts, and which song's which bar. */
export interface Mark<S> {
  at: number;
  song: S;
  bar: number;
}

/** Index of the bar heard at `now` (the last to start by then), or -1. */
function heard<S>(marks: readonly Mark<S>[], now: number): number {
  let h = -1;
  for (let i = 0; i < marks.length && marks[i]!.at <= now + 1e-6; i++) h = i;
  return h;
}

function follows<S>(a: Mark<S>, b: Mark<S>): boolean {
  return a.song === b.song && b.bar === a.bar + 1;
}

/** The run of bars around the heard one, [lo, hi] (empty, lo > hi, when none is heard yet). */
function run<S>(marks: readonly Mark<S>[], h: number): [number, number] {
  if (h < 0) return [0, -1];
  let lo = h;
  while (lo > 0 && follows(marks[lo - 1]!, marks[lo]!)) lo--;
  let hi = h;
  while (hi < marks.length - 1 && follows(marks[hi]!, marks[hi + 1]!)) hi++;
  return [lo, hi];
}

/**
 * Where bar `bar` of `song` starts on the timeline, to seek to it from `now`; null when it isn't
 * there to play. `marks` in time order; `from` the earliest a seek may land (the last cut, and
 * the audio kept); `until` how far it is rendered. A bar of the heard run first (the song playing
 * on), else the first one ahead (the song playing again, on repeat).
 */
export function seekTarget<S>(
  marks: readonly Mark<S>[],
  song: S,
  bar: number,
  now: number,
  from: number,
  until: number,
): number | null {
  const ok = (m: Mark<S>) => m.song === song && m.bar === bar && m.at >= from && m.at < until;
  const [lo, hi] = run(marks, heard(marks, now));
  for (let i = lo; i <= hi; i++) if (ok(marks[i]!)) return marks[i]!.at;
  for (let i = hi + 1; i < marks.length; i++) {
    const m = marks[i]!;
    if (m.at > now && ok(m)) return m.at;
  }
  return null;
}

/**
 * From when to keep heard audio, for seeking back: the last `seconds`, but no further back than
 * the heard run's start (the song's, or the last cut's) or the last cut itself, less `margin` for
 * the fade into a bar. Never past `now`: what is ahead is kept as it plays.
 */
export function keepFrom<S>(
  marks: readonly Mark<S>[],
  now: number,
  seconds: number,
  cut: number,
  margin: number,
): number {
  const [lo, hi] = run(marks, heard(marks, now));
  const start = lo <= hi ? marks[lo]!.at : now;
  return Math.min(now, Math.max(now - seconds, start - margin, cut - margin));
}
