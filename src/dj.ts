/**
 * DJ mode (docs/plans/dj-mode.md): each song plays long enough to give its gist, then mixes into
 * the next one. Pure planning, no audio: where a song mixes out, the next song's tempo and key,
 * and what each deck plays around the handoff. The engine turns these into render-ahead pieces.
 *
 * A crossfade, with S the swap bar (a section line of the outgoing song, where the incoming song's
 * bar 0 starts) and the incoming song's mix-in intro in the 16 bars before it:
 *
 *   incoming −16 … −9   its groove's hats, fading in, under the whole outgoing song
 *   incoming  −8 … −1   its full groove; the outgoing song without its drums and melody lines,
 *                       and for the last 4 bars without its figures: only its bass and pads
 *   incoming   0 … 3    the song itself; the outgoing song's pads fading out under it, on the
 *                       incoming song's chords
 *
 * Bass and harmony change hands in one bar line, so two harmonies never play over each other.
 */
import {
  arrangeBar,
  MELODIC_TRACKS,
  padsLedTo,
  sectionIndexAt,
  type BarEvents,
  type DrumHit,
  type MelodicTrack,
} from "./arranger";
import type { DeckSound } from "./ahead";
import type { Note, Song } from "./composer";
import type { BassTone, LeadTone } from "./genres";
import { autoVolumes, type Track } from "./instruments";
import { songSound, type RefWeights } from "./profile";
import type { Rng } from "./rng";
import type { TempoShape } from "./tempo";
import type { Key } from "./theory";

/** Bars of the mix-in intro, before the incoming song's bar 0. */
export const INTRO_BARS = 16;
/** Of which the last ones carry the incoming song's whole groove, the outgoing song's drums out. */
export const DRUM_SWAP_BARS = 8;
/** Bars over which a morph glides the outgoing song's sound to the incoming song's, up to the
 * swap. */
export const MORPH_BARS = 32;
/** Bars past the swap over which the outgoing song's pads fade out under the incoming song. */
export const PAD_FADE_BARS = 4;
/** Bars of the incoming song in the transition: the outgoing pads' fade, and their tails ringing
 * out. */
export const TAIL_BARS = PAD_FADE_BARS + 1;
/** A song plays at least this long before it mixes out (seconds), and past its first chorus. */
export const MIN_SECONDS = 100;
/** The next song's tempo stays within this share of the current one. */
export const MAX_TEMPO_STEP = 0.06;
/** Glides run at 1 BPM per this many bars. */
export const BARS_PER_BPM = 16;
/** The bars of the groove the mix-in intro loops. */
const GROOVE_BARS = 4;
/** Drums of a bar substituted into a beatless start of the incoming song, at most this far. */
const MAX_BEATLESS = 16;
/** The incoming groove's first half: its hats and shakers only, so its backbeat doesn't land on
 * the outgoing song's. */
const TOPS = new Set<DrumHit["voice"]>(["hat", "openhat", "tamb", "cabasa"]);

/**
 * The bar where a song hands over to the next one (the incoming song's bar 0 starts there): a
 * section line once the song has played its first verse–chorus pass and about 2 minutes, or its
 * end. The odds rise section by section, and right after a chorus is likelier, the second
 * chorus most of all.
 */
export function swapBar(song: Song, rng: Rng, earliestBar = 0): number {
  const sec = 240 / song.bpm;
  const sections = song.sections;
  const firstChorus = sections.find((s) => s.kind === "chorus");
  const earliest = Math.max(
    INTRO_BARS,
    earliestBar,
    firstChorus ? firstChorus.startBar + firstChorus.bars : 0,
    Math.ceil(MIN_SECONDS / sec),
  );
  const options: [number, number][] = [];
  let choruses = 0;
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1]!;
    if (prev.kind === "chorus") choruses++;
    const bar = sections[i]!.startBar;
    // Not between two choruses: the song would stop mid-hook.
    if (bar < earliest || (prev.kind === "chorus" && sections[i]!.kind === "chorus")) continue;
    // After the second chorus most of all, then any chorus, then rising section by section.
    const afterChorus = prev.kind === "chorus" ? (choruses === 2 ? 6 : 3) : 1;
    options.push([bar, afterChorus * (1 + 0.25 * options.length)]);
  }
  // Playing to the end, mixed over the outro.
  options.push([song.totalBars, 3]);
  return rng.weighted(options.filter(([bar]) => bar >= INTRO_BARS));
}

