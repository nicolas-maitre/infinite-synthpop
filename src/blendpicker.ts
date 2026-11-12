/**
 * The controls for blends across genres (docs/plans/cross-genre-blend.md): reference chips for an
 * open blend (any 2–10 references, whose polygon the pad then shows), and a row per part for
 * blending each part on its own.
 */
import { BlendPad, initials, weightsSummary } from "./blendpad";
import { GENRE_IDS, GENRES, genreOfReference, isGenreId, styleName, type GenreId } from "./genres";
import { CENTRE, polygonVertices, quantize, weightsAt } from "./polygon";
import { REFERENCE_IDS, refsBlend, toRefWeights, type Part, type RefWeights } from "./profile";
import type { ReferenceId } from "./references";

/** A part's own blend: a genre's polygon, or an open one over chosen references. */
export type PartValue =
  | { kind: "genre"; genre: GenreId; weights: number[] }
  | { kind: "open"; refs: ReferenceId[]; weights: number[] };

/** The parts the per-part rows set (the song part is the style pad's). */
export const PART_ROWS: readonly (readonly [Exclude<Part, "song">, string])[] = [
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["riff", "Riff & lead synth"],
  ["keys", "Keys (pads, stabs, arp)"],
  ["voice", "Voice"],
];

/** The references a value's pad shows. */
export function partRefs(v: PartValue): readonly ReferenceId[] {
  return v.kind === "genre" ? GENRES[v.genre].references : v.refs;
}

/** A value as reference weights. */
export function partBlend(v: PartValue): RefWeights {
  return v.kind === "genre"
    ? toRefWeights(GENRES[v.genre], v.weights)
    : refsBlend(v.refs, v.weights);
}

/** The centre of these references' polygon: an equal mix, rounded as the pad rounds. */
export function centreFor(refs: readonly ReferenceId[]): number[] {
  return quantize(weightsAt(polygonVertices(refs.length), CENTRE));
}

/** "TF 30 · GC 70" for weights over references. */
export function refsLabel(refs: readonly ReferenceId[], weights: readonly number[]): string {
  const names = refs.map(styleName);
  return weightsSummary(names, initials(names), weights);
}

/** References read from storage: known, unique, in reference order; null under two. */
export function parseRefs(raw: unknown): ReferenceId[] | null {
  if (!Array.isArray(raw)) return null;
  const refs = REFERENCE_IDS.filter((r) => raw.includes(r));
  return refs.length >= 2 ? refs : null;
}

/** Weights for a pad of `n` references read from storage; null if they don't fit. */
export function parsePadWeights(raw: unknown, n: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const w = raw.map(Number);
  if (!w.every((x) => Number.isFinite(x) && x >= 0) || !w.some((x) => x > 0)) return null;
  return w.map((x) => Math.min(1, x));
}

/** A part's value read from storage; null if it isn't one. */
export function parsePartValue(raw: unknown): PartValue | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind === "genre" && isGenreId(v.genre)) {
    const weights = parsePadWeights(v.weights, GENRES[v.genre].references.length);
    return weights ? { kind: "genre", genre: v.genre, weights } : null;
  }
  if (v.kind === "open") {
    const refs = parseRefs(v.refs);
    const weights = refs && parsePadWeights(v.weights, refs.length);
    return refs && weights ? { kind: "open", refs, weights } : null;
  }
  return null;
}

/**
 * Toggle chips for the ten references, grouped by genre. At least two stay picked: the pad needs
 * two vertices (one reference alone is a corner of its genre's polygon).
 */
export function refChips(
  selected: readonly ReferenceId[],
  onChange: (refs: ReferenceId[]) => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "ref-chips";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "References to blend");
  const picked = new Set(selected);
  for (const id of GENRE_IDS) {
    const group = document.createElement("div");
    group.className = "ref-chip-group";
    const name = document.createElement("span");
    name.className = "ref-chip-genre";
    name.textContent = GENRES[id].name;
    group.append(name);
    for (const ref of GENRES[id].references) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn small ref-chip";
      chip.textContent = styleName(ref);
      chip.setAttribute("aria-pressed", String(picked.has(ref)));
      chip.addEventListener("click", () => {
        if (picked.has(ref)) {
          if (picked.size <= 2) return;
          picked.delete(ref);
        } else picked.add(ref);
        chip.setAttribute("aria-pressed", String(picked.has(ref)));
        onChange(REFERENCE_IDS.filter((r) => picked.has(r)));
      });
      group.append(chip);
    }
    box.append(group);
  }
  return box;
}

/** One part's row: the style pad's blend, a genre's polygon, or an open blend, with its own pad. */
export class PartRow {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly out: HTMLOutputElement;

  constructor(
    label: string,
    private value: PartValue | null,
    private readonly onChange: (value: PartValue | null) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "part-row";
    const head = document.createElement("div");
    head.className = "row spread";
    const name = document.createElement("span");
    name.textContent = label;
    this.out = document.createElement("output");
    head.append(name, this.out);
    const pick = document.createElement("select");
    pick.setAttribute("aria-label", `${label}: blend`);
    pick.append(new Option("Same as the style", "same"));
    for (const id of GENRE_IDS) pick.append(new Option(GENRES[id].name, id));
    pick.append(new Option("Open (pick references)", "open"));
    pick.value = value?.kind === "open" ? "open" : (value?.genre ?? "same");
    pick.addEventListener("change", () => {
      const v = pick.value;
      this.value = isGenreId(v)
        ? { kind: "genre", genre: v, weights: centreFor(GENRES[v].references) }
        : v === "open"
          ? { kind: "open", refs: this.openStart(), weights: [] }
          : null;
      if (this.value?.kind === "open") this.value.weights = centreFor(this.value.refs);
      this.render();
      this.onChange(this.value);
    });
    this.body = document.createElement("div");
    this.body.className = "part-body";
    this.element.append(head, pick, this.body);
    this.render();
  }

  /** An open blend starts from the references the row showed, else two from different genres. */
  private openStart(): ReferenceId[] {
    return this.value ? [...partRefs(this.value)] : ["true-faith", "get-closer"];
  }

  private render(): void {
    const v = this.value;
    this.out.value = v ? refsLabel(partRefs(v), v.weights) : "";
    if (!v) {
      this.body.replaceChildren();
      return;
    }
    const refs = partRefs(v);
    const names = refs.map(styleName);
    const pad = new BlendPad({
      names,
      short: initials(names),
      weights: v.weights,
      label: "Part blend",
      compact: true,
      onInput: (w) => (this.out.value = refsLabel(refs, w)),
      onChange: (w) => {
        v.weights = w;
        this.out.value = refsLabel(refs, w);
        this.onChange(v);
      },
    });
    const parts: HTMLElement[] = [];
    if (v.kind === "open") {
      parts.push(
        refChips(v.refs, (picked) => {
          v.refs = picked;
          v.weights = centreFor(picked);
          this.render();
          this.onChange(v);
        }),
      );
    }
    parts.push(pad.element);
    this.body.replaceChildren(...parts);
  }
}

/** Whether a blend's references all lie on a pad's. */
export function onPad(blend: RefWeights, refs: readonly ReferenceId[]): boolean {
  return REFERENCE_IDS.every((r) => !(blend[r] ?? 0) || refs.includes(r));
}

/** A song blend's references for the pad: its genre's, or its own when they span genres. */
export function blendRefsFor(blend: RefWeights, genre: GenreId): readonly ReferenceId[] {
  const refs = REFERENCE_IDS.filter((r) => (blend[r] ?? 0) > 0);
  return new Set(refs.map(genreOfReference)).size > 1 ? refs : GENRES[genre].references;
}
