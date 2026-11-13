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
  harmonyAt,
  MELODIC_TRACKS,
  padsLedTo,
  sectionIndexAt,
  type BarEvents,
  type ChordSlot,
  type DrumHit,
  type MelodicTrack,
} from "./arranger";
import type { DeckEffect, DeckSound } from "./ahead";
import type { Note, Song } from "./composer";
import type { BassTone, LeadTone, Voices } from "./genres";
import { autoVolumes, type Track } from "./instruments";
import { songSound, type RefWeights } from "./profile";
import { createRng, type Rng } from "./rng";
import type { TempoShape } from "./tempo";
import { chordPitchClasses, nearestWithPc, scaleForChord, type Chord, type Key } from "./theory";

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
  return handOver(song, swap, next, {});
}

/** How an outgoing song hands over (handOver); unset, as in a plain crossfade. */
interface HandOverOptions {
  /** Its drums for the last DRUM_SWAP_BARS (a morph's turn into the next song's); unset: none. */
  drums?: (bar: number, own: DrumHit[]) => DrumHit[];
  /** Bars before the swap its melody lines drop (0: they sing to the swap). */
  melodyOut?: number;
  /** Bars before the swap its figures drop (0: they play to the swap). */
  figuresOut?: number;
  /** Bars before the swap its bass drops (0: it plays to the swap). */
  bassOut?: number;
  /** Semitones the incoming song's first bars are moved (pitch to match). */
  shift?: number;
  /** Notes it plays past the swap besides its fading pads (an acapella bridge's voice). */
  after?: (bar: number) => Partial<BarEvents["notes"]>;
}

/** An outgoing song's bars around a swap: its own bars, then its parts dropping over the last
 * DRUM_SWAP_BARS (its drums, unless `drums` turns them into others; its melody lines; then its
 * figures). Past the swap, its pads alone (if they reached it), fading out over PAD_FADE_BARS in
 * their own voicing, each note moving to the nearest note of the incoming song's chords. */
