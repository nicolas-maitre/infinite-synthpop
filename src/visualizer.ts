/** Spectrum bars with a waveform trace on top, drawn every animation frame. */
import type * as Tone from "tone";
import { animate, LITE } from "./quality";

/** Waveform points drawn (of the analyser's 1024). */
const WAVE_POINTS = LITE ? 256 : 1024;

export function startVisualizer(
  canvas: HTMLCanvasElement,
  getAnalysers: () => { fft: Tone.Analyser; waveform: Tone.Analyser } | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let grad: CanvasGradient | null = null;
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
    grad.addColorStop(0, "#ff3d8b");
    grad.addColorStop(0.6, "#ffcf3d");
    grad.addColorStop(1, "#39d0ff");
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const draw = (t: number) => {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const analysers = getAnalysers();

    if (!analysers) {
      // Idle: a slow sine so the panel doesn't look broken before the first play.
      ctx.strokeStyle = "#39d0ff55";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + Math.sin(x / 40 + t / 600) * h * 0.08;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    const fft = analysers.fft.getValue() as Float32Array;
    // Up to about 15 kHz, whatever the sample rate (lite mode runs lower).
    const nyquist = analysers.fft.context.sampleRate / 2;
    const bins = Math.floor(fft.length * Math.min(1, 15400 / nyquist));
    const barW = w / bins;
    if (grad) ctx.fillStyle = grad;
    for (let i = 0; i < bins; i++) {
      const db = fft[i] ?? -140;
      const v = Math.max(0, Math.min(1, (db + 100) / 80));
      const bh = v * h * 0.95;
      ctx.fillRect(i * barW + 1, h - bh, Math.max(1, barW - 2), bh);
    }

    const wave = analysers.waveform.getValue() as Float32Array;
    ctx.strokeStyle = "#ffffffcc";
    ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    const stride = wave.length / WAVE_POINTS;
    for (let i = 0; i < WAVE_POINTS; i++) {
      const x = (i / (WAVE_POINTS - 1)) * w;
      const y = h / 2 - (wave[Math.floor(i * stride)] ?? 0) * h * 0.45;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  animate(draw);
}
