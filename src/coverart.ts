/**
 * Draws the sleeves cover.ts describes on a canvas, keeps them by song, and puts them where the
 * player shows a song: the now-playing sleeve, the mini player, the lists' thumbnails and the
 * system media controls. An original shows its real sleeve (the Cover Art Archive's, as in the
 * "Inspired by" panel) over a tile of its colour.
 *
 * Everything is drawn in a 1000-unit square scaled to the canvas; blurs and grain, which canvas
 * doesn't scale, are set in device pixels.
 */
import {
  describeSleeve,
  mix,
  neon,
  RECORD_COLOURS,
  creationCover,
  type ChromeMotif,
  type CoverSong,
  type Face,
  type MinimalMotif,
  type NeonMotif,
  type Sleeve,
} from "./cover";
import { coverUrl } from "./influence";
import type { ReferenceId } from "./references";
import { createRng } from "./rng";
import { decodeCreation } from "./spec";

const U = 1000;

const FACES: Record<Face, string> = {
  grotesk: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  geometric: 'Futura, "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif',
  serif: 'Didot, "Bodoni 72", "Bodoni MT", "Times New Roman", serif',
  script: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive',
  condensed: '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif',
};
const FINE = FACES.grotesk;
const PAPER = "#efe9df";
const NIGHT = "#06020f";

type Ctx = CanvasRenderingContext2D;

/** Device pixels per unit, for what canvas doesn't scale (shadow blur and offsets). */
let k = 1;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function glow(ctx: Ctx, colour: string, blur: number): void {
  ctx.shadowColor = colour;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
}

function noGlow(ctx: Ctx): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

