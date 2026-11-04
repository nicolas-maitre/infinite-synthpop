/**
 * Hands a bar's events to the synths: all at once (offline renders), or one 16th at a time (live
 * playback, so an instant switch only has the clock's look-ahead left to cut).
 */
import { MELODIC_TRACKS, type BarEvents } from "./arranger";
import type { Instruments } from "./instruments";

/** The part of Instruments scheduling uses. */
export type Player = Pick<Instruments, "drum" | "play">;

/** Schedules every event of one bar starting at `time` (seconds on the audio clock). */
export function scheduleBar(inst: Player, ev: BarEvents, time: number, bpm: number): void {
  const sixteenth = 60 / bpm / 4;
  for (const hit of ev.drums) inst.drum(hit, time + hit.step * sixteenth);
  for (const track of MELODIC_TRACKS) inst.play(track, ev.notes[track], time, sixteenth);
}

/** Which 16th of the bar an event starting at `step` belongs to. */
export function stepSlot(step: number): number {
  return Math.min(15, Math.max(0, Math.floor(step)));
}

/**
 * Schedules the events of one bar that start in its 16th number `slot`, which begins at `time`.
 * Played for slots 0–15 in turn, it schedules the same notes as scheduleBar.
 */
export function scheduleStep(
  inst: Player,
  ev: BarEvents,
  time: number,
  sixteenth: number,
  slot: number,
): void {
  const barTime = time - slot * sixteenth;
  for (const hit of ev.drums)
    if (stepSlot(hit.step) === slot) inst.drum(hit, barTime + hit.step * sixteenth);
  for (const track of MELODIC_TRACKS) {
    const notes = ev.notes[track].filter((n) => stepSlot(n.step) === slot);
    if (notes.length) inst.play(track, notes, barTime, sixteenth);
  }
}
