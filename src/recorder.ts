/**
 * Records a melody played on the computer keyboard or a MIDI keyboard while a section loops. Notes
 * are placed by the audio clock (what you hear, latency included), snapped to 16ths, and wrapped
 * into the section's bars; the lead synth plays them back as you play.
 */
import * as Tone from "tone";
import type { CustomMelody } from "./composer";
import type { Engine } from "./engine";

/** A–; is one chromatic octave and a third from C, as in most DAWs; Z / X shift octaves. */
const KEYS = "awsedftgyhujkolp;";

export interface RecordingTarget {
  /** The section being recorded: its first bar and length. */
  startBar: number;
  bars: number;
  /** Key tonic pitch class: recorded pitches are stored relative to it. */
  tonic: number;
}

export class Recorder {
  private target: RecordingTarget | null = null;
  private octave = 0;
  /** Held notes: MIDI note → where it started (section-relative 16ths). */
  private held = new Map<number, number>();
  private notes: CustomMelody["notes"] = [];
  private readonly velocities = new Map<number, number>();
  private midiAccess: MIDIAccess | null = null;

  constructor(private readonly engine: Engine) {
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("keyup", this.onKeyUp, true);
  }

  get active(): boolean {
    return this.target !== null;
  }

  /** Starts capturing (the section should already be playing on a loop). */
  async start(target: RecordingTarget): Promise<void> {
    this.target = target;
    this.notes = [];
    this.held.clear();
    try {
      this.midiAccess ??= navigator.requestMIDIAccess ? await navigator.requestMIDIAccess() : null;
    } catch {
      this.midiAccess = null; // No MIDI (or refused): the computer keyboard still works.
    }
    for (const input of this.midiAccess?.inputs.values() ?? []) {
      input.onmidimessage = this.onMidi;
    }
  }

  /** Stops and returns what was played (null if nothing was). */
  stop(name: string): CustomMelody | null {
    const target = this.target;
    for (const midi of [...this.held.keys()]) this.release(midi);
    this.target = null;
    for (const input of this.midiAccess?.inputs.values() ?? []) input.onmidimessage = null;
    this.engine.instruments?.monitor(null);
    if (!target || !this.notes.length) return null;
    // Later takes win over earlier ones on the same 16th.
    const bySlot = new Map<string, CustomMelody["notes"][number]>();
    for (const n of this.notes) bySlot.set(`${n.bar}:${n.step}`, n);
    return {
      name,
      tonic: target.tonic,
      bars: Math.min(32, target.bars),
      notes: [...bySlot.values()].sort((a, b) => a.bar - b.bar || a.step - b.step),
    };
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.target || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (k === "z" || k === "x") {
      this.octave = Math.max(-2, Math.min(2, this.octave + (k === "z" ? -1 : 1)));
      e.preventDefault();
      return;
    }
    const i = KEYS.indexOf(k);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    this.press(60 + 12 * this.octave + i, 0.85);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!this.target) return;
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i < 0) return;
    this.release(60 + 12 * this.octave + i);
  };

  private readonly onMidi = (e: MIDIMessageEvent) => {
    const [status = 0, note = 0, velocity = 0] = e.data ?? [];
    const kind = status & 0xf0;
    if (kind === 0x90 && velocity > 0) this.press(note, velocity / 127);
    else if (kind === 0x80 || kind === 0x90) this.release(note);
  };

  private press(midi: number, velocity: number): void {
    const at = this.now();
    if (at === null) return;
    this.held.set(midi, at);
    this.engine.instruments?.monitor(midi, velocity);
    this.velocities.set(midi, velocity);
  }

  private release(midi: number): void {
    const start = this.held.get(midi);
    this.held.delete(midi);
    if (this.held.size === 0) this.engine.instruments?.monitor(null);
    const target = this.target;
    const end = this.now();
    if (start === undefined || !target || end === null) return;
    const length = target.bars * 16;
    const from = Math.round(start) % length;
    let dur = end - start;
    if (dur < 0) dur += length; // released after the loop wrapped
    this.notes.push({
      bar: Math.floor(from / 16),
      step: from % 16,
      dur: Math.max(1, Math.round(dur)),
      pitch: midi - target.tonic,
      vel: this.velocities.get(midi) ?? 0.85,
    });
  }

  /** The current position in 16ths from the section's first bar, as heard; null if not playing. */
  private now(): number | null {
    const target = this.target;
    if (!target || !this.engine.playing) return null;
    const ctx = Tone.getContext().rawContext as AudioContext;
    const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const pos = this.engine.positionAt(heard);
    if (pos === null) return null;
    const into = (pos - target.startBar) * 16;
    const length = target.bars * 16;
    return ((into % length) + length) % length;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName) || t.isContentEditable);
}
