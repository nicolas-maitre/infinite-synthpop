/**
 * Blending a genre's references by a point inside a regular polygon, one reference per vertex.
 *
 * A point's raw weights are its Wachspress coordinates: generalized barycentric coordinates for a
 * convex polygon, which give a vertex all the weight, keep an edge to its two vertices, give the
 * centre an equal share and sum to 1. For a triangle they are plain barycentric coordinates, and
 * for two references (a segment, the slider) the linear blend.
 *
 * Plain coordinates average too much: most of a triangle's area mixes all three references, and
 * the middle of it is a bland third of each. `sharpen` raises the weights to a power and
 * renormalizes, which keeps all of the above (vertices pure, edges two-way, centre equal) but
 * spreads each reference's own region, so most of the area has one or two dominant references.
 *
 * Coordinates are SVG-style (y down), on a polygon of circumradius 1 centred on the origin. The
 * first two vertices are the bottom edge, left to right, so the first two references keep the
 * slider's left-to-right order; the others go round counterclockwise from there (on screen), so a
 * genre that lists similar references next to each other gets them on neighbouring vertices.
 */

export interface Point {
  x: number;
  y: number;
}

/** The exponent the weights are raised to (see `sharpen`), chosen from the weight maps
 * (docs/plans/generator-design.md): at 2, one reference has 60 % or more over 76 % of a triangle
 * (48 % with plain coordinates), and one or two references make up 90 % over 89 % of it (63 %),
 * while the middle still blends all three. At 3 the blends shrink to thin seams between the
 * references' regions, too narrow to aim for. */
export const SHARPNESS = 2;

export const CENTRE: Point = { x: 0, y: 0 };

/** The vertices of a regular `n`-gon (circumradius 1). n = 2 is a horizontal segment, 1 the
 * centre. */
export function polygonVertices(n: number): Point[] {
  if (n <= 1) return [{ ...CENTRE }];
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + Math.PI / n - (i * 2 * Math.PI) / n;
    return { x: clean(Math.cos(a)), y: clean(Math.sin(a)) };
  });
}

/** Rounds away float dust (cos 90° = 6e-17) so symmetric vertices compare equal. */
function clean(v: number): number {
  return Math.abs(v) < 1e-12 ? 0 : v;
}

/** Twice the signed area of the triangle a, b, c. */
function area2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/** The orientation of `polygonVertices`' winding: +1 or −1, so inside areas come out ≥ 0. */
function winding(v: readonly Point[]): number {
  const [a, b, c] = v;
  return a && b && c && area2(a, b, c) < 0 ? -1 : 1;
}

/** Is `p` inside the polygon (or on its boundary)? */
export function contains(v: readonly Point[], p: Point, eps = 1e-9): boolean {
  if (v.length < 3) return false;
  const s = winding(v);
  return v.every((a, j) => s * area2(p, a, v[(j + 1) % v.length]!) >= -eps);
}

/** The nearest point to `p` on the segment a–b. */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** `p`, or the nearest point of the polygon when it lies outside (a segment for n = 2). */
export function clampToPolygon(v: readonly Point[], p: Point): Point {
  if (v.length === 1) return { ...v[0]! };
  if (v.length === 2) return nearestOnSegment(p, v[0]!, v[1]!);
  if (contains(v, p)) return { ...p };
  let best = p;
  let bestD = Infinity;
  v.forEach((a, j) => {
    const q = nearestOnSegment(p, a, v[(j + 1) % v.length]!);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) [best, bestD] = [q, d];
  });
  return best;
}

/**
 * Wachspress coordinates of `p` (clamped into the polygon), in vertex order. Written in the
 * product form `w_i = C_i × Π_{j ∉ {i−1, i}} A_j(p)`, where A_j is the area of p and edge j and
 * C_i the area of vertex i's corner, which stays finite on the boundary.
 */
export function barycentric(v: readonly Point[], point: Point): number[] {
  const n = v.length;
  if (n === 1) return [1];
  const p = clampToPolygon(v, point);
  if (n === 2) {
    const [a, b] = v as [Point, Point];
    const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
    return [1 - t, t];
  }
  const s = winding(v);
  const at = (j: number) => v[((j % n) + n) % n]!;
  const edge = Array.from({ length: n }, (_, j) => Math.max(0, s * area2(p, at(j), at(j + 1))));
  const raw = v.map((_, i) => {
    let w = s * area2(at(i - 1), at(i), at(i + 1));
    for (let j = 0; j < n; j++) if (j !== i && j !== (i - 1 + n) % n) w *= edge[j]!;
    return w;
  });
  return normalize(raw);
}

/** Scales weights to sum to 1 (all equal when they sum to 0). */
export function normalize(w: readonly number[]): number[] {
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((x) => x / sum) : w.map(() => 1 / w.length);
}

/** Raises the weights to `power` and renormalizes: 1 changes nothing, higher values give each
 * reference more of the area around its vertex. Zero weights stay zero and equal ones equal. */
export function sharpen(w: readonly number[], power = SHARPNESS): number[] {
  return normalize(w.map((x) => Math.max(0, x) ** power));
}

/** The references' weights at a point: sharpened Wachspress coordinates. */
export function weightsAt(v: readonly Point[], p: Point, power = SHARPNESS): number[] {
  return sharpen(barycentric(v, p), power);
}

/**
 * Where weights sit: undoes the sharpening and places the point by its coordinates (Wachspress
 * coordinates reproduce linear functions, so p = Σ w_i v_i). Exact for weights `weightsAt` gave
 * on a triangle or a segment; for more vertices, weights no point gives land somewhere close.
 */
export function pointFor(
  v: readonly Point[],
  weights: readonly number[],
  power = SHARPNESS,
): Point {
  const w = normalize(v.map((_, i) => Math.max(0, weights[i] ?? 0) ** (1 / power)));
  return clampToPolygon(
    v,
    v.reduce((p, a, i) => ({ x: p.x + a.x * w[i]!, y: p.y + a.y * w[i]! }), { x: 0, y: 0 }),
  );
}

/** A uniformly random point of the polygon (a segment for n = 2), from `random()` in [0, 1). */
export function randomPoint(v: readonly Point[], random: () => number): Point {
  if (v.length === 1) return { ...v[0]! };
  if (v.length === 2) {
    const t = random();
    return { x: v[0]!.x + t * (v[1]!.x - v[0]!.x), y: v[0]!.y + t * (v[1]!.y - v[0]!.y) };
  }
  // A regular polygon is n equal triangles around the centre: pick one, then a point in it.
  const i = Math.min(v.length - 1, Math.floor(random() * v.length));
  const a = v[i]!;
  const b = v[(i + 1) % v.length]!;
  let r1 = random();
  let r2 = random();
  if (r1 + r2 > 1) [r1, r2] = [1 - r1, 1 - r2];
  return { x: r1 * a.x + r2 * b.x, y: r1 * a.y + r2 * b.y };
}

/**
 * Weights rounded to `1 / steps` (largest remainder, so they still add up to `steps` steps):
 * short in links, and they survive the link encoding exactly, so a shared song is the one that
 * played.
 */
export function quantize(w: readonly number[], steps = 100): number[] {
  const scaled = normalize(w).map((x) => x * steps);
  const floors = scaled.map(Math.floor);
  let left = steps - floors.reduce((a, b) => a + b, 0);
  const order = scaled.map((x, i) => [x - floors[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  return floors.map((k) => k / steps);
}
