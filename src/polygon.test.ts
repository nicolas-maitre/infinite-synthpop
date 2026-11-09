import { describe, expect, it } from "vitest";
import {
  barycentric,
  CENTRE,
  clampToPolygon,
  contains,
  pointFor,
  polygonVertices,
  quantize,
  randomPoint,
  sharpen,
  SHARPNESS,
  weightsAt,
  type Point,
} from "./polygon";
import { createRng } from "./rng";

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const sum = (w: readonly number[]) => w.reduce((a, b) => a + b, 0);

describe("polygon weights", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const v = polygonVertices(n);

    describe(`${n} references`, () => {
      it("gives a vertex all the weight", () => {
        v.forEach((p, i) => {
          const w = weightsAt(v, p);
          expect(w[i]).toBeCloseTo(1, 12);
          expect(sum(w)).toBeCloseTo(1, 12);
        });
      });

      it("blends only the two references along an edge", () => {
        const edges = n === 2 ? 1 : n;
        for (let i = 0; i < edges; i++) {
          const j = (i + 1) % n;
          for (const t of [0.1, 0.25, 0.5, 0.8]) {
            const w = weightsAt(v, lerp(v[i]!, v[j]!, t));
            w.forEach((x, k) => {
              if (k !== i && k !== j) expect(x).toBeCloseTo(0, 12);
            });
            expect(w[i]! + w[j]!).toBeCloseTo(1, 12);
            // Moving toward j gives j more.
            if (t !== 0.5) expect(w[j]! > w[i]!).toBe(t > 0.5);
          }
          // The midpoint is an even two-way blend.
          const mid = weightsAt(v, lerp(v[i]!, v[j]!, 0.5));
          expect(mid[i]).toBeCloseTo(0.5, 12);
          expect(mid[j]).toBeCloseTo(0.5, 12);
        }
      });

      it("mixes all of them equally at the centre", () => {
        for (const w of [weightsAt(v, CENTRE), barycentric(v, CENTRE)])
          for (const x of w) expect(x).toBeCloseTo(1 / n, 12);
      });

      it("sums to 1 everywhere, with no negative weight, and clamps points outside", () => {
        const rng = createRng(n);
        for (let k = 0; k < 500; k++) {
          const p = { x: rng.next() * 3 - 1.5, y: rng.next() * 3 - 1.5 };
          const w = weightsAt(v, p);
          expect(sum(w)).toBeCloseTo(1, 12);
          for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
          expect(w).toEqual(weightsAt(v, clampToPolygon(v, p)));
        }
      });

      it("places random points inside, spread over every reference", () => {
        const rng = createRng(100 + n);
        const top = new Array<number>(n).fill(0);
        for (let k = 0; k < 2000; k++) {
          const p = randomPoint(v, () => rng.next());
          if (n > 2) expect(contains(v, p, 1e-9)).toBe(true);
          const w = weightsAt(v, p);
          top[w.indexOf(Math.max(...w))]!++;
        }
        for (const c of top) expect(c / 2000).toBeGreaterThan(0.6 / n);
      });
    });
  }

  it("is plain barycentric on a triangle, and puts the first two references on the bottom edge", () => {
    const v = polygonVertices(3);
    expect(v[0]!.x).toBeLessThan(0);
    expect(v[1]!.x).toBeGreaterThan(0);
    expect(v[0]!.y).toBeCloseTo(v[1]!.y, 12);
    expect(v[2]!.y).toBeLessThan(v[0]!.y);
    // A point a quarter of the way from the centre to vertex 2 (the bary coords are linear).
    const p = lerp(CENTRE, v[2]!, 0.25);
    const b = barycentric(v, p);
    expect(b[2]).toBeCloseTo(1 / 3 + 0.25 * (2 / 3), 12);
    expect(b[0]).toBeCloseTo(b[1]!, 12);
  });

  it("sharpens without moving vertices, edges or the centre", () => {
    expect(sharpen([1, 0, 0])).toEqual([1, 0, 0]);
    expect(sharpen([0.5, 0.5, 0])).toEqual([0.5, 0.5, 0]);
    const third = sharpen([1 / 3, 1 / 3, 1 / 3]);
    for (const x of third) expect(x).toBeCloseTo(1 / 3, 12);
    const w = sharpen([0.6, 0.3, 0.1], 2);
    expect(w[0]).toBeCloseTo(0.36 / 0.46, 12);
    sharpen([0.6, 0.3, 0.1], 1).forEach((x, i) => expect(x).toBeCloseTo([0.6, 0.3, 0.1][i]!, 12));
    expect(SHARPNESS).toBeGreaterThan(1);
  });

  it("finds the point back from its weights", () => {
    for (const n of [2, 3]) {
      const v = polygonVertices(n);
      const rng = createRng(7);
      for (let k = 0; k < 200; k++) {
        const p = randomPoint(v, () => rng.next());
        const q = pointFor(v, weightsAt(v, p));
        expect(q.x).toBeCloseTo(p.x, 9);
        expect(q.y).toBeCloseTo(p.y, 9);
      }
    }
    const v = polygonVertices(3);
    expect(pointFor(v, [1, 0, 0])).toEqual(v[0]);
    const c = pointFor(v, [1 / 3, 1 / 3, 1 / 3]);
    expect(c.x).toBeCloseTo(0, 12);
    expect(c.y).toBeCloseTo(0, 12);
  });

  it("rounds weights to hundredths that still add up", () => {
    expect(quantize([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + Math.round(b * 100), 0)).toBe(100);
    expect(quantize([0.555, 0.445, 0])).toEqual([0.56, 0.44, 0]);
    expect(quantize([1, 0, 0])).toEqual([1, 0, 0]);
    // Hundredths survive JSON as they are.
    const w = quantize([0.123456, 0.654321, 0.222223]);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    expect(w.map((x) => Math.round(x * 100) / 100)).toEqual(w);
  });
});