/** The next song's tempo: its own, within MAX_TEMPO_STEP of the current one, on the half-BPM
 * grid (a fixed Tempo setting holds). */
export function nextTempo(current: number, own: number): number {
  const lo = Math.ceil(current * (1 - MAX_TEMPO_STEP) * 2) / 2;
  const hi = Math.floor(current * (1 + MAX_TEMPO_STEP) * 2) / 2;
  return Math.min(hi, Math.max(lo, own));
}

/** The glide from the mix-in tempo to the song's own, starting at its bar 0: BARS_PER_BPM bars per
 * BPM, but over at most half the song, so it ends in time for the song to mix out. */
export function glideShape(from: number, to: number, totalBars: number): TempoShape {
  if (from === to) return { bpm: to };
  const bars = Math.round(Math.abs(to - from) * BARS_PER_BPM);
  return { bpm: from, glide: { to, start: 0, bars: Math.max(4, Math.min(bars, totalBars >> 1)) } };
}

/** The keys a DJ mixes into safely from `key` (the Camelot wheel's neighbours): the same key, a
 * fifth up or down, and the relative major or minor. */
export function compatibleKeys(key: Key): Key[] {
  const t = key.tonic;
  const relative: Key =
    key.mode === "minor"
      ? { tonic: (t + 3) % 12, mode: "major" }
      : { tonic: (t + 9) % 12, mode: "minor" };
  return [
    key,
    { tonic: (t + 7) % 12, mode: key.mode },
    { tonic: (t + 5) % 12, mode: key.mode },
    relative,
  ];
}

/** The next song's key: its own if it mixes safely from `current`, else a safe one in its own
 * mode (the relative key when the modes differ). */
export function nextKey(current: Key, own: Key, rng: Rng): Key {
  const safe = compatibleKeys(current);
  if (safe.some((k) => sameKey(k, own))) return own;
  const sameMode = safe.filter((k) => k.mode === own.mode);
  return sameMode.length ? rng.pick(sameMode) : own;
}

function sameKey(a: Key, b: Key): boolean {
  return a.tonic === b.tonic && a.mode === b.mode;
}

/** The key of the section playing just before bar `bar` (where a song hands over): its key, not
 * one bar's colour (an ending's held major chord). */
export function keyBefore(song: Song, bar: number): Key {
  const at = Math.min(song.totalBars, bar) - 1;
  return song.sections[sectionIndexAt(song, at)]!.key;
}

/** The bars whose drums the mix-in intro loops: the start of the song's first verse or chorus
 * with drums (no fills there), else of any section with drums. */
export function grooveBars(song: Song): number[] {
  const has = (bar: number) => arrangeBar(song, bar).drums.length > 0;
  const pick = (kinds: readonly string[] | null) =>
    song.sections.find(
      (s) =>
        (!kinds || kinds.includes(s.kind)) &&
        s.bars >= GROOVE_BARS + 1 &&
        Array.from({ length: GROOVE_BARS }, (_, i) => s.startBar + i).every(has),
    );
  const s = pick(["verse", "chorus"]) ?? pick(null);
  if (!s) return [];
  return Array.from({ length: GROOVE_BARS }, (_, i) => s.startBar + i);
}

const silent = (ev: BarEvents): BarEvents => ({
  ...ev,
  drums: [],
  notes: Object.fromEntries(MELODIC_TRACKS.map((t) => [t, []])) as unknown as BarEvents["notes"],
});

const scaled = (hits: DrumHit[], gain: number): DrumHit[] =>
  gain === 1 ? hits : hits.map((h) => ({ ...h, vel: h.vel * gain }));

/** The outgoing song's melody lines, out with its drums for the last DRUM_SWAP_BARS. */
const MELODY_OUT = new Set<MelodicTrack>(["hook", "lead", "leadOct", "counter"]);
/** And its figures, out for the last half of those bars: only its bass and pads reach the swap. */
const FIGURES_OUT = new Set<MelodicTrack>(["riff", "arp", "stab", "seq", "guitar", "synth"]);

