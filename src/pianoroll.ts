/**
 * The current section as a piano roll: one lane per instrument that plays in it, notes placed by
 * pitch within the lane's own range, drums on per-voice rows, the chords over each bar, and a
 * playhead that moves across. Everything comes from arrangeBar, so it shows exactly what plays
 * (generated parts, MIDI-imported parts and creator edits alike).
 */
import { arrangeBar, type BarEvents, type DrumVoice, type MelodicTrack } from "./arranger";
import type { Note, Section, Song } from "./composer";

/**
 * Creator mode: the Lead lane becomes a note editor. `bars` is the melody (bar m plays in every
 * section bar b with b % bars.length === m); edits come back through `commit` on release.
 */
export interface LeadEditor {
  bars: Note[][];
  /** Lowest and highest pitch rows. */
  range: readonly [number, number];
  /** Pitch classes notes snap to (hold Shift for any semitone). */
  scale: readonly number[];
  commit(bars: Note[][]): void;
}

interface Lane {
  label: string;
  color: string;
  tracks: readonly MelodicTrack[];
}

const LANES: readonly Lane[] = [
  { label: "Seq bass", color: "#ff3d8b", tracks: ["bass"] },
  { label: "Sequence", color: "#39d0ff", tracks: ["seq"] },
  { label: "Guitar", color: "#ffcf3d", tracks: ["guitar"] },
  { label: "Melodic bass", color: "#ff8a3d", tracks: ["hook"] },
  { label: "Pad", color: "#8f7dff", tracks: ["pad"] },
  { label: "Riff", color: "#3dffb0", tracks: ["riff"] },
  { label: "Lead", color: "#f4f2ff", tracks: ["lead", "leadOct"] },
  { label: "Arp", color: "#3d9bff", tracks: ["arp"] },
  { label: "Stabs", color: "#ff6bd5", tracks: ["stab"] },
];

const DRUM_ROWS: readonly { label: string; voices: readonly DrumVoice[] }[] = [
  { label: "cym", voices: ["crash", "tamb", "cabasa", "rim"] },
  { label: "hat", voices: ["hat", "openhat"] },
  { label: "tom", voices: ["tomh", "tomm", "toml"] },
  { label: "snr", voices: ["snare", "clap"] },
  { label: "kick", voices: ["kick"] },
];

const LABEL_W = 92;
const HEADER_H = 22;
const LANE_H = 30;
const DRUM_H = 55;
const LEAD_EDIT_H = 170;
/** Grab a note's right edge within this many pixels to change its length. */
const EDGE_PX = 6;

type Drag =
  | { kind: "move"; bar: number; index: number; grabStep: number; startX: number; startY: number }
  | { kind: "resize"; bar: number; index: number };

