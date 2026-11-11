/**
 * Audio and drawing quality. Phones couldn't render the full synth graph in real time (the music
 * broke up), so on them the app runs "lite": a lower sample rate, thinner synth voices, fewer
 * effects, and canvases redrawn at 30 fps.
 *
 * Which one runs, first match wins: `?quality=full` or `?quality=lite` in the URL, then the
 * Performance choice saved on this device (main.ts), then the guess from the device. The choice
 * sets up the audio graph, so changing it reloads the page.
 */
export type Quality = "full" | "lite";
/** The Performance setting: "auto" follows the device guess. */
export type QualityChoice = "auto" | Quality;

const CHOICE_KEY = "infinite-synthpop:quality";

function isQuality(value: unknown): value is Quality {
  return value === "full" || value === "lite";
}

/** The quality to run: the URL's, else the saved choice, else the device's. */
export function resolveQuality(
  fromUrl: string | null,
  choice: QualityChoice,
  device: Quality,
): Quality {
  if (isQuality(fromUrl)) return fromUrl;
  return choice === "auto" ? device : choice;
}

function guessDevice(): Quality {
  const touch = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  return touch || cores <= 4 ? "lite" : "full";
}

function savedChoice(): QualityChoice {
  try {
    const saved = localStorage.getItem(CHOICE_KEY);
    return isQuality(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

const browser = typeof window !== "undefined";
const urlQuality = browser ? new URLSearchParams(location.search).get("quality") : null;

/** What this device would run on its own. */
export const DEVICE_QUALITY: Quality = browser ? guessDevice() : "full";
/** The Performance choice saved on this device. */
export const QUALITY_CHOICE: QualityChoice = browser ? savedChoice() : "auto";
/** `?quality=…` is in the URL, which wins over the saved choice. */
export const QUALITY_FROM_URL = isQuality(urlQuality);

export const QUALITY: Quality = browser
  ? resolveQuality(urlQuality, QUALITY_CHOICE, DEVICE_QUALITY)
  : "full";
export const LITE = QUALITY === "lite";

/** Saves the Performance choice on this device; it applies from the next page load. */
export function saveQualityChoice(choice: QualityChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Not saved: the device guess (or the URL) keeps deciding.
  }
}

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