/** A soft spot of colour fading out. */
function spot(ctx: Ctx, x: number, y: number, r: number, colour: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(colour, a));
  g.addColorStop(1, rgba(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Chrome: the sky above the horizon, the desert below, tinted. */
function chromeGradient(ctx: Ctx, y0: number, y1: number, tint: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mix("#0f1d44", tint, 0.3));
  g.addColorStop(0.44, mix("#b4defd", tint, 0.2));
  g.addColorStop(0.5, "#ffffff");
  g.addColorStop(0.53, "#2b1a10");
  g.addColorStop(0.72, "#b8773f");
  g.addColorStop(1, "#fff0d2");
  return g;
}

// ── Synthpop ─────────────────────────────────────────────────────────────────────────────────

function drawMinimal(ctx: Ctx, s: Sleeve, m: MinimalMotif): void {
  const p = s.palette;
  ctx.fillStyle = p.ground;
  ctx.fillRect(0, 0, U, U);
  // The cloth, photographed: soft folds of light and shade.
  for (const f of m.folds) {
    const tone =
      f.shade > 0 ? mix(p.ground, "#ffffff", f.shade) : mix(p.ground, "#000000", -f.shade);
    spot(ctx, f.at.x * U, f.at.y * U, f.r * U, tone, 0.85);
  }
  const light = ctx.createLinearGradient(0, 0, U, U);
  light.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  light.addColorStop(1, "rgba(0, 0, 0, 0.16)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, U, U);

  const x = m.at.x * U;
  const y = m.at.y * U;
  const size = m.size * U;
  const second = p.accents[0];
  if (m.object === "disc") {
    const r = size * 0.8;
    ctx.fillStyle = p.ink;
    circle(ctx, x, y, r);
    ctx.fill();
    if (m.angle > 0) {
      ctx.strokeStyle = rgba(p.ink, 0.55);
      ctx.lineWidth = 2;
      circle(ctx, x, y, r * 1.32);
      ctx.stroke();
    }
    // The second record, as a smaller disc by its share, just touching.
    if (second) {
      const r2 = r * Math.max(0.12, Math.sqrt(second.share));
      const a = m.angle * 2 + Math.PI * 0.25;
      ctx.fillStyle = second.colour;
      circle(ctx, x + Math.cos(a) * (r + r2), y + Math.sin(a) * (r + r2), r2);
      ctx.fill();
    }
  } else if (m.object === "code") {
    // A block per record, as wide as its share: the blend, as a colour code.
    const rest = p.accents.reduce((n, a) => n + a.share, 0);
    const blocks = [{ colour: p.ink, share: Math.max(0.15, 1 - rest) }, ...p.accents];
    const total = blocks.reduce((n, b) => n + b.share, 0);
    const gap = 8;
    const width = size - gap * (blocks.length - 1);
    let at = x - size / 2;
    const h = 30;
    ctx.font = `500 13px ${FINE}`;
    ctx.textBaseline = "alphabetic";
    for (const b of blocks) {
      const w = (b.share / total) * width;
      ctx.fillStyle = b.colour;
      ctx.fillRect(at, y - h / 2, Math.max(4, w), h);
      ctx.fillStyle = rgba(p.text, 0.7);
      ctx.fillText(String(Math.round((b.share / total) * 100)), at, y + h / 2 + 22);
      at += w + gap;
    }
    ctx.fillStyle = rgba(p.text, 0.45);
    ctx.fillRect(x - size / 2, y - h / 2 - 22, size, 1.5);
  } else if (m.object === "arc") {
    // A quarter circle rising from the corner nearest the point, with its echoes.
    const cx = m.at.x > 0.5 ? U : 0;
    const cy = m.at.y > 0.5 ? U : 0;
    const r = size * 1.05;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, mix(p.ink, "#ffffff", 0.12));
    g.addColorStop(1, mix(p.ink, p.ground, 0.25));
    ctx.fillStyle = g;
    circle(ctx, cx, cy, r);
    ctx.fill();
    ctx.lineWidth = 2;
    for (const [i, c] of [p.ink, second?.colour ?? p.ink].entries()) {
      ctx.strokeStyle = rgba(c, 0.6 - i * 0.2);
      circle(ctx, cx, cy, r * (1.1 + i * 0.1));
      ctx.stroke();
    }
  } else {
    // A floating petal, lit from above, its shadow on the cloth.
    const l = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(m.angle);
    ctx.beginPath();
    ctx.moveTo(-l / 2, 0);
    ctx.bezierCurveTo(-l / 4, -l * 0.3, l / 4, -l * 0.24, l / 2, -l * 0.05);
    ctx.bezierCurveTo(l / 5, l * 0.1, -l / 5, l * 0.12, -l / 2, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -l * 0.25, 0, l * 0.12);
    g.addColorStop(0, mix(p.ink, "#fff6d8", 0.3));
    g.addColorStop(0.55, p.ink);
    g.addColorStop(1, mix(p.ink, "#3a1a00", 0.45));
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 36 * k;
    ctx.shadowOffsetX = 18 * k;
    ctx.shadowOffsetY = 34 * k;
    ctx.fill();
    noGlow(ctx);
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    ctx.strokeStyle = rgba(mix(p.ink, "#ffffff", 0.5), 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-l * 0.44, -l * 0.01);
    ctx.quadraticCurveTo(0, -l * 0.1, l * 0.44, -l * 0.055);
    ctx.stroke();
    ctx.restore();
  }
  if (m.rule) {
    ctx.fillStyle = rgba(p.text, 0.35);
    ctx.fillRect(64, s.type.anchor.startsWith("t") ? U - 64 : 64, U - 128, 1.5);
  }
}

// ── Italo ────────────────────────────────────────────────────────────────────────────────────

/** A perspective grid from the horizon down. */
function grid(ctx: Ctx, horizon: number, vx: number, colour: string, lit: boolean, a = 1): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, U, U - horizon);
  ctx.clip();
  ctx.strokeStyle = rgba(colour, a);
  ctx.lineWidth = lit ? 2.6 : 2;
  if (lit) glow(ctx, colour, 14);
  ctx.beginPath();
  for (let i = -16; i <= 16; i++) {
    ctx.moveTo(vx + i * 14, horizon);
    ctx.lineTo(vx + i * 150, U + 40);
  }
  for (let j = 1; j <= 11; j++) {
    const y = horizon + (U - horizon) * (j / 11) ** 2.1;
    ctx.moveTo(0, y);
    ctx.lineTo(U, y);
  }
  ctx.stroke();
  noGlow(ctx);
  ctx.restore();
}

