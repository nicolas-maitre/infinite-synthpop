/** Spectrum bars with a waveform trace on top, drawn every animation frame. */
import type * as Tone from "tone";

export function startVisualizer(
  canvas: HTMLCanvasElement,
  getAnalysers: () => { fft: Tone.Analyser; waveform: Tone.Analyser } | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
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
      requestAnimationFrame(draw);
      return;
    }

    const fft = analysers.fft.getValue() as Float32Array;
    const bins = Math.floor(fft.length * 0.7);
    const barW = w / bins;
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#ff3d8b");
    grad.addColorStop(0.6, "#ffcf3d");
    grad.addColorStop(1, "#39d0ff");
    ctx.fillStyle = grad;
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
    for (let i = 0; i < wave.length; i++) {
      const x = (i / (wave.length - 1)) * w;
      const y = h / 2 - (wave[i] ?? 0) * h * 0.45;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
