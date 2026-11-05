/**
 * Audio and drawing quality. Phones couldn't render the full synth graph in real time (the music
 * broke up), so on them the app runs "lite": a lower sample rate, thinner synth voices, fewer
 * effects, and canvases redrawn at 30 fps. `?quality=full` or `?quality=lite` overrides the guess.
 */
export type Quality = "full" | "lite";

function detect(): Quality {
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced === "full" || forced === "lite") return forced;
  const touch = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  return touch || cores <= 4 ? "lite" : "full";
}

export const QUALITY: Quality = typeof window === "undefined" ? "full" : detect();
export const LITE = QUALITY === "lite";

/** Audio sample rate in lite mode: 16 kHz of bandwidth is plenty for these voices, at two thirds
 * of the DSP cost of 48 kHz. */
export const LITE_SAMPLE_RATE = 32000;

/**
 * Audio output buffer to ask for, in seconds, from `?latency=0.5`. Unset, the context asks for the
 * browser's "playback" default. A bigger buffer rides out short audio-thread stalls, not a graph
 * that is too heavy to render in real time. `?latency` also shows the audio stats readout.
 */
export const LATENCY: number | undefined = (() => {
  if (typeof window === "undefined") return undefined;
  const value = Number(new URLSearchParams(location.search).get("latency"));
  return value > 0 && value <= 2 ? value : undefined;
})();

/** Show the audio stats readout (`?stats` or `?latency=…`). */
export const SHOW_AUDIO_STATS =
  typeof window !== "undefined" && /[?&](stats|latency)\b/.test(location.search);

/**
 * Calls `draw` every animation frame, or every other one in lite mode (about 30 fps).
 * `draw` gets the frame's timestamp.
 */
export function animate(draw: (t: number) => void): void {
  const minGap = LITE ? 1000 / 30 - 4 : 0;
  let last = -Infinity;
  const frame = (t: number) => {
    if (t - last >= minGap) {
      last = t;
      draw(t);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
