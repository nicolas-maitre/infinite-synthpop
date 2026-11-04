/** Small seeded PRNG (mulberry32) so every song is reproducible from its seed. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  /** Independent stream derived from this seed and a label, so adding draws to one part of the
   * composer doesn't reshuffle the others. */
  fork(label: string): Rng;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items) => {
      const total = items.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= Math.max(0, w);
        if (r < 0) return item;
      }
      const last = items[items.length - 1];
      if (!last) throw new Error("weighted pick from empty list");
      return last[0];
    },
    fork: (label) => createRng((seed ^ hashString(label)) >>> 0),
  };
  return rng;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