/** What the outgoing song plays per bar: its own bars, then, for the last DRUM_SWAP_BARS before
 * the swap, shedding parts as a DJ's EQ would: its drums and melody lines, then its figures, so
 * only its bass and pads reach the swap. Past it, its pads alone (if they reached it), fading out
 * over PAD_FADE_BARS in their own voicing, each note moving to the nearest note of the incoming
 * song's chords, so the two harmonies don't rub. */
export function outgoingArrange(song: Song, swap: number, next: Song): (bar: number) => BarEvents {
  const last = Math.min(swap, song.totalBars) - 1;
  const lastPads = arrangeBar(song, last).notes.pad;
  const padVel = Math.max(0, ...lastPads.map((n) => n.vel));
  // The voicing the pads end on (the bar's last chord), led through the incoming chords.
  const lastStep = Math.max(0, ...lastPads.map((n) => n.step));
  const fade: Note[][] = [];
  let voices = lastPads.filter((n) => n.step === lastStep).map((n) => n.midi);
  for (let i = 0; i < Math.min(PAD_FADE_BARS, next.totalBars) && voices.length; i++) {
    const gain = 1 - (i + 1) / (PAD_FADE_BARS + 1);
    const led = padsLedTo(next, i, voices, padVel * gain);
    fade.push(led.notes);
    voices = led.voices;
  }
  return (bar) => {
    if (bar >= swap) {
      const quiet = { ...silent(arrangeBar(song, last)), bar };
      return { ...quiet, notes: { ...quiet.notes, pad: fade[bar - swap] ?? [] } };
    }
    const ev = arrangeBar(song, bar);
    if (bar < swap - DRUM_SWAP_BARS) return ev;
    const out = bar >= swap - DRUM_SWAP_BARS / 2 ? FIGURES_OUT : null;
    const notes = Object.fromEntries(
      MELODIC_TRACKS.map((t) => [t, MELODY_OUT.has(t) || out?.has(t) ? [] : ev.notes[t]]),
    ) as unknown as BarEvents["notes"];
    return { ...ev, drums: [], notes };
  };
}

/**
 * What the incoming song plays per bar: before bar 0, the mix-in intro (its groove looped: its
 * hats fading in for the first half, then all of it); from bar 0, its own bars, with the groove carried on
 * through a beatless start until its own drums come in.
 */
export function incomingArrange(song: Song): (bar: number) => BarEvents {
  const groove = grooveBars(song);
  const loop = (bar: number) => {
    const source = groove[(((bar % GROOVE_BARS) + GROOVE_BARS) % GROOVE_BARS) as number];
    return source === undefined ? [] : arrangeBar(song, source).drums;
  };
  let firstDrums = 0;
  while (
    firstDrums < Math.min(MAX_BEATLESS, song.totalBars) &&
    !arrangeBar(song, firstDrums).drums.length
  )
    firstDrums++;
  return (bar) => {
    if (bar >= 0) {
      const ev = arrangeBar(song, bar);
      return bar < firstDrums && firstDrums < MAX_BEATLESS ? { ...ev, drums: loop(bar) } : ev;
    }
    const ev = silent(arrangeBar(song, 0));
    const into = bar + INTRO_BARS;
    if (into >= INTRO_BARS - DRUM_SWAP_BARS) return { ...ev, bar, drums: loop(bar) };
    // Its hats and shakers, fading in from about a third.
    const gain = 0.35 + (0.65 * into) / (INTRO_BARS - DRUM_SWAP_BARS);
    const hits = loop(bar).filter((h) => TOPS.has(h.voice));
    return { ...ev, bar, drums: scaled(hits, gain) };
  };
}

// ── Morph ─────────────────────────────────────────────────────────────────────────────────────

/** How a song hands over to the next: two decks overlapping, or the one song turning into the
 * next one's sound and handing over at a section line. */
export type TransitionStyle = "crossfade" | "morph";

/** What the playing song plays per bar in a morph: its own bars, its melody lines out for the
 * last DRUM_SWAP_BARS before the swap, then its figures for the last half of those, so a
 * breakdown of drums, bass and pads leads into the incoming song's intro. */