function handOver(
  song: Song,
  swap: number,
  next: Song,
  options: HandOverOptions,
): (bar: number) => BarEvents {
  const {
    drums,
    melodyOut = DRUM_SWAP_BARS,
    figuresOut = DRUM_SWAP_BARS / 2,
    bassOut = 0,
    shift = 0,
    after,
  } = options;
  const last = Math.min(swap, song.totalBars) - 1;
  const lastPads = arrangeBar(song, last).notes.pad;
  const padVel = Math.max(0, ...lastPads.map((n) => n.vel));
  // The voicing the pads end on (the bar's last chord), led through the incoming chords.
  const lastStep = Math.max(0, ...lastPads.map((n) => n.step));
  const fade: Note[][] = [];
  let voices = lastPads.filter((n) => n.step === lastStep).map((n) => n.midi);
  for (let i = 0; i < Math.min(PAD_FADE_BARS, next.totalBars) && voices.length; i++) {
    const gain = 1 - (i + 1) / (PAD_FADE_BARS + 1);
    const led = padsLedTo(next, i, voices, padVel * gain, shift);
    fade.push(led.notes);
    voices = led.voices;
  }
  return (bar) => {
    if (bar >= swap) {
      const quiet = { ...silent(arrangeBar(song, last)), bar };
      const pad = fade[bar - swap] ?? [];
      return { ...quiet, notes: { ...quiet.notes, pad, ...after?.(bar) } };
    }
    const ev = arrangeBar(song, bar);
    if (bar < swap - DRUM_SWAP_BARS) return ev;
    const before = swap - bar;
    const dropped = (t: MelodicTrack) =>
      (MELODY_OUT.has(t) && before <= melodyOut) ||
      (FIGURES_OUT.has(t) && before <= figuresOut) ||
      (t === "bass" && before <= bassOut);
    const notes = Object.fromEntries(
      MELODIC_TRACKS.map((t) => [t, dropped(t) ? [] : ev.notes[t]]),
    ) as unknown as BarEvents["notes"];
    return { ...ev, drums: drums ? drums(bar, ev.drums) : [], notes };
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
 * breakdown of drums, bass and pads leads into the incoming song's intro. Over those bars its
 * drums turn into the incoming song's opening pattern (hats and shakers, then all of it). Where
 * its kit switches to the incoming song's (morphSwitches), the new kit comes in a little under
 * full level and rises over KIT_RAMP_BARS. Past the swap, its pads fade out on the incoming
 * chords, as after a crossfade. So at the swap only the notes change. */
export function morphArrange(song: Song, swap: number, next: Song): (bar: number) => BarEvents {
  // The drums the incoming song opens with (its groove standing in through a beatless start),
  // looped: its hats and shakers take over first, then its whole pattern.
  const into = incomingArrange(next);
  const opening = (bar: number) => into((((bar - swap) % GROOVE_BARS) + GROOVE_BARS) % GROOVE_BARS);
  const kit = morphSwitches(song, next).kit;
  const kitBar = kit === undefined ? Infinity : swap - MORPH_BARS + kit;
  const play = handOver(song, swap, next, {
    drums: (bar, own) => {
      const theirs = opening(bar).drums;
      if (bar >= swap - DRUM_SWAP_BARS / 2) return theirs;
      return [...own.filter((h) => !TOPS.has(h.voice)), ...theirs.filter((h) => TOPS.has(h.voice))];
    },
  });
  return (bar) => {
    const ev = play(bar);
    const into = bar - kitBar;
    if (into < 0 || into >= KIT_RAMP_BARS) return ev;
    return { ...ev, drums: scaled(ev.drums, KIT_IN + ((1 - KIT_IN) * into) / KIT_RAMP_BARS) };
  };
}

/** Where a morph's new kit starts (velocity share), rising to full over KIT_RAMP_BARS: kits'
 * own levels differ, a few dB either way, so it neither jumps in nor drops out. (Starting its
 * hats at 0.35 dipped them 7 dB where the kits were about as loud; an earlier jump heard in the
 * hats was the next song's busier intro pattern, not its kit.) */
const KIT_IN = 0.75;
export const KIT_RAMP_BARS = 8;

/** The patches a morph switches one at a time (the ones the instruments read; the others pick
 * notes, which change at the swap). */
const PATCHES = [
  "riffPatch",
  "stabPatch",
  "arpPatch",
  "countervoice",
  "padTone",
  "synthPatch",
] as const satisfies readonly (keyof Voices)[];
type Switch = (typeof PATCHES)[number] | "kit";

/** Where in a morph window (bars from its start) each of the sounds that differ between the two
 * songs switches: the kit at bar 8, so it has risen to full before the drum pattern turns; each
 * patch at its own 4-bar line from 4 to 20, in an order drawn per song. Everything has switched
 * well before the swap, where only the notes change. */
export function morphSwitches(song: Song, next: Song): Partial<Record<Switch, number>> {
  const a = deckSound(song);
  const b = deckSound(next);
  const out: Partial<Record<Switch, number>> = {};
  if (a.kit !== b.kit || a.drums.gatedSnare !== b.drums.gatedSnare) out.kit = 8;
  else if (a.drums.kickWeight !== b.drums.kickWeight) out.kit = 8;
  const rng = createRng(song.seed).fork("morph");
  const slots = [4, 12, 16, 20];
  const differ = PATCHES.filter((k) => a.voices[k] !== b.voices[k]);
  // Shuffled, then dealt out over the slots.
  for (let i = differ.length - 1; i > 0; i--) {
    const k = rng.int(0, i);
    [differ[i], differ[k]] = [differ[k]!, differ[i]!];
  }
  differ.forEach((k, i) => (out[k] = slots[i % slots.length]));
  return out;
}

/** A song's sound on a deck: its auto faders, bass tone and voice mix, kit and patches. */
export function deckSound(song: Song): DeckSound {
  const sound = songSound(song);
  return {
    volumes: autoVolumes(sound.mix),
    bassTone: sound.bassTone,
    leadTone: sound.leadTone,
    kit: song.kit,
    drums: { gatedSnare: sound.drums.gatedSnare, kickWeight: sound.drums.kickWeight ?? 0 },
    voices: sound.voices,
  };
}

/** Between two sounds, `t` of the way (0–1), for the continuous parts; the kit and patches stay
 * `a`'s. A setting that turns a layer on or off (the octave saw, the pulse, the low cut, a struck
 * envelope) switches halfway rather than creeping in. */
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
  return { ...a, volumes, bassTone, leadTone };
}

/** The playing song's sound per bar in a morph: its own until the window, then gliding to the
 * incoming song's by the swap, its kit and each patch switching on bars of their own
 * (morphSwitches). */
export function morphSound(song: Song, next: Song, swap: number): (bar: number) => DeckSound {
  const from = deckSound(song);
  const to = deckSound(next);
  const start = swap - MORPH_BARS;
  const switches = morphSwitches(song, next);
  const on = (k: Switch, bar: number) => {
    const at = switches[k];
    return at !== undefined && bar >= start + at;
  };
  // One voices object per set of switched patches, so a deck can tell when they change.
  const voices = new Map<string, Voices>();
  return (bar) => {
    const t = Math.min(1, Math.max(0, (bar - start + 1) / MORPH_BARS));
    const switched = PATCHES.filter((k) => on(k, bar));
    const key = switched.join();
    let v = voices.get(key);
    if (!v) {
      v = { ...from.voices };
      for (const k of switched) Object.assign(v, { [k]: to.voices[k] });
      voices.set(key, v);
    }
    const kit = on("kit", bar);
    return {
      ...soundBetween(from, to, t),
      kit: kit ? to.kit : from.kit,
      drums: kit ? to.drums : from.drums,
      voices: v,
    };
  };
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

// ── Tricks (#5) ───────────────────────────────────────────────────────────────────────────────

/** The tricks a crossfade can play (docs/plans/dj-mode.md). Each is one action on the two songs
 * and the swap, which the automatic DJ picks from (and a manual one could fire). */
export type TrickId = "mix" | "pitch" | "mashup" | "echo" | "acapella";

/** How a transition shows on screen ("Echo out → Get Closer"). */
export const TRANSITION_LABELS: Record<TrickId | "morph", string> = {
  mix: "Mixing",
  pitch: "Pitch to match",
  mashup: "Mashup",
  echo: "Echo out",
  acapella: "Acapella bridge",
  morph: "Morphing",
};

/** A crossfade's trick, with pitch to match's shift: the semitones the incoming song's notes
 * move until its bar `until`, where it modulates back to its own key. */
export interface Trick {
  id: TrickId;
  shift?: { by: number; until: number };
}

/** Bars the outgoing voice sings on alone over the incoming song in an acapella bridge. */
export const ACAPELLA_BARS = 8;
/** Bars an echo out rings on in the transition after its last notes. */
const ECHO_TAIL_BARS = 4;
/** An echo out's delay send (every part) and feedback. */
const ECHO_OUT = { send: 0.7, feedback: 0.6 };

/** What each deck plays around a crossfade's swap with a trick, and the outgoing deck's effects
 * per bar: what render ahead needs for the transition piece. */
export interface Handoff {
  outgoing: (bar: number) => BarEvents;
  incoming: (bar: number) => BarEvents;
  effects?: (bar: number) => DeckEffect | null;
  /** Bars past the swap the outgoing deck plays. */
  outgoingBars: number;
  /** Bars of the incoming song in the transition (the outgoing deck's tails, echoes). */
  tail: number;
}

/** A crossfade with `trick` from `song` into `next`, the incoming song's bar 0 at `swap`. */
export function handoff(song: Song, swap: number, next: Song, trick: Trick): Handoff {
  const shift = trick.shift;
  const incoming = shiftedArrange(incomingArrange(next), shift);
  const plain: Handoff = {
    outgoing: handOver(song, swap, next, { shift: shift?.by ?? 0 }),
    incoming,
    outgoingBars: PAD_FADE_BARS,
    tail: TAIL_BARS,
  };
  switch (trick.id) {
    case "mix":
    case "pitch":
      return plain;
    case "echo":
      return {
        ...plain,
        outgoing: handOver(song, swap, next, { melodyOut: 0 }),
        effects: (bar) => (bar === swap - 1 ? { echoOut: ECHO_OUT } : null),
      };
    case "mashup":
      return {
        ...plain,
        // Its pads, figures and (for half the bars) voice over the incoming beat and bass.
        outgoing: handOver(song, swap, next, {
          melodyOut: DRUM_SWAP_BARS / 2,
          figuresOut: 0,
          bassOut: DRUM_SWAP_BARS,
        }),
        incoming: mashupIncoming(song, swap, next, incoming),
      };
    case "acapella": {
      const hook = hookBars(song, swap);
      const end = swap + ACAPELLA_BARS;
      const sung = (bar: number) => {
        const source = hook[(bar - swap) % hook.length];
        if (source === undefined || bar >= end) return {};
        const own = arrangeBar(song, source).notes;
        const h = harmonyAt(next, bar - swap);
        return { lead: fitted(own.lead, h), leadOct: fitted(own.leadOct, h) };
      };
      return {
        outgoing: handOver(song, swap, next, { melodyOut: 0, after: sung }),
        // The incoming song's own melody lines wait for the bridge.
        incoming: (bar) => {
          const ev = incoming(bar);
          if (bar < 0 || bar >= ACAPELLA_BARS) return ev;
          const notes = { ...ev.notes };
          for (const t of MELODY_OUT) notes[t] = [];
          return { ...ev, notes };
        },
        effects: (bar) => (bar === end - 1 ? { echoOut: ECHO_OUT } : null),
        outgoingBars: ACAPELLA_BARS,
        tail: ACAPELLA_BARS + ECHO_TAIL_BARS,
      };
    }
  }
}

/** A song's bars with its notes moved `shift.by` semitones until bar `shift.until` (its drums
 * stay). */
export function shiftedArrange(
  play: (bar: number) => BarEvents,
  shift: Trick["shift"],
): (bar: number) => BarEvents {
  if (!shift?.by) return play;
  return (bar) => {
    const ev = play(bar);
    if (bar >= shift.until) return ev;
    const notes = Object.fromEntries(
      MELODIC_TRACKS.map((t) => [t, ev.notes[t].map((n) => ({ ...n, midi: n.midi + shift.by }))]),
    ) as unknown as BarEvents["notes"];
    return { ...ev, notes };
  };
}

/** The chord sounding at `step` of a bar. */
function slotAt(slots: readonly ChordSlot[], step: number): Chord {
  let chord = slots[0]!.chord;
  for (const s of slots) if (s.step <= step) chord = s.chord;
  return chord;
}

/** The nearest MIDI note to `midi` with a pitch class in `pcs`. */
function nearestIn(midi: number, pcs: readonly number[]): number {
  return pcs
    .map((pc) => nearestWithPc(pc, midi))
    .reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
}

/** A melody fitted to other chords: on the beat to the nearest chord tone, else to the nearest
 * tone of the chord's scale. */
export function fitted(notes: readonly Note[], h: { key: Key; slots: ChordSlot[] }): Note[] {
  return notes.map((n) => {
    const chord = slotAt(h.slots, n.step);
    const pcs = n.step % 4 === 0 ? chordPitchClasses(h.key, chord) : scaleForChord(h.key, chord);
    return { ...n, midi: nearestIn(n.midi, pcs) };
  });
}

/** The bars an acapella bridge sings: the start of the last chorus before the swap with a sung
 * line (up to ACAPELLA_BARS, looped if shorter); none without one. */
export function hookBars(song: Song, swap: number): number[] {
  const sung = (bar: number) => arrangeBar(song, bar).notes.lead.length > 0;
  const chorus = [...song.sections]
    .reverse()
    .find((s) => s.kind === "chorus" && s.startBar + s.bars <= swap && sung(s.startBar));
  if (!chorus) return [];
  return Array.from(
    { length: Math.min(ACAPELLA_BARS, chorus.bars) },
    (_, i) => chorus.startBar + i,
  );
}

/** The bars whose bass a mashup loops: the start of the song's first verse or chorus with a bass
 * line in its first bars. */
function bassBars(song: Song): number[] {
  const has = (bar: number) => arrangeBar(song, bar).notes.bass.length > 0;
  const s = song.sections.find(
    (x) =>
      ["verse", "chorus"].includes(x.kind) &&
      x.bars >= GROOVE_BARS &&
      Array.from({ length: GROOVE_BARS }, (_, i) => x.startBar + i).every(has),
  );
  return s ? Array.from({ length: GROOVE_BARS }, (_, i) => s.startBar + i) : [];
}

/** A bass line moved onto other chords: each note keeps its interval from its chord's root as
 * far as the new chord has it (else the nearest chord tone), in its own register. */
export function refitBass(
  notes: readonly Note[],
  from: { key: Key; slots: ChordSlot[] },
  to: { key: Key; slots: ChordSlot[] },
): Note[] {
  return notes.map((n) => {
    const src = chordPitchClasses(from.key, slotAt(from.slots, n.step));
    const dst = chordPitchClasses(to.key, slotAt(to.slots, n.step));
    const interval = (((n.midi - src[0]!) % 12) + 12) % 12;
    const want = (dst[0]! + interval) % 12;
    const pc = dst.includes(want)
      ? want
      : dst.reduce((a, b) => (circular(b, want) < circular(a, want) ? b : a));
    return { ...n, midi: nearestWithPc(pc, n.midi) };
  });
}

const circular = (a: number, b: number) => Math.min((a - b + 12) % 12, (b - a + 12) % 12);

/** A mashup's incoming song: for the last DRUM_SWAP_BARS before the swap, its bass line (looped
 * from its first verse or chorus) on the outgoing song's chords, under the outgoing pads and
 * figures; then itself. */
function mashupIncoming(
  song: Song,
  swap: number,
  next: Song,
  play: (bar: number) => BarEvents,
): (bar: number) => BarEvents {
  const bass = bassBars(next);
  return (bar) => {
    const ev = play(bar);
    if (bar >= 0 || bar < -DRUM_SWAP_BARS || !bass.length) return ev;
    const source = bass[(bar + 64) % GROOVE_BARS]!;
    const line = refitBass(
      arrangeBar(next, source).notes.bass,
      harmonyAt(next, source),
      harmonyAt(song, swap + bar),
    );
    return { ...ev, notes: { ...ev.notes, bass: line } };
  };
}

/** The tricks a crossfade can play, with their odds. Pitch to match comes first when it can
 * (pitchable: the next song's own key doesn't mix from the current one; half the time); no
 * trick twice in a row. */
export function pickTrick(
  rng: Rng,
  can: { pitch: boolean; acapella: boolean },
  last: TrickId | null,
): TrickId {
  if (can.pitch && last !== "pitch" && rng.chance(0.5)) return "pitch";
  const options: [TrickId, number][] = [
    ["mix", 2],
    ["echo", 2],
    ["mashup", 2],
  ];
  if (can.acapella) options.push(["acapella", 2]);
  return rng.weighted(options.filter(([id]) => id !== last));
}

/** Pitch to match's shift: from `own` key into the neighbour of `current` in its own mode that
 * moves least (within a tritone; the relative key when the modes differ), until the incoming
 * song's first chorus (or its second section), where it modulates back. */
export function pitchShift(current: Key, own: Key, next: Song): { by: number; until: number } {
  const shifts = compatibleKeys(current)
    .filter((k) => k.mode === own.mode)
    .map((k) => {
      const by = (((k.tonic - own.tonic) % 12) + 12) % 12;
      return by > 6 ? by - 12 : by;
    });
  // The least move; on a tie, down, so the move back is a lift.
  const by = shifts.reduce((a, b) =>
    Math.abs(b) < Math.abs(a) || (Math.abs(b) === Math.abs(a) && b < a) ? b : a,
  );
  const chorus = next.sections.find((s) => s.kind === "chorus" && s.startBar > 0);
  const until = chorus?.startBar ?? next.sections[1]?.startBar ?? next.totalBars;
  return { by, until };
}