function drawNeon(ctx: Ctx, s: Sleeve, m: NeonMotif): void {
  const p = s.palette;
  const H = m.horizon * U;
  const tube = neon(p.ink);
  const tube2 = neon(p.accents[0]?.colour ?? mix(p.ink, "#00e5ff", 0.6));

  if (m.scene === "airbrush") {
    // A pastel day, airbrushed: soft bands, a shaded shape with a hard outline beside it.
    const sky = ctx.createLinearGradient(0, 0, U * 0.4, U);
    sky.addColorStop(0, mix(p.ground, "#ffffff", 0.45));
    sky.addColorStop(0.55, p.ground);
    sky.addColorStop(1, mix(p.accents[0]?.colour ?? p.ink, p.ground, 0.45));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, U, U);
    spot(ctx, U * 0.2, U * 0.25, U * 0.5, "#ffffff", 0.45);
    // The shape on one side, the stripes on the other.
    const cx = (0.22 + (m.sun.x - 0.3) * 1.4) * U;
    const cy = (0.36 + (m.horizon - 0.56) * 1.2) * U;
    const side = cx > U / 2 ? 1 : -1;
    const r = m.sun.r * U * 1.4;
    const fill = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    fill.addColorStop(0, mix(p.ink, "#ffffff", 0.35));
    fill.addColorStop(1, rgba(mix(p.ink, p.ground, 0.3), 0.15));
    ctx.fillStyle = fill;
    const shape = (dx: number, dy: number) => {
      ctx.beginPath();
      if (m.shape === "circle") ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      else {
        ctx.moveTo(cx + dx, cy + dy - r);
        ctx.lineTo(cx + dx + r * 0.95, cy + dy + r * 0.7);
        ctx.lineTo(cx + dx - r * 0.95, cy + dy + r * 0.7);
        ctx.closePath();
      }
    };
    shape(0, 0);
    ctx.fill();
    ctx.strokeStyle = mix(tube2, "#1a1030", 0.2);
    ctx.lineWidth = 5;
    shape(-26 * side, 22);
    ctx.stroke();
    ctx.save();
    if (side < 0) {
      ctx.translate(U, 0);
      ctx.scale(-1, 1);
    }
    ctx.strokeStyle = mix(p.ink, "#1a1030", 0.15);
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let i = 0; i < m.stripes; i++) {
      const o = i * 30;
      ctx.moveTo(-40 + o, U * 0.98);
      ctx.lineTo(U * 0.5 + o, U * 0.6);
    }
    ctx.stroke();
    ctx.restore();
    grid(ctx, H + 40, U / 2, mix(p.ink, "#ffffff", 0.35), false, 0.5);
    return;
  }

  // The night sky, the ground's colour at its heart, a glow at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, mix(p.ground, NIGHT, 0.82));
  sky.addColorStop(0.6, mix(p.ground, NIGHT, 0.25));
  sky.addColorStop(1, mix(tube, "#ff8a3d", 0.35));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, U, H);
  for (const star of m.stars) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + star.r / 4})`;
    circle(ctx, star.at.x * U, star.at.y * U, star.r);
    ctx.fill();
  }

  if (m.scene === "sunset") {
    // The striped sun, setting.
    const r = m.sun.r * U;
    const sx = m.sun.x * U;
    const sy = H - r * 0.3;
    const sun = ctx.createLinearGradient(0, sy - r, 0, sy + r);
    sun.addColorStop(0, "#ffe873");
    sun.addColorStop(0.5, mix("#ff8a3d", tube, 0.3));
    sun.addColorStop(1, tube);
    glow(ctx, tube, 60);
    ctx.fillStyle = sun;
    circle(ctx, sx, sy, r);
    ctx.fill();
    noGlow(ctx);
    ctx.fillStyle = sky;
    // Cut by bands that thicken toward the horizon.
    const from = sy - r * 0.55;
    for (let i = 0; i < m.sun.bands; i++) {
      const t = i / m.sun.bands;
      ctx.fillRect(sx - r - 2, from + t * (H - from), 2 * r + 4, 3 + t * 14);
    }
  } else {
    // Lasers fanning up from the horizon.
    const { from, angles } = m.beams;
    spot(ctx, from.x * U, from.y * U, U * 0.45, tube, 0.45);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 4;
    angles.forEach((a, i) => {
      const c = [tube, tube2, "#7df9ff"][i % 3]!;
      glow(ctx, c, 16);
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(from.x * U, from.y * U);
      ctx.lineTo(from.x * U + Math.cos(a) * 1600, from.y * U + Math.sin(a) * 1600);
      ctx.stroke();
    });
    noGlow(ctx);
    ctx.restore();
    spot(ctx, from.x * U, from.y * U, 60, "#ffffff", 0.9);
  }

  if (m.ridge) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    m.ridge.forEach((h, i) => ctx.lineTo((i / (m.ridge!.length - 1)) * U, H - h * U));
    ctx.lineTo(U, H);
    ctx.closePath();
    ctx.fillStyle = mix(p.ground, NIGHT, 0.85);
    ctx.fill();
    glow(ctx, tube2, 12);
    ctx.strokeStyle = tube2;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    noGlow(ctx);
  }

  const floor = ctx.createLinearGradient(0, H, 0, U);
  floor.addColorStop(0, mix(p.ground, NIGHT, 0.6));
  floor.addColorStop(1, NIGHT);
  ctx.fillStyle = floor;
  ctx.fillRect(0, H, U, U - H);
  grid(ctx, H, m.sun.x * U, tube2, true);
  const haze = ctx.createLinearGradient(0, H, 0, H + (U - H) * 0.4);
  haze.addColorStop(0, rgba(tube, 0.45));
  haze.addColorStop(1, rgba(tube, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, H, U, U - H);
  glow(ctx, tube, 18);
  ctx.fillStyle = mix(tube, "#ffffff", 0.5);
  ctx.fillRect(0, H - 1.5, U, 3);
  noGlow(ctx);
}

// ── Euro-disco ───────────────────────────────────────────────────────────────────────────────

function ring(ctx: Ctx, x: number, y: number, r: number, w: number, tint: string): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = chromeGradient(ctx, y - r - w / 2, y + r + w / 2, tint);
  circle(ctx, x, y, r);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0b0712";
  circle(ctx, x, y, r + w / 2);
  ctx.stroke();
  circle(ctx, x, y, r - w / 2);
  ctx.stroke();
  // The gloss, top left.
  ctx.lineWidth = w * 0.12;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(x, y, r + w * 0.2, -2.55, -1.95);
  ctx.stroke();
}

function sphere(ctx: Ctx, x: number, y: number, r: number, tint: string): void {
  ctx.save();
  circle(ctx, x, y, r);
  ctx.clip();
  ctx.fillStyle = chromeGradient(ctx, y - r, y + r * 0.9, tint);
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  shade.addColorStop(0.7, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  spot(ctx, x - r * 0.4, y - r * 0.45, r * 0.22, "#ffffff", 0.95);
  ctx.restore();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 2;
  circle(ctx, x, y, r - 1);
  ctx.stroke();
}

/** A four-pointed glint with its lens flare. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, colour: string): void {
  spot(ctx, x, y, r * 1.5, colour, 0.5);
  ctx.fillStyle = "#ffffff";
  glow(ctx, colour, r * 0.6);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r * 0.7, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r * 0.7, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  noGlow(ctx);
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(x - r * 1.8, y - 0.8, r * 3.6, 1.6);
}

function chromeObjects(ctx: Ctx, s: Sleeve, m: ChromeMotif): void {
  const tint = s.palette.ground;
  if (m.scene === "rings") {
    for (const r of m.rings) ring(ctx, r.at.x * U, r.at.y * U, r.r * U, r.w * U, tint);
    // Linked: each ring passes back over the next one where they cross low.
    for (let i = 0; i + 1 < m.rings.length; i++) {
      const [a, b] = [m.rings[i]!, m.rings[i + 1]!];
      const [ax, ay, bx, by] = [a.at.x * U, a.at.y * U, b.at.x * U, b.at.y * U];
      const d = Math.hypot(bx - ax, by - ay);
      const r = a.r * U;
      if (d >= 2 * r || d === 0) continue;
      const h = Math.sqrt(r * r - (d / 2) ** 2);
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
      const [nx, ny] = [-(by - ay) / d, (bx - ax) / d];
      const low = ny * h > 0 ? 1 : -1;
      ctx.save();
      circle(ctx, mx + nx * h * low, my + ny * h * low, a.w * U * 1.1);
      ctx.clip();
      ring(ctx, ax, ay, r, a.w * U, tint);
      ctx.restore();
    }
  } else if (m.scene === "sphere") {
    sphere(ctx, m.sphere.at.x * U, m.sphere.at.y * U, m.sphere.r * U, tint);
  }
}

function drawChrome(ctx: Ctx, s: Sleeve, m: ChromeMotif): void {
  const p = s.palette;
  const bg = ctx.createRadialGradient(U * 0.5, U * 0.35, 0, U * 0.5, U * 0.4, U * 0.85);
  bg.addColorStop(0, mix(p.ground, "#ffffff", p.light ? 0.5 : 0.18));
  bg.addColorStop(1, mix(p.ground, p.light ? "#3a2a40" : "#05030a", p.light ? 0.2 : 0.7));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, U, U);
  // Light streaks behind, as on a studio backdrop.
  ctx.save();
  ctx.globalAlpha = p.light ? 0.25 : 0.12;
  ctx.strokeStyle = p.light ? "#ffffff" : mix(p.ink, "#ffffff", 0.5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.moveTo(U / 2, U * 0.4);
    ctx.lineTo(U / 2 + Math.cos(a) * U, U * 0.4 + Math.sin(a) * U);
  }
  ctx.stroke();
  ctx.restore();

  chromeObjects(ctx, s, m);
  if (m.floor !== null) {
    const F = m.floor * U;
    const floor = ctx.createLinearGradient(0, F, 0, U);
    // A pale ground's floor takes its ink (no grey mud); a dark one goes to black.
    floor.addColorStop(0, p.light ? mix(p.ground, p.ink, 0.3) : mix(p.ground, "#05030a", 0.6));
    floor.addColorStop(1, p.light ? mix(p.ground, p.ink, 0.6) : mix(p.ground, "#05030a", 0.85));
    ctx.fillStyle = floor;
    ctx.fillRect(0, F, U, U - F);
    // The scene's reflection in the gloss.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, F, U, U - F);
    ctx.clip();
    ctx.globalAlpha = 0.28;
    ctx.translate(0, 2 * F);
    ctx.scale(1, -1);
    chromeObjects(ctx, s, m);
    ctx.restore();
    const line = ctx.createLinearGradient(0, 0, U, 0);
    line.addColorStop(0, "rgba(255, 255, 255, 0)");
    line.addColorStop(0.5, "rgba(255, 255, 255, 0.9)");
    line.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = line;
    ctx.fillRect(0, F - 1, U, 2);
  }
  const glint = p.light
    ? mix(p.ink, "#ffffff", 0.2)
    : mix(p.accents[0]?.colour ?? p.ink, "#ffffff", 0.4);
  for (const sp of m.sparkles) sparkle(ctx, sp.at.x * U, sp.at.y * U, sp.r * U, glint);
}

// ── Touches of another genre ─────────────────────────────────────────────────────────────────

function drawTouch(ctx: Ctx, s: Sleeve): void {
  const t = s.touch;
  if (!t) return;
  const p = s.palette;
  const a = Math.min(1, 0.4 + t.share);
  if (t.kind === "neon") {
    ctx.save();
    ctx.globalAlpha = a * 0.8;
    grid(ctx, U * 0.78, U / 2, neon(p.accents[0]?.colour ?? p.ink), !p.light);
    ctx.restore();
  } else if (t.kind === "chrome") {
    const rng = createRng(s.catalogue.length * 977 + s.title.length).fork("touch");
    for (let i = 0; i < 3; i++) {
      sparkle(
        ctx,
        (0.15 + rng.next() * 0.7) * U,
        (0.12 + rng.next() * 0.5) * U,
        (0.02 + rng.next() * 0.04 * a) * U,
        "#ffffff",
      );
    }
  } else {
    // Synthpop: a small colour code in the corner.
    const colours = [p.ink, ...p.accents.map((x) => x.colour)].slice(0, 4);
    colours.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(U - 64 - (colours.length - i) * 26, 64, 20, 20);
    });
  }
}

// ── Type ─────────────────────────────────────────────────────────────────────────────────────

function font(s: Sleeve, size: number): string {
  const t = s.type;
  const weight = t.bold ? (t.face === "condensed" ? 800 : 700) : t.face === "serif" ? 400 : 500;
  return `${t.italic ? "italic " : ""}${weight} ${Math.round(size)}px ${FACES[t.face]}`;
}

function spacedWidth(ctx: Ctx, text: string, tracking: number): number {
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * tracking;
}

/** Draws text with letter spacing (canvas letterSpacing isn't everywhere), aligned at x. */
function spaced(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right",
  draw: (ch: string, x: number, y: number) => void,
): void {
  const w = spacedWidth(ctx, text, tracking);
  let at = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.textAlign = "left";
  if (!tracking) {
    draw(text, at, y);
    return;
  }
  for (const ch of text) {
    draw(ch, at, y);
    at += ctx.measureText(ch).width + tracking;
  }
}

/** The title in lines no wider than `max`, shrinking the type until it fits in three. */
function fit(
  ctx: Ctx,
  s: Sleeve,
  text: string,
  size: number,
  max: number,
): { lines: string[]; size: number } {
  for (;;) {
    ctx.font = font(s, size);
    const tracking = s.type.tracking * size;
    const lines: string[] = [];
    let line = "";
    let tooWide = false;
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (spacedWidth(ctx, next, tracking) <= max || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
      if (spacedWidth(ctx, line, tracking) > max) tooWide = true;
    }
    lines.push(line);
    if ((!tooWide && lines.length <= 3) || size < 14) return { lines, size };
    size *= 0.9;
  }
}

function drawType(
  ctx: Ctx,
  s: Sleeve,
  px: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  const t = s.type;
  const p = s.palette;
  const minimal = s.motif.kind === "minimal";
  // On a thumbnail the small type would be a smudge; real ones show none legible either.
  const fine = px >= 160;
  if (minimal && !fine) return;

  const margin = minimal ? 64 : 58;
  const corner = t.anchor.length === 2;
  const max = (corner ? (minimal ? 0.46 : 0.62) : 0.86) * box.w;
  const text = t.upper ? s.title.toUpperCase() : s.title;
  const { lines, size } = fit(ctx, s, text, t.size * U, max);
  const lead = size * (t.face === "script" ? 1.0 : 1.08);
  const tracking = t.tracking * size;
  const align =
    t.anchor === "tl" || t.anchor === "bl"
      ? "left"
      : t.anchor === "tr" || t.anchor === "br"
        ? "right"
        : "center";
  const x =
    align === "left"
      ? box.x + margin
      : align === "right"
        ? box.x + box.w - margin
        : box.x + box.w / 2;
  const fineSize = minimal ? 15 : 17;
  // The block: the title's lines, then (minimal) the label line under them.
  const blockH = lines.length * lead + (minimal && fine ? fineSize * 2.4 : 0);
  const bottomRoom = !minimal && fine && !s.frame ? 40 : 0;
  const top = t.anchor.startsWith("t")
    ? box.y + margin + size * 0.8
    : box.y + box.h - margin - bottomRoom - blockH + size * 0.8;

  ctx.textBaseline = "alphabetic";
  ctx.font = font(s, size);
  lines.forEach((line, i) => {
    const y = top + i * lead;
    if (t.finish === "neon") {
      spaced(ctx, line, x, y, tracking, align, (ch, cx, cy) => {
        glow(ctx, t.colour, 28);
        ctx.fillStyle = mix(t.colour, "#ffffff", 0.55);
        ctx.fillText(ch, cx, cy);
        glow(ctx, t.colour, 8);
        ctx.fillText(ch, cx, cy);
        noGlow(ctx);
        ctx.lineWidth = Math.max(1.5, size * 0.018);
        ctx.strokeStyle = t.colour;
        ctx.strokeText(ch, cx, cy);
      });
    } else if (t.finish === "chrome") {
      const g = chromeGradient(ctx, y - size * 0.78, y + size * 0.05, p.ground);
      spaced(ctx, line, x, y, tracking, align, (ch, cx, cy) => {
        ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 6 * k;
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.09;
        ctx.strokeStyle = "#120a1c";
        ctx.strokeText(ch, cx, cy);
        noGlow(ctx);
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = g;
        ctx.fillText(ch, cx, cy);
        ctx.lineWidth = Math.max(1, size * 0.012);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.strokeText(ch, cx, cy);
      });
      if (i === 0 && fine) {
        const w = spacedWidth(ctx, line, tracking);
        const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
        sparkle(ctx, left + size * 0.15, y - size * 0.7, size * 0.32, "#bfe6ff");
        ctx.font = font(s, size);
      }
    } else {
      ctx.fillStyle = t.colour;
      spaced(ctx, line, x, y, tracking, align, (ch, cx, cy) => ctx.fillText(ch, cx, cy));
    }
  });

  if (!fine) return;
  ctx.font = `500 ${fineSize}px ${FINE}`;
  const fineTracking = fineSize * 0.16;
  const say = (
    text: string,
    fx: number,
    fy: number,
    a: "left" | "center" | "right",
    colour: string,
  ) => {
    ctx.fillStyle = colour;
    spaced(ctx, text.toUpperCase(), fx, fy, fineTracking, a, (ch, cx, cy) =>
      ctx.fillText(ch, cx, cy),
    );
  };
  if (minimal) {
    const y = top + (lines.length - 1) * lead + fineSize * 2.2;
    say(
      `${s.label} · ${s.catalogue}`,
      x,
      y,
      align,
      rgba(t.colour === p.text ? p.text : p.text, 0.7),
    );
    if (s.format) say(s.format, x, y + fineSize * 1.5, align, rgba(p.text, 0.5));
    return;
  }
  // Label bottom left, catalogue bottom right, format top right: in the frame's strip if any.
  const onPaper = s.frame;
  const colour = onPaper
    ? "#2a2230"
    : s.motif.kind === "neon" && !p.light
      ? "rgba(255, 255, 255, 0.78)"
      : rgba(p.text, 0.8);
  const y = onPaper ? U - 44 : box.y + box.h - 34;
  say(s.label, onPaper ? 52 : box.x + 34, y, "left", colour);
  say(s.catalogue, onPaper ? U - 52 : box.x + box.w - 34, y, "right", colour);
  if (s.format && t.anchor !== "top")
    say(s.format, box.x + box.w - 34, box.y + 46, "right", colour);
}

// ── The finish ───────────────────────────────────────────────────────────────────────────────

/** Fine noise, the same every time: the print's grain. */
let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  const rng = createRng(4242);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rng.next() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (grainTile = c);
}

function finish(ctx: Ctx, s: Sleeve): void {
  // The laminate's sheen, across.
  if (s.motif.kind !== "minimal") {
    const sheen = ctx.createLinearGradient(0, 0, U, U * 0.6);
    sheen.addColorStop(0.25, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.42, "rgba(255, 255, 255, 0.07)");
    sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, U, U);
  }
  // Ring wear: the record inside, showing through.
  if (s.wear > 0) {
    const g = ctx.createRadialGradient(U / 2, U / 2, U * 0.43, U / 2, U / 2, U * 0.485);
    g.addColorStop(0, "rgba(255, 255, 255, 0)");
    g.addColorStop(0.55, `rgba(255, 255, 255, ${0.06 * s.wear})`);
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, U, U);
  }
  const v = ctx.createRadialGradient(U / 2, U / 2, U * 0.45, U / 2, U / 2, U * 0.75);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, U, U);
}

/** Draws a sleeve filling a `px`-square canvas. */
export function drawSleeve(ctx: Ctx, s: Sleeve, px: number): void {
  ctx.save();
  k = px / U;
  ctx.scale(k, k);
  const box = s.frame ? { x: 40, y: 40, w: U - 80, h: U - 130 } : { x: 0, y: 0, w: U, h: U };
  if (s.frame) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, U, U);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  // The picture fills its box: scaled into the frame.
  ctx.translate(box.x, box.y);
  ctx.scale(box.w / U, box.h / U);
  const m = s.motif;
  if (m.kind === "minimal") drawMinimal(ctx, s, m);
  else if (m.kind === "neon") drawNeon(ctx, s, m);
  else drawChrome(ctx, s, m);
  drawTouch(ctx, s);
  ctx.restore();
  drawType(ctx, s, px, box);
  finish(ctx, s);
  ctx.restore();
  if (px >= 128) {
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = s.palette.light ? 0.1 : 0.14;
    ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
    ctx.fillRect(0, 0, px, px);
    ctx.restore();
  }
}

// ── Caches ───────────────────────────────────────────────────────────────────────────────────

/** A sleeve to show: a generated song's, or an original's real one. */
export type CoverSource = { song: CoverSong } | { reference: ReferenceId };

export function songCover(song: CoverSong): CoverSource {
  return song.reference ? { reference: song.reference } : { song };
}

const described = new WeakMap<CoverSong, Sleeve>();
export function sleeveOf(song: CoverSong): Sleeve {
  let s = described.get(song);
  if (!s) described.set(song, (s = describeSleeve(song)));
  return s;
}

/** Drawn sleeves, by key and size; the oldest go past this many. */
const KEEP = 160;
const drawn = new Map<string, HTMLCanvasElement>();

/** The sleeve drawn at `px` (drawn once, then kept). */
export function sleeveCanvas(s: Sleeve, px: number): HTMLCanvasElement {
  const id = `${s.key}@${px}`;
  const hit = drawn.get(id);
  if (hit) {
    drawn.delete(id);
    drawn.set(id, hit);
    return hit;
  }
  const c = document.createElement("canvas");
  c.width = c.height = px;
  drawSleeve(c.getContext("2d")!, s, px);
  drawn.set(id, c);
  if (drawn.size > KEEP) drawn.delete(drawn.keys().next().value!);
  return c;
}

/** A stored song's cover (history.ts, library.ts keep songs as creations), decoded once. */
const stored = new Map<string, CoverSource | null>();
export function storedCover(data: string, reference?: ReferenceId): CoverSource | null {
  if (reference) return { reference };
  if (!stored.has(data)) {
    const creation = decodeCreation(data);
    stored.set(data, creation ? { song: creationCover(creation) } : null);
  }
  return stored.get(data) ?? null;
}

// Thumbnails not drawn yet are drawn a few per frame: a long list doesn't hold up the page.
const queue: (() => void)[] = [];
function later(job: () => void): void {
  queue.push(job);
  if (queue.length === 1) requestAnimationFrame(work);
}
function work(): void {
  const start = performance.now();
  while (queue.length && performance.now() - start < 6) queue.shift()!();
  if (queue.length) requestAnimationFrame(work);
}

/**
 * Shows a sleeve in `box` (a .cover element): a generated one drawn at `px`, or an original's
 * scan over a tile of its colour. Nothing changes when it already shows that sleeve.
 */
export function showCover(box: HTMLElement, source: CoverSource, px: number, lazy = false): void {
  const id = "song" in source ? sleeveOf(source.song).key : `ref:${source.reference}`;
  if (box.dataset.cover === id) return;
  box.dataset.cover = id;
  if ("reference" in source) {
    const ref = source.reference;
    box.style.setProperty("--cover-tile", RECORD_COLOURS[ref].field);
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // As the Inspired by panel loads them, so the browser shares the one download.
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.src = coverUrl(ref, px > 250 ? 500 : 250);
    img.addEventListener("error", () => img.remove());
    box.replaceChildren(img);
    return;
  }
  const s = sleeveOf(source.song);
  box.style.setProperty("--cover-tile", s.palette.ground);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  canvas.setAttribute("aria-hidden", "true");
  const paint = () => {
    if (box.dataset.cover === id) canvas.getContext("2d")!.drawImage(sleeveCanvas(s, px), 0, 0);
  };
  if (lazy && !drawn.has(`${s.key}@${px}`)) later(paint);
  else paint();
  box.replaceChildren(canvas);
}

/** A new .cover element showing a sleeve. */
export function coverElement(source: CoverSource, px: number, lazy = false): HTMLElement {
  const box = document.createElement("span");
  box.className = "cover";
  showCover(box, source, px, lazy);
  return box;
}

// ── System media controls ────────────────────────────────────────────────────────────────────

const ARTWORK_SIZES = [96, 256, 512];
const artworks = new Map<string, Promise<MediaImage[]>>();

function dataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    // A JPEG: the grain would make a PNG huge.
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("no image"));
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("unreadable image"));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.9,
    );
  });
}

/** The sleeve as Media Session artwork: data URLs at a few sizes (an original's scans as they
 * are). */
export function coverArtwork(source: CoverSource): Promise<MediaImage[]> {
  if ("reference" in source) {
    return Promise.resolve(
      ([250, 500] as const).map((size) => ({
        src: coverUrl(source.reference, size),
        sizes: `${size}x${size}`,
        type: "image/jpeg",
      })),
    );
  }
  const s = sleeveOf(source.song);
  let art = artworks.get(s.key);
  if (!art) {
    art = (async () => {
      const images: MediaImage[] = [];
      for (const size of ARTWORK_SIZES) {
        // A size at a time, after the song change has painted: no long task on it.
        await new Promise((resolve) => setTimeout(resolve, 40));
        images.push({
          src: await dataUrl(sleeveCanvas(s, size)),
          sizes: `${size}x${size}`,
          type: "image/jpeg",
        });
      }
      return images;
    })();
    artworks.set(s.key, art);
    art.catch(() => artworks.delete(s.key));
    if (artworks.size > 12) artworks.delete(artworks.keys().next().value!);
  }
  return art;
}