export function morphArrange(song: Song, swap: number): (bar: number) => BarEvents {
  return (bar) => {
    const ev = arrangeBar(song, bar);
    if (bar < swap - DRUM_SWAP_BARS) return ev;
    const out = bar >= swap - DRUM_SWAP_BARS / 2 ? FIGURES_OUT : null;
    const notes = Object.fromEntries(
      MELODIC_TRACKS.map((t) => [t, MELODY_OUT.has(t) || out?.has(t) ? [] : ev.notes[t]]),
    ) as unknown as BarEvents["notes"];
    return { ...ev, notes };
  };
}

/** A song's continuous sound (its auto faders, bass tone and voice mix). */
export function deckSound(song: Song): DeckSound {
  const sound = songSound(song);
  return {
    volumes: autoVolumes(sound.mix),
    bassTone: sound.bassTone,
    leadTone: sound.leadTone,
  };
}

/** Between two sounds, `t` of the way (0–1). A setting that turns a layer on or off (the octave
 * saw, the pulse, the low cut, a struck envelope) switches halfway rather than creeping in. */
export function soundBetween(a: DeckSound, b: DeckSound, t: number): DeckSound {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const step = <T>(x: T, y: T) => (t < 0.5 ? x : y);
  const switched = (x: number, y: number) => (x === 0 || y === 0 ? step(x, y) : lerp(x, y));
  const volumes = Object.fromEntries(
    (Object.keys(a.volumes) as Track[]).map((k) => [k, lerp(a.volumes[k], b.volumes[k])]),
  ) as Record<Track, number>;
  const x = a.bassTone;
  const y = b.bassTone;
  const bassTone: BassTone = {
    frequency: lerp(x.frequency, y.frequency),
    presence: lerp(x.presence, y.presence),
    sawCutoff: lerp(x.sawCutoff, y.sawCutoff),
    octave: switched(x.octave, y.octave),
    sustain: lerp(x.sustain, y.sustain),
    lowCut: switched(x.lowCut, y.lowCut),
    sweep: lerp(x.sweep, y.sweep),
    struck: step(x.struck, y.struck),
    pulse: switched(x.pulse, y.pulse),
  };
  const leadTone = Object.fromEntries(
    (Object.keys(a.leadTone) as (keyof LeadTone)[]).map((k) => [
      k,
      lerp(a.leadTone[k], b.leadTone[k]),
    ]),
  ) as unknown as LeadTone;
  return { volumes, bassTone, leadTone };
}

/** The playing song's sound per bar in a morph: its own until the window, then gliding to the
 * incoming song's by the swap. */
export function morphSound(song: Song, next: Song, swap: number): (bar: number) => DeckSound {
  const from = deckSound(song);
  const to = deckSound(next);
  const start = swap - MORPH_BARS;
  return (bar) => soundBetween(from, to, Math.min(1, Math.max(0, (bar - start + 1) / MORPH_BARS)));
}

/** How far apart two blends are: half the summed weight differences, 0 (the same) to 1. */
export function blendDistance(a: RefWeights, b: RefWeights): number {
  const total = (w: RefWeights) => Object.values(w).reduce((sum, v) => sum + (v ?? 0), 0) || 1;
  const ta = total(a);
  const tb = total(b);
  const refs = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RefWeights>;
  let d = 0;
  for (const r of refs) d += Math.abs((a[r] ?? 0) / ta - (b[r] ?? 0) / tb);
  return d / 2;
}

/** Morph blends this far apart at most (blendDistance). */
export const MORPH_DISTANCE = 0.5;
/** And tempos this far apart at most (share of the outgoing tempo). */
export const MORPH_TEMPO_STEP = 0.03;

/** Auto's pick for a handoff: morph when the next song is close (the same genre, a nearby blend,
 * the same or the relative key, a tempo within 3 %), crossfade when it's far. */
export function autoTransition(
  song: Song,
  next: Song,
  keyAtSwap: Key,
  bpmAtSwap: number,
): TransitionStyle {
  const k = next.key;
  const relative = compatibleKeys(keyAtSwap)[3]!;
  const close =
    song.genre === next.genre &&
    blendDistance(song.blends.song, next.blends.song) <= MORPH_DISTANCE &&
    (sameKey(k, keyAtSwap) || sameKey(k, relative)) &&
    Math.abs(next.bpm - bpmAtSwap) <= bpmAtSwap * MORPH_TEMPO_STEP;
  return close ? "morph" : "crossfade";
}
