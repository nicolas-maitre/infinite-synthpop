/**
 * The style control: one draggable point inside a regular polygon with a reference at each
 * vertex (polygon.ts does the maths). A vertex is that reference alone, an edge a blend of two,
 * the centre an equal mix. With two references the polygon is a segment, so the same control is
 * a plain slider.
 *
 * Mouse, touch and pen drag the point (or tap where it should go); the arrow keys move it (Shift
 * for bigger steps), Home or a double-click puts it back in the centre, and the number keys jump to
 * a vertex. Screen readers get it as a slider whose value reads out every reference's weight.
 */
import {
  CENTRE,
  clampToPolygon,
  pointFor,
  polygonVertices,
  quantize,
  weightsAt,
  type Point,
} from "./polygon";

export interface BlendPadOptions {
  /** The references' names, in vertex order. */
  names: readonly string[];
  /** Shorter names for the vertex labels (the full ones still go to screen readers). */
  short?: readonly string[];
  weights: readonly number[];
  /** The control's accessible name. */
  label: string;
  /** Smaller, for creator mode's song settings. */
  compact?: boolean;
  /** While dragging. */
  onInput?: (weights: number[]) => void;
  /** When a drag ends, and on every key or reset. */
  onChange?: (weights: number[]) => void;
}

const SVG = "http://www.w3.org/2000/svg";
/** The polygon's circumradius in SVG units. */
const R = 100;
/** Arrow-key steps, as a share of the circumradius. */
const STEP = 0.04;
const BIG_STEP = 0.16;
/** The vertices' colours, the app's three accents in turn. */
const COLORS = ["var(--accent)", "var(--accent-2)", "var(--accent-3)"];

/** Short names for the vertices: the titles' initials, leaving out "The" ("TF", "DS", "YC"). */
export function initials(names: readonly string[]): string[] {
  return names.map((t) =>
    t
      .split(/\s+/)
      .filter((w) => w && w !== "The")
      .map((w) => w[0])
      .join(""),
  );
}

/** Readable weights, all of them: "True Faith 60 %, The Different Story 30 %, You Came 10 %". */
export function weightsText(names: readonly string[], weights: readonly number[]): string {
  return names.map((n, i) => `${n} ${Math.round((weights[i] ?? 0) * 100)} %`).join(", ");
}

/** A short summary for a readout: the one reference that has (nearly) all the weight, else the
 * ones with a real share, largest first: "TF 60 · DS 30 · YC 10". */
export function weightsSummary(
  names: readonly string[],
  short: readonly string[],
  weights: readonly number[],
): string {
  const order = names.map((_, i) => i).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const top = order[0] ?? 0;
  if ((weights[top] ?? 0) >= 0.9) return names[top] ?? "";
  return order
    .filter((i) => (weights[i] ?? 0) >= 0.05)
    .map((i) => `${short[i] ?? names[i]} ${Math.round((weights[i] ?? 0) * 100)}`)
    .join(" · ");
}

export class BlendPad {
  readonly element: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly handle: SVGCircleElement;
  private readonly spokes: SVGLineElement[];
  private readonly vertices: Point[];
  private point: Point;
  private current: number[];
  private isDisabled = false;
  private dragging: number | null = null;

