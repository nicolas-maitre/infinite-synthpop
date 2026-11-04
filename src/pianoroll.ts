/**
 * The current section as a piano roll: one lane per instrument that plays in it, notes placed by
 * pitch within the lane's own range, drums on per-voice rows, the chords over each bar, and a
 * playhead that moves across. Everything comes from arrangeBar, so it shows exactly what plays
 * (generated parts, MIDI-imported parts and creator edits alike).
 */
import { arrangeBar, type BarEvents, type DrumVoice, type MelodicTrack } from "./arranger";
import type { Section, Song } from "./composer";

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onSeek: (bar: number) => void,
  ) {
    this.ctx = canvas.getContext("2d");
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("click", (e) => {
      if (!this.section) return;
      const x = e.offsetX - LABEL_W;
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

  private arrange(): void {
    const { song, section } = this;
    if (!song || !section) return;
    this.bars = [];
    for (let b = section.startBar; b < section.startBar + section.bars; b++) {
      this.bars.push(arrangeBar(song, b));
    }
    this.hasDrums = this.bars.some((ev) => ev.drums.length > 0);
    this.lanes = LANES.filter((lane) =>
      this.bars.some((ev) => lane.tracks.some((t) => ev.notes[t].length > 0)),
    );
    this.resize();
  }

  private resize(): void {
    const height =
      HEADER_H + (this.hasDrums ? DRUM_H : 0) + this.lanes.length * LANE_H + 2 || HEADER_H;
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
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}
