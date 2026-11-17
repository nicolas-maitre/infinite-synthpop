import type { ChordsMode } from "./composer";

/**
 * `#seed=N` links. A link without `chords` plays classic progressions, so every link shared before
 * the theory generator keeps its song; theory songs write `&chords=theory`.
 */
export function seedLink(seed: number, chords: ChordsMode): string {
  return chords === "theory" ? `#seed=${seed}&chords=theory` : `#seed=${seed}`;
}

/** The seed and progressions mode of a `#seed=` link (the hash's parameters), or null. */
export function parseSeedLink(
  params: URLSearchParams,
): { seed: number; chords: ChordsMode } | null {
  const seed = Number(params.get("seed"));
  if (!Number.isInteger(seed) || seed <= 0) return null;
  return { seed, chords: params.get("chords") === "theory" ? "theory" : "classic" };
}
