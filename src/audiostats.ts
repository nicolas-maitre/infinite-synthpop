/**
 * A small audio stats readout, shown with `?stats` or `?latency=…` (quality.ts), for checking
 * playback on a phone: the sample rate and buffer the browser actually gave us, and how far the
 * audio clock has fallen behind the wall clock while playing. The audio clock only counts audio
 * that was rendered, so time it loses is time the speaker had nothing to play: the breakups. It
 * wobbles by about a buffer either way; a figure that keeps growing means the audio can't keep up.
 */
import * as Tone from "tone";
import { LATENCY, QUALITY } from "./quality";

const UPDATE_MS = 500;
/** Ignore the first seconds after the context starts: loading samples stalls it once. */
const SETTLE_MS = 3000;

export function mountAudioStats(): void {
  const box = document.createElement("pre");
  box.className = "audio-stats";
  box.setAttribute("aria-live", "off");
  document.body.append(box);

  let context: BaseAudioContext | undefined;
  let lastWall = 0;
  let lastAudio = 0;
  let behindMs = 0;
  let worstMs = 0;
  let stalls = 0;
  let runningSince = 0;

  const update = () => {
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    const wall = performance.now();
    const audio = raw.currentTime * 1000;
    if (raw !== context) {
      context = raw;
      behindMs = worstMs = stalls = runningSince = 0;
    } else if (raw.state !== "running") {
      runningSince = 0;
    } else if (!runningSince) {
      runningSince = wall;
    } else if (wall - runningSince > SETTLE_MS) {
      const lost = wall - lastWall - (audio - lastAudio);
      behindMs = Math.max(0, behindMs + lost);
      // A loss bigger than the buffer can't be clock wobble.
      const buffer = (raw.baseLatency || 0) * 1000 + 20;
      if (lost > buffer) stalls++;
      worstMs = Math.max(worstMs, behindMs);
    }
    lastWall = wall;
    lastAudio = audio;
    // Firefox reports 0 for both.
    const ms = (s: number | undefined) => (s ? `${Math.round(s * 1000)} ms` : "not reported");
    box.textContent = [
      `${QUALITY} · ${raw.sampleRate} Hz · ${raw.state}`,
      `asked ${LATENCY === undefined ? "playback" : `${LATENCY * 1000} ms`}`,
      `buffer ${ms(raw.baseLatency)}${raw.outputLatency ? ` · out ${ms(raw.outputLatency)}` : ""}`,
      `behind ${Math.round(behindMs)} ms (max ${Math.round(worstMs)})`,
      `stalls ${stalls}`,
    ].join("\n");
  };
  update();
  setInterval(update, UPDATE_MS);
}