  constructor(private readonly opts: BlendPadOptions) {
    const n = opts.names.length;
    this.vertices = polygonVertices(n);
    this.point = pointFor(this.vertices, opts.weights);
    this.current = this.weightsHere();

    this.element = document.createElement("div");
    this.element.className = `blendpad${opts.compact ? " compact" : ""}${n === 2 ? " segment" : ""}`;

    // The viewBox: the polygon plus room for the labels.
    const xs = this.vertices.map((v) => v.x * R);
    const ys = this.vertices.map((v) => v.y * R);
    const padX = 14;
    const padTop = n === 2 ? 14 : 26;
    const padBottom = 30;
    const box = {
      x: Math.min(...xs) - padX,
      y: Math.min(...ys) - padTop,
      w: Math.max(...xs) - Math.min(...xs) + 2 * padX,
      h: Math.max(...ys) - Math.min(...ys) + padTop + padBottom,
    };

    this.surface = document.createElement("div");
    this.surface.className = "blendpad-surface";
    this.surface.tabIndex = 0;
    this.surface.setAttribute("role", "slider");
    this.surface.setAttribute("aria-roledescription", n === 2 ? "slider" : "style picker");
    this.surface.setAttribute("aria-label", opts.label);
    this.surface.setAttribute("aria-valuemin", "0");
    this.surface.setAttribute("aria-valuemax", "100");
    this.surface.title = `${opts.label}: drag the point (arrow keys move it, Home or a double-click centres it)`;

    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
    svg.setAttribute("aria-hidden", "true");
    this.svg = svg;

    const uid = Math.random().toString(36).slice(2, 8);
    const defs = document.createElementNS(SVG, "defs");
    const outline = this.vertices.map((v) => `${v.x * R},${v.y * R}`).join(" ");
    if (n >= 3) {
      const clip = svgEl("clipPath", { id: `bp-clip-${uid}` });
      clip.append(svgEl("polygon", { points: outline }));
      defs.append(clip);
    }
    this.vertices.forEach((_, i) => {
      const g = svgEl("radialGradient", { id: `bp-glow-${uid}-${i}` });
      g.append(
        // CSS variables work in style, not in presentation attributes.
        svgEl("stop", { offset: "0", style: `stop-color: ${color(i)}; stop-opacity: 0.5` }),
        svgEl("stop", { offset: "1", style: `stop-color: ${color(i)}; stop-opacity: 0` }),
      );
      defs.append(g);
    });
    svg.append(defs);

    if (n >= 3) {
      svg.append(svgEl("polygon", { points: outline, class: "blendpad-face" }));
      // Each reference's corner glows in its colour, about as far as it dominates.
      const glows = svgEl("g", { "clip-path": `url(#bp-clip-${uid})` });
      this.vertices.forEach((v, i) =>
        glows.append(
          svgEl("circle", {
            cx: String(v.x * R),
            cy: String(v.y * R),
            r: String(R * 1.15),
            fill: `url(#bp-glow-${uid}-${i})`,
          }),
        ),
      );
      svg.append(glows);
      for (const v of this.vertices)
        svg.append(
          svgEl("line", {
            x1: "0",
            y1: "0",
            x2: String(v.x * R),
            y2: String(v.y * R),
            class: "blendpad-guide",
          }),
        );
      svg.append(svgEl("polygon", { points: outline, class: "blendpad-edge" }));
      svg.append(svgEl("circle", { cx: "0", cy: "0", r: "2.5", class: "blendpad-centre" }));
    } else if (n === 2) {
      const [a, b] = this.vertices as [Point, Point];
      svg.append(
        svgEl("line", {
          x1: String(a.x * R),
          y1: "0",
          x2: String(b.x * R),
          y2: "0",
          class: "blendpad-track",
        }),
        svgEl("circle", { cx: "0", cy: "0", r: "2.5", class: "blendpad-centre" }),
      );
    }

    // Lines from the point to each vertex, as strong as that reference's weight.
    this.spokes = this.vertices.map((_, i) => {
      const line = svgEl("line", { class: "blendpad-spoke", style: `stroke: ${color(i)}` });
      if (n >= 3) svg.append(line);
      return line;
    });
    this.vertices.forEach((v, i) =>
      svg.append(
        svgEl("circle", {
          cx: String(v.x * R),
          cy: String(v.y * R),
          r: "5",
          style: `fill: ${color(i)}`,
          class: "blendpad-vertex",
        }),
      ),
    );
    this.handle = svgEl("circle", { r: opts.compact ? "10" : "9", class: "blendpad-handle" });
    svg.append(this.handle);
    this.surface.append(svg);

    // The labels are HTML, so they stay crisp and readable at any size.
    this.vertices.forEach((v, i) => {
      const label = document.createElement("span");
      label.className = "blendpad-label";
      label.textContent = (opts.short ?? opts.names)[i] ?? "";
      if (opts.short) label.title = opts.names[i] ?? "";
      label.style.left = `${((v.x * R - box.x) / box.w) * 100}%`;
      label.style.top = `${((v.y * R - box.y) / box.h) * 100}%`;
      label.dataset.anchor =
        v.y < -0.3
          ? "above"
          : v.y > 0.3 || n === 2
            ? v.x < -0.3
              ? "below-start"
              : v.x > 0.3
                ? "below-end"
                : "below"
            : v.x < 0
              ? "left"
              : "right";
      this.surface.append(label);
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn small blendpad-reset";
    reset.textContent = opts.compact ? "⊙" : "⊙ Centre";
    reset.title = n === 2 ? "Back to the middle" : "Back to the centre (an equal mix)";
    reset.setAttribute("aria-label", reset.title);
    reset.addEventListener("click", () => this.moveTo(CENTRE, true));
    this.element.append(this.surface, reset);

    this.listen();
    this.draw();
  }

  get weights(): number[] {
    return [...this.current];
  }

  /** Moves the point to where these weights sit (no events). */
  setWeights(weights: readonly number[]): void {
    if (this.dragging !== null) return;
    this.point = pointFor(this.vertices, weights);
    this.current = this.weightsHere();
    this.draw();
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  set disabled(on: boolean) {
    this.isDisabled = on;
    this.element.classList.toggle("disabled", on);
    this.surface.tabIndex = on ? -1 : 0;
    this.surface.setAttribute("aria-disabled", String(on));
    const reset = this.element.querySelector("button");
    if (reset) reset.disabled = on;
  }

  focus(): void {
    this.surface.focus();
  }

  private weightsHere(): number[] {
    return quantize(weightsAt(this.vertices, this.point));
  }

  /** Moves the point (clamped into the polygon) and tells the listeners. */
  private moveTo(p: Point, commit: boolean): void {
    if (this.isDisabled) return;
    this.point = clampToPolygon(this.vertices, p);
    const before = this.current;
    this.current = this.weightsHere();
    this.draw();
    if (commit) this.opts.onChange?.(this.weights);
    else if (before.some((w, i) => w !== this.current[i])) this.opts.onInput?.(this.weights);
  }

  /** A pointer's position in polygon units (circumradius 1). */
  private toPoint(e: PointerEvent | MouseEvent): Point {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    return {
      x: (vb.x + ((e.clientX - rect.left) / rect.width) * vb.width) / R,
      y: (vb.y + ((e.clientY - rect.top) / rect.height) * vb.height) / R,
    };
  }

  private listen(): void {
    const s = this.surface;
    s.addEventListener("pointerdown", (e) => {
      if (this.isDisabled || e.button !== 0) return;
      e.preventDefault();
      // Keyboard focus for the arrow keys, without the keyboard focus ring.
      s.focus({ focusVisible: false } as FocusOptions);
      this.dragging = e.pointerId;
      s.setPointerCapture(e.pointerId);
      this.element.classList.add("dragging");
      this.moveTo(this.toPoint(e), false);
    });
    s.addEventListener("pointermove", (e) => {
      if (this.dragging === e.pointerId) this.moveTo(this.toPoint(e), false);
    });
    const end = (e: PointerEvent) => {
      if (this.dragging !== e.pointerId) return;
      this.dragging = null;
      this.element.classList.remove("dragging");
      if (e.type === "pointerup") this.moveTo(this.toPoint(e), true);
      else this.opts.onChange?.(this.weights);
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.moveTo(CENTRE, true);
    });
    s.addEventListener("keydown", (e) => {
      if (this.isDisabled || e.altKey || e.ctrlKey || e.metaKey) return;
      const step = e.shiftKey ? BIG_STEP : STEP;
      const { x, y } = this.point;
      const segment = this.vertices.length === 2;
      let to: Point | null = null;
      if (e.key === "ArrowLeft") to = { x: x - step, y };
      else if (e.key === "ArrowRight") to = { x: x + step, y };
      // On a segment, up and down move along it, as on a slider.
      else if (e.key === "ArrowUp") to = segment ? { x: x + step, y } : { x, y: y - step };
      else if (e.key === "ArrowDown") to = segment ? { x: x - step, y } : { x, y: y + step };
      else if (e.key === "Home") to = CENTRE;
      else if (/^[1-9]$/.test(e.key)) to = this.vertices[Number(e.key) - 1] ?? null;
      if (!to) return;
      e.preventDefault();
      this.moveTo(to, true);
    });
  }

  private draw(): void {
    const { x, y } = this.point;
    this.handle.setAttribute("cx", String(x * R));
    this.handle.setAttribute("cy", String(y * R));
    this.spokes.forEach((line, i) => {
      const v = this.vertices[i]!;
      const w = this.current[i] ?? 0;
      line.setAttribute("x1", String(x * R));
      line.setAttribute("y1", String(y * R));
      line.setAttribute("x2", String(v.x * R));
      line.setAttribute("y2", String(v.y * R));
      line.setAttribute("stroke-width", String(0.5 + w * 4));
      line.setAttribute("stroke-opacity", String(0.15 + w * 0.75));
    });
    const top = Math.max(...this.current);
    this.surface.setAttribute("aria-valuenow", String(Math.round(top * 100)));
    this.surface.setAttribute("aria-valuetext", weightsText(this.opts.names, this.current));
  }
}

function color(i: number): string {
  return COLORS[i % COLORS.length]!;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