export class PianoRoll {
  private readonly ctx: CanvasRenderingContext2D | null;
  private song: Song | null = null;
  private sectionIndex = -1;
  private section: Section | null = null;
  private bars: BarEvents[] = [];
  private lanes: Lane[] = [];
  private hasDrums = false;
  /** The bar playing, and when (performance.now()) it started. */
  private bar = 0;
  private barStarted = 0;
  private playing = false;
  private editor: LeadEditor | null = null;
  /** The editor's melody while it's being edited (committed on release). */
  private edit: Note[][] = [];
  private drag: Drag | null = null;
  /** Where the editable Lead lane is drawn (for hit-testing). */
  private leadTop = -1;
  private suppressClick = false;
  /** Whether the current drag changed anything (a click on a note alone doesn't). */
  private dirty = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onSeek: (bar: number) => void,
  ) {
    this.ctx = canvas.getContext("2d");
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerup", () => this.pointerUp());
    canvas.addEventListener("dblclick", (e) => this.remove(e));
    canvas.addEventListener("contextmenu", (e) => {
      if (this.inLead(this.local(e).y)) {
        e.preventDefault();
        this.remove(e);
      }
    });
    canvas.addEventListener("click", (e) => {
      if (this.suppressClick || this.inLead(this.local(e).y)) {
        this.suppressClick = false;
        return;
      }
      if (!this.section) return;
      const x = this.local(e).x - LABEL_W;
      const width = canvas.clientWidth - LABEL_W;
      if (x < 0 || width <= 0) return;
      const bar = Math.floor((x / width) * this.section.bars);
      onSeek(this.section.startBar + Math.min(this.section.bars - 1, Math.max(0, bar)));
    });
    const frame = () => {
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Shows `bar`'s section (re-arranging it when the song or section changed). */
  show(song: Song, bar: number, playing: boolean): void {
    const index = song.sections.findIndex((s) => bar >= s.startBar && bar < s.startBar + s.bars);
    if (song !== this.song || index !== this.sectionIndex) {
      this.song = song;
      this.sectionIndex = index;
      this.section = song.sections[index] ?? null;
      this.arrange();
    }
    this.bar = bar;
    this.barStarted = performance.now();
    this.playing = playing;
  }

  /** Turns the Lead lane into a note editor (null: back to display only). */
  setEditor(editor: LeadEditor | null): void {
    this.editor = editor;
    this.edit = editor ? editor.bars.map((bar) => bar.map((n) => ({ ...n }))) : [];
    this.drag = null;
    this.arrange();
  }

  private arrange(): void {
    const { song, section } = this;
    if (!song || !section) return;
    this.bars = [];
    for (let b = section.startBar; b < section.startBar + section.bars; b++) {
      this.bars.push(arrangeBar(song, b));
    }
    this.hasDrums = this.bars.some((ev) => ev.drums.length > 0);
    this.lanes = LANES.filter(
      (lane) =>
        (this.editor && lane.label === "Lead") ||
        this.bars.some((ev) => lane.tracks.some((t) => ev.notes[t].length > 0)),
    );
    this.resize();
  }

  private resize(): void {
    const lanes = this.lanes.reduce((n, lane) => n + this.laneHeight(lane), 0);
    const height = HEADER_H + (this.hasDrums ? DRUM_H : 0) + lanes + 2;
    // The editable Lead lane's top, from the layout (hit-testing can't wait for a frame).
    this.leadTop = -1;
    let y = HEADER_H + (this.hasDrums ? DRUM_H : 0);
    for (const lane of this.lanes) {
      if (this.editor && lane.label === "Lead") this.leadTop = y;
      y += this.laneHeight(lane);
    }
    this.canvas.style.height = `${height}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  private draw(): void {
    const { ctx, section, song } = this;
    if (!ctx || !section || !song) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const gridW = w - LABEL_W;
    const stepW = gridW / (section.bars * 16);
    const xAt = (bar: number, step: number) => LABEL_W + (bar * 16 + step) * stepW;
    ctx.font = "11px Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.textBaseline = "middle";

    // Bar grid with each bar's chords in the header.
    this.bars.forEach((ev, i) => {
      const x = xAt(i, 0);
      ctx.fillStyle = i % 2 ? "#ffffff05" : "#ffffff0a";
      ctx.fillRect(x, HEADER_H, 16 * stepW, h - HEADER_H);
      ctx.fillStyle = "#2a2a4a";
      ctx.fillRect(x, 0, 1, h);
      for (const slot of ev.chords) {
        const cx = xAt(i, slot.step) + 3;
        const room = slot.length * stepW - 4;
        if (room < 14) continue;
        ctx.fillStyle = "#9a97b8";
        ctx.fillText(fit(ctx, slot.name, room), cx, HEADER_H / 2);
      }
    });

    let y = HEADER_H;
    const label = (text: string, color: string, laneH: number) => {
      ctx.fillStyle = color;
      ctx.fillText(text, 8, y + laneH / 2);
      ctx.fillStyle = "#2a2a4a";
      ctx.fillRect(0, y, w, 1);
    };

    if (this.hasDrums) {
      label("Drums", "#c9c6e4", DRUM_H);
      const rowH = DRUM_H / DRUM_ROWS.length;
      this.bars.forEach((ev, i) => {
        for (const hit of ev.drums) {
          const row = DRUM_ROWS.findIndex((r) => r.voices.includes(hit.voice));
          if (row < 0) continue;
          ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, hit.vel);
          ctx.fillStyle = row === 4 ? "#ff3d8b" : row === 3 ? "#ffcf3d" : "#c9c6e4";
          ctx.fillRect(xAt(i, hit.step), y + row * rowH + 1, Math.max(2, stepW * 0.7), rowH - 2);
        }
      });
      ctx.globalAlpha = 1;
      y += DRUM_H;
    }

    for (const lane of this.lanes) {
      if (this.editor && lane.label === "Lead") {
        label("Lead ✎", lane.color, LEAD_EDIT_H);
        this.drawEditor(ctx, y, w, xAt, stepW);
        y += LEAD_EDIT_H;
        continue;
      }
      label(lane.label, lane.color, LANE_H);
      let lo = Infinity;
      let hi = -Infinity;
      for (const ev of this.bars)
        for (const t of lane.tracks)
          for (const n of ev.notes[t]) {
            lo = Math.min(lo, n.midi);
            hi = Math.max(hi, n.midi);
          }
      const span = Math.max(12, hi - lo + 1);
      const noteH = Math.max(1.5, Math.min(4, (LANE_H - 4) / span));
      const pitchY = (midi: number) =>
        y + 2 + (LANE_H - 4 - noteH) * (1 - (midi - lo) / Math.max(1, span - 1));
      ctx.fillStyle = lane.color;
      this.bars.forEach((ev, i) => {
        for (const t of lane.tracks)
          for (const n of ev.notes[t]) {
            ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, n.vel);
            const width = Math.max(1.5, n.dur * stepW - 1);
            ctx.fillRect(xAt(i, n.step), pitchY(n.midi), width, noteH);
          }
      });
      ctx.globalAlpha = 1;
      y += LANE_H;
    }

    // Playhead: interpolated from when the current bar started.
    const barSeconds = (60 / song.bpm) * 4;
    const into = this.playing
      ? Math.min(1, (performance.now() - this.barStarted) / 1000 / barSeconds)
      : 0;
    const px = xAt(this.bar - section.startBar + into, 0);
    ctx.fillStyle = "#ff3d8b";
    ctx.fillRect(px - 1, 0, 2, h);
  }

  /** Pointer position in the canvas's CSS pixels. */
  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Where the editable Lead lane starts (CSS pixels from the top), or -1. */
  get leadLaneTop(): number {
    return this.leadTop;
  }

  private laneHeight(lane: Lane): number {
    return this.editor && lane.label === "Lead" ? LEAD_EDIT_H : LANE_H;
  }

  private geometry(): RollGeometry | null {
    if (!this.section) return null;
    const stepW = (this.canvas.clientWidth - LABEL_W) / (this.section.bars * 16);
    return { stepW, xAt: (bar, step) => LABEL_W + (bar * 16 + step) * stepW };
  }

  private inLead(y: number): boolean {
    return (
      !!this.editor && this.leadTop >= 0 && y >= this.leadTop && y < this.leadTop + LEAD_EDIT_H
    );
  }

  private rowH(): number {
    return this.editor ? LEAD_EDIT_H / laneRows(this.editor) : 1;
  }

  private rowY(midi: number): number {
    const editor = this.editor;
    if (!editor) return 0;
    return this.leadTop + (editor.range[1] - midi) * this.rowH();
  }

  /** The pitch under `y`, snapped to the scale unless `free`. */
  private pitchAt(y: number, free: boolean): number {
    const editor = this.editor;
    if (!editor) return 60;
    const raw = editor.range[1] - Math.floor((y - this.leadTop) / this.rowH());
    const pitch = Math.min(editor.range[1], Math.max(editor.range[0], raw));
    if (free) return pitch;
    for (let d = 0; d < 12; d++) {
      for (const c of [pitch - d, pitch + d]) {
        if (editor.scale.includes(((c % 12) + 12) % 12)) return c;
      }
    }
    return pitch;
  }

  /** Section bar and 16th under `x`. */
  private stepAt(x: number): { bar: number; step: number } | null {
    const g = this.geometry();
    const section = this.section;
    if (!g || !section) return null;
    const at = Math.max(0, Math.min(section.bars * 16 - 1, Math.floor((x - LABEL_W) / g.stepW)));
    return { bar: Math.floor(at / 16), step: at % 16 };
  }

  /** The melody note under the pointer: its melody bar, index, and whether at its right edge. */
  private hit(x: number, y: number): { bar: number; index: number; edge: boolean } | null {
    const g = this.geometry();
    const section = this.section;
    if (!g || !section || !this.edit.length) return null;
    const rowH = this.rowH();
    for (let b = 0; b < section.bars; b++) {
      const m = b % this.edit.length;
      const notes = this.edit[m] ?? [];
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (!n) continue;
        const x0 = g.xAt(b, n.step);
        const x1 = x0 + Math.max(3, n.dur * g.stepW);
        const y0 = this.rowY(n.midi);
        if (x >= x0 && x <= x1 + 2 && y >= y0 && y <= y0 + rowH) {
          // The resize zone never takes more than a third of a short note.
          return { bar: m, index: i, edge: x >= x1 - Math.min(EDGE_PX, (x1 - x0) / 3) };
        }
      }
    }
    return null;
  }

  private pointerDown(e: PointerEvent): void {
    const { x, y } = this.local(e);
    if (!this.editor || !this.inLead(y) || e.button !== 0) return;
    const g = this.geometry();
    if (!g) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.dirty = false;
    const hit = this.hit(x, y);
    if (hit) {
      const note = this.edit[hit.bar]?.[hit.index];
      if (!note) return;
      this.drag = hit.edge
        ? { kind: "resize", bar: hit.bar, index: hit.index }
        : {
            kind: "move",
            bar: hit.bar,
            index: hit.index,
            grabStep: (x - LABEL_W) / g.stepW - this.absStep(hit.bar, note.step, x),
            startX: x,
            startY: y,
          };
      return;
    }
    // Empty spot: a new 8th note there, then drag to set its length.
    const at = this.stepAt(x);
    if (!at || !this.edit.length) return;
    const m = at.bar % this.edit.length;
    const bar = this.edit[m] ?? (this.edit[m] = []);
    bar.push({ step: at.step, dur: 2, midi: this.pitchAt(y, e.shiftKey), vel: 0.85 });
    this.dirty = true;
    this.drag = { kind: "resize", bar: m, index: bar.length - 1 };
  }

  /** The note's position in section 16ths, in the repeat under the pointer. */
  private absStep(melodyBar: number, step: number, x: number): number {
    const g = this.geometry();
    if (!g) return 0;
    const sectionBar = Math.floor((x - LABEL_W) / g.stepW / 16);
    const repeat = Math.floor(sectionBar / Math.max(1, this.edit.length));
    return (repeat * this.edit.length + melodyBar) * 16 + step;
  }

  private pointerMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const drag = this.drag;
    const g = this.geometry();
    if (!drag || !g) {
      if (this.editor && this.inLead(y)) {
        const hit = this.hit(x, y);
        this.canvas.style.cursor = hit ? (hit.edge ? "ew-resize" : "grab") : "crosshair";
      } else this.canvas.style.cursor = "";
      return;
    }
    const notes = this.edit[drag.bar];
    const note = notes?.[drag.index];
    if (!notes || !note) return;
    if (drag.kind === "resize") {
      const end = (x - LABEL_W) / g.stepW;
      const start = this.absStep(drag.bar, note.step, x);
      const dur = Math.max(1, Math.min(32, Math.round(end - start)));
      if (dur !== note.dur) this.dirty = true;
      note.dur = dur;
      return;
    }
    // Move: in time (whole 16ths, possibly into another bar of the melody) and pitch.
    const length = this.edit.length * 16;
    const at = Math.round((x - LABEL_W) / g.stepW - drag.grabStep);
    const wrapped = ((at % length) + length) % length;
    const bar = Math.floor(wrapped / 16);
    const midi = this.pitchAt(y, e.shiftKey);
    if (note.step !== wrapped % 16 || note.midi !== midi || bar !== drag.bar) this.dirty = true;
    note.step = wrapped % 16;
    note.midi = midi;
    if (bar !== drag.bar) {
      notes.splice(drag.index, 1);
      const target = this.edit[bar] ?? (this.edit[bar] = []);
      target.push(note);
      this.drag = { ...drag, bar, index: target.length - 1 };
    }
  }

  private pointerUp(): void {
    if (!this.drag || !this.editor) return;
    this.drag = null;
    this.suppressClick = true;
    if (this.dirty) this.commit();
  }

  private remove(e: MouseEvent): void {
    const { x, y } = this.local(e);
    if (!this.editor || !this.inLead(y)) return;
    const hit = this.hit(x, y);
    if (!hit) return;
    this.edit[hit.bar]?.splice(hit.index, 1);
    this.commit();
  }

  private commit(): void {
    for (const bar of this.edit) bar.sort((a, b) => a.step - b.step);
    this.editor?.commit(this.edit.map((bar) => bar.map((n) => ({ ...n }))));
  }

  private drawEditor(
    ctx: CanvasRenderingContext2D,
    top: number,
    w: number,
    xAt: (bar: number, step: number) => number,
    stepW: number,
  ): void {
    const editor = this.editor;
    const section = this.section;
    if (!editor || !section) return;
    const rowH = this.rowH();
    // Pitch rows: the scale's rows lighter, C rows marked.
    for (let p = editor.range[0]; p <= editor.range[1]; p++) {
      const y = top + (editor.range[1] - p) * rowH;
      const inScale = editor.scale.includes(((p % 12) + 12) % 12);
      ctx.fillStyle = inScale ? "#ffffff0b" : "#00000030";
      ctx.fillRect(LABEL_W, y, w - LABEL_W, rowH - 0.5);
      if (p % 12 === 0) {
        ctx.fillStyle = "#6a678a";
        ctx.fillText(`C${p / 12 - 1}`, LABEL_W - 26, y + rowH / 2);
      }
    }
    // Repeats of the melody beyond its first pass are drawn fainter.
    for (let b = 0; b < section.bars; b++) {
      const m = b % Math.max(1, this.edit.length);
      const first = b < this.edit.length;
      for (const n of this.edit[m] ?? []) {
        ctx.globalAlpha = (first ? 0.45 : 0.25) + (first ? 0.55 : 0.3) * Math.min(1, n.vel);
        ctx.fillStyle = "#f4f2ff";
        const x = xAt(b, n.step);
        ctx.fillRect(
          x,
          top + (editor.range[1] - n.midi) * rowH + 0.5,
          Math.max(3, n.dur * stepW - 1),
          rowH - 1.5,
        );
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ── Lead editing ────────────────────────────────────────────────────────────────────────────

export interface RollGeometry {
  xAt: (bar: number, step: number) => number;
  stepW: number;
}

function laneRows(editor: LeadEditor): number {
  return editor.range[1] - editor.range[0] + 1;
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}
