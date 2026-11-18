/**
 * The length setting's control: two handles on one track (shortest, longest), kept a step apart,
 * with the range spelled out. The simple and advanced views each have one (simpleview.ts,
 * main.ts).
 */
import type { LengthRange } from "./composer";
import { LENGTH_BOUNDS } from "./prefs";

/** 83 → "1:23". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class LengthSlider {
  readonly element: HTMLElement;
  private readonly lo: HTMLInputElement;
  private readonly hi: HTMLInputElement;
  private readonly out: HTMLOutputElement;
  private readonly fill: HTMLElement;

  /** `id` names the label; `onChange` hears a handle let go. */
  constructor(id: string, onChange: (range: LengthRange) => void) {
    this.element = document.createElement("div");
    this.element.className = "field length-field";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-labelledby", id);

    const head = document.createElement("span");
    head.className = "row spread";
    const name = document.createElement("span");
    name.id = id;
    name.textContent = "Length";
    this.out = document.createElement("output");
    head.append(name, this.out);

    const track = document.createElement("div");
    track.className = "dual-range";
    this.fill = document.createElement("div");
    this.fill.className = "dual-range-fill";
    const handle = (label: string) => {
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(LENGTH_BOUNDS.min);
      input.max = String(LENGTH_BOUNDS.max);
      input.step = String(LENGTH_BOUNDS.step);
      input.setAttribute("aria-label", label);
      return input;
    };
    this.lo = handle("Shortest");
    this.hi = handle("Longest");
    track.append(this.fill, this.lo, this.hi);

    const note = document.createElement("span");
    note.className = "note";
    note.textContent =
      "How long songs run: each song gets the form that fits best, and in DJ mode it mixes out in this range. From the next song.";
    this.element.append(head, track, note);

    for (const input of [this.lo, this.hi]) {
      input.addEventListener("input", () => {
        this.keepApart(input);
        this.show();
      });
      input.addEventListener("change", () => onChange(this.range));
    }
  }

  get range(): LengthRange {
    return { min: Number(this.lo.value), max: Number(this.hi.value) };
  }

  set(range: LengthRange): void {
    this.lo.value = String(range.min);
    this.hi.value = String(range.max);
    this.show();
  }

  private keepApart(moved: HTMLInputElement): void {
    const { min, max } = this.range;
    if (max - min >= LENGTH_BOUNDS.step) return;
    if (moved === this.lo) this.lo.value = String(max - LENGTH_BOUNDS.step);
    else this.hi.value = String(min + LENGTH_BOUNDS.step);
  }

  private show(): void {
    const { min, max } = this.range;
    const at = (v: number) =>
      ((v - LENGTH_BOUNDS.min) / (LENGTH_BOUNDS.max - LENGTH_BOUNDS.min)) * 100;
    this.fill.style.left = `${at(min)}%`;
    this.fill.style.width = `${at(max) - at(min)}%`;
    this.out.value = `${clock(min)} – ${clock(max)}`;
    this.lo.setAttribute("aria-valuetext", clock(min));
    this.hi.setAttribute("aria-valuetext", clock(max));
  }
}
