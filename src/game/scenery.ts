// Everything in the frozen world is drawn procedurally: no sprite downloads,
// no licences to track, and the whole map is a few kilobytes of code.

import { WORLD, fbm, hash2, getLakes } from '../../shared/world.js';

export const CHUNK = 512;

/* ------------------------------------------------------------------ *
 * Ground chunks (cached canvases in flat world space)
 * ------------------------------------------------------------------ */

const chunks = new Map<string, HTMLCanvasElement>();
const MAX_CHUNKS = 96;

function paintSnow(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  // Snow drifts come from the shared noise field, rendered into a tiny
  // bitmap and upscaled so the canvas interpolates them smoothly.
  // The sample grid is aligned to global world coordinates and padded by one
  // texel, so neighbouring chunks interpolate to identical values at the
  // border — no visible tile seams, and no per-pixel cost.
  const LOD = 16; // world units per texel
  const N = CHUNK / LOD + 2; // +2 = one texel of padding on each side
  const lo = document.createElement('canvas');
  lo.width = N;
  lo.height = N;
  const loCtx = lo.getContext('2d')!;
  const img = loCtx.createImageData(N, N);

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = ox + i * LOD - LOD / 2;
      const wy = oy + j * LOD - LOD / 2;
      const t = fbm(wx * 0.0022, wy * 0.0022, WORLD.seed ^ 0x5d0f, 4);
      const k = Math.min(1, Math.max(0, (t - 0.28) / 0.44));
      const p = (j * N + i) * 4;
      img.data[p] = 214 + k * 41; // #d6e6f3 -> #ffffff
      img.data[p + 1] = 230 + k * 25;
      img.data[p + 2] = 243 + k * 12;
      img.data[p + 3] = 255;
    }
  }
  loCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lo, -LOD, -LOD, CHUNK + LOD * 2, CHUNK + LOD * 2);

  // wind-blown ripples
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 26; i++) {
    const rx = hash2(ox + i, oy, WORLD.seed ^ 0x11) * CHUNK;
    const ry = hash2(ox, oy + i, WORLD.seed ^ 0x22) * CHUNK;
    const len = 30 + hash2(i, ox + oy, WORLD.seed ^ 0x33) * 70;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + len * 0.5, ry - 6, rx + len, ry);
    ctx.stroke();
  }
  ctx.restore();

  // sparkle grains
  for (let i = 0; i < 150; i++) {
    const gx = hash2(ox + i * 3, oy + i, WORLD.seed ^ 0x44) * CHUNK;
    const gy = hash2(ox + i, oy + i * 3, WORLD.seed ^ 0x55) * CHUNK;
    const bright = hash2(i, ox ^ oy, WORLD.seed ^ 0x66);
    ctx.fillStyle = bright > 0.55 ? 'rgba(255,255,255,0.9)' : 'rgba(168,198,222,0.35)';
    ctx.fillRect(gx, gy, 2, 2);
  }
}

function paintLakes(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  for (const lake of getLakes()) {
    const reach = Math.max(lake.rx, lake.ry) + 40;
    if (lake.x + reach < ox || lake.x - reach > ox + CHUNK) continue;
    if (lake.y + reach < oy || lake.y - reach > oy + CHUNK) continue;

    ctx.save();
    ctx.translate(lake.x - ox, lake.y - oy);
    ctx.rotate(lake.rot);

    // snow bank around the edge
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, lake.rx + 14, lake.ry + 12, 0, 0, Math.PI * 2);
    ctx.fill();

    const ice = ctx.createLinearGradient(-lake.rx, -lake.ry, lake.rx, lake.ry);
    ice.addColorStop(0, '#9fd2ea');
    ice.addColorStop(0.5, '#bfe4f4');
    ice.addColorStop(1, '#8dc6e4');
    ctx.fillStyle = ice;
    ctx.beginPath();
    ctx.ellipse(0, 0, lake.rx, lake.ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // cracks + glints
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, lake.rx, lake.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = hash2(i, Math.round(lake.x), WORLD.seed) * Math.PI * 2;
      const r0 = hash2(i, Math.round(lake.y), WORLD.seed) * lake.rx * 0.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7);
      ctx.lineTo(Math.cos(a + 0.5) * lake.rx * 0.95, Math.sin(a + 0.5) * lake.ry * 0.95);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const gx = (hash2(i * 7, Math.round(lake.x), WORLD.seed ^ 9) - 0.5) * lake.rx * 1.4;
      const gy = (hash2(i * 5, Math.round(lake.y), WORLD.seed ^ 8) - 0.5) * lake.ry * 1.4;
      ctx.beginPath();
      ctx.ellipse(gx, gy, 34, 8, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
}

function paintPlaza(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  const { x, y } = WORLD.spawn;
  const r = WORLD.spawnRadius;
  if (x + r < ox || x - r > ox + CHUNK || y + r < oy || y - r > oy + CHUNK) return;

  ctx.save();
  ctx.translate(x - ox, y - oy);

  // trodden snow
  ctx.fillStyle = 'rgba(196,219,236,0.75)';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(0, 0, r - 6, (r - 6) * 0.82, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(56,189,248,0.45)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.62, r * 0.62 * 0.82, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ice-carved POG mark in the middle of the plaza
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#0f6f95';
  ctx.font = 'bold 96px "Baloo 2", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.scale(1, 0.82);
  ctx.fillText('$POG', 0, 0);
  ctx.restore();
}

export function getGroundChunk(cx: number, cy: number): HTMLCanvasElement {
  const key = cx + ':' + cy;
  const hit = chunks.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = CHUNK;
  canvas.height = CHUNK;
  const ctx = canvas.getContext('2d')!;
  const ox = cx * CHUNK;
  const oy = cy * CHUNK;

  paintSnow(ctx, ox, oy);
  paintLakes(ctx, ox, oy);
  paintPlaza(ctx, ox, oy);

  if (chunks.size > MAX_CHUNKS) {
    const oldest = chunks.keys().next().value;
    if (oldest) chunks.delete(oldest);
  }
  chunks.set(key, canvas);
  return canvas;
}

/* ------------------------------------------------------------------ *
 * Props, drawn upright in screen space
 * ------------------------------------------------------------------ */

export interface Prop {
  type: string;
  x: number;
  y: number;
  r: number;
  scale: number;
  variant: number;
}

const PROP_HEIGHT: Record<string, number> = {
  pine: 118,
  rock: 44,
  spike: 74,
  bush: 30,
  snowman: 66,
  lantern: 46,
  banner: 132,
  workbench: 62,
  stall: 86,
};

export const propHeight = (p: Prop) => (PROP_HEIGHT[p.type] ?? 40) * p.scale;

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number) {
  ctx.fillStyle = 'rgba(66,103,133,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPine(ctx: CanvasRenderingContext2D, h: number, variant: number) {
  const w = h * 0.46;
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(-w * 0.08, -h * 0.2, w * 0.16, h * 0.2);

  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const baseY = -h * (0.16 + t * 0.26);
    const tipY = -h * (0.16 + t * 0.26 + 0.42);
    const halfW = (w / 2) * (1 - t * 0.28);

    ctx.fillStyle = i === 0 ? '#1d4a3a' : i === 1 ? '#235845' : '#2a6650';
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(halfW, baseY);
    ctx.quadraticCurveTo(0, baseY + h * 0.03, -halfW, baseY);
    ctx.closePath();
    ctx.fill();

    // snow load on each tier
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, tipY + h * 0.01);
    ctx.lineTo(halfW * 0.62, baseY - h * 0.16);
    ctx.quadraticCurveTo(0, baseY - h * 0.11, -halfW * 0.62, baseY - h * 0.16);
    ctx.closePath();
    ctx.fill();
  }

  if (variant % 5 === 0) {
    // a few trees wear a $POG bauble
    ctx.fillStyle = '#ff5c17';
    ctx.beginPath();
    ctx.arc(w * 0.18, -h * 0.4, h * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.5;
  ctx.fillStyle = '#6f7b88';
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(-w * 0.44, -h, -w * 0.08, -h);
  ctx.quadraticCurveTo(w * 0.42, -h * 0.94, w / 2, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#8b97a4';
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, -h * 0.5);
  ctx.quadraticCurveTo(-w * 0.1, -h, w * 0.18, -h * 0.72);
  ctx.quadraticCurveTo(0, -h * 0.4, -w * 0.3, -h * 0.5);
  ctx.fill();

  ctx.fillStyle = '#f7fbff';
  ctx.beginPath();
  ctx.ellipse(-w * 0.04, -h * 0.9, w * 0.34, h * 0.2, -0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpike(ctx: CanvasRenderingContext2D, h: number, variant: number) {
  const w = h * 0.42;
  const lean = ((variant % 7) - 3) * 0.03;
  ctx.save();
  ctx.rotate(lean);
  const g = ctx.createLinearGradient(0, -h, 0, 0);
  g.addColorStop(0, 'rgba(226,247,255,0.95)');
  g.addColorStop(1, 'rgba(116,190,224,0.9)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(w * 0.5, -h * 0.12);
  ctx.lineTo(w * 0.2, 0);
  ctx.lineTo(-w * 0.45, 0);
  ctx.lineTo(-w * 0.4, -h * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(-w * 0.1, 0);
  ctx.stroke();
  ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.8;
  ctx.fillStyle = '#25543f';
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.35, w * 0.4, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f5fbff';
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.55, w * 0.36, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnowman(ctx: CanvasRenderingContext2D, h: number) {
  const r = h * 0.22;
  ctx.strokeStyle = '#6b5136';
  ctx.lineWidth = Math.max(1.5, h * 0.035);
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, -h * 0.55);
  ctx.lineTo(-r * 1.9, -h * 0.75);
  ctx.moveTo(r * 0.7, -h * 0.55);
  ctx.lineTo(r * 1.9, -h * 0.72);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -r * 2.5, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -r * 3.8, r * 0.58, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1b2430';
  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 3.95, r * 0.09, 0, Math.PI * 2);
  ctx.arc(r * 0.22, -r * 3.95, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff5c17';
  ctx.beginPath();
  ctx.moveTo(0, -r * 3.78);
  ctx.lineTo(r * 0.75, -r * 3.66);
  ctx.lineTo(0, -r * 3.56);
  ctx.closePath();
  ctx.fill();
}

/**
 * An ice-block lantern: a stack of translucent blocks with a warm flame
 * inside. These ring the spawn plaza where shelters will eventually go.
 */
function drawLantern(ctx: CanvasRenderingContext2D, h: number, time: number, variant: number) {
  const w = h * 0.62;
  const flicker =
    0.85 + Math.sin(time * 0.005 + variant * 1.7) * 0.1 + Math.sin(time * 0.013 + variant * 3.1) * 0.05;
  const flameY = -h * 0.66;

  // warm pool of light on the snow
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 1.3);
  pool.addColorStop(0, `rgba(255,164,60,${0.26 * flicker})`);
  pool.addColorStop(1, 'rgba(255,164,60,0)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, 0, h * 1.3, h * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // two stacked ice blocks, narrowing upward
  const block = (yTop: number, yBottom: number, halfTop: number, halfBottom: number, tint: string) => {
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(-halfTop, yTop);
    ctx.lineTo(halfTop, yTop);
    ctx.lineTo(halfBottom, yBottom);
    ctx.lineTo(-halfBottom, yBottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  block(-h * 0.3, 0, w * 0.42, w * 0.5, 'rgba(163,209,233,0.95)');
  block(-h * 0.56, -h * 0.3, w * 0.34, w * 0.42, 'rgba(197,230,246,0.95)');

  // the flame itself
  ctx.save();
  ctx.shadowColor = `rgba(255,150,40,${flicker})`;
  ctx.shadowBlur = h * 0.55;
  const fire = ctx.createLinearGradient(0, flameY - h * 0.2, 0, flameY + h * 0.12);
  fire.addColorStop(0, '#fff3c4');
  fire.addColorStop(0.5, '#ffb43c');
  fire.addColorStop(1, '#ff6a12');
  ctx.fillStyle = fire;
  ctx.beginPath();
  ctx.moveTo(0, flameY - h * (0.2 + flicker * 0.08));
  ctx.quadraticCurveTo(w * 0.3, flameY - h * 0.02, 0, flameY + h * 0.12);
  ctx.quadraticCurveTo(-w * 0.3, flameY - h * 0.02, 0, flameY - h * (0.2 + flicker * 0.08));
  ctx.fill();
  ctx.restore();

  // frost catching the light on the top block
  ctx.fillStyle = `rgba(255,214,150,${0.5 * flicker})`;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.56, w * 0.34, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBanner(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 0.95;
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(-w / 2, -h * 0.72, w * 0.07, h * 0.72);
  ctx.fillRect(w / 2 - w * 0.07, -h * 0.72, w * 0.07, h * 0.72);

  ctx.fillStyle = '#0d2b3a';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = Math.max(2, h * 0.02);
  const bw = w * 1.05;
  const bh = h * 0.34;
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -h, bw, bh, h * 0.05);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ff5c17';
  ctx.font = `800 ${h * 0.2}px "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$POG', 0, -h + bh * 0.5);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(0, -h + bh, bw * 0.5, h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawProp(
  ctx: CanvasRenderingContext2D,
  prop: Prop,
  sx: number,
  sy: number,
  zoom: number,
  time = 0
) {
  const h = propHeight(prop) * zoom;
  const footprint = Math.max(12, (prop.r || 12) * prop.scale) * zoom;
  shadow(ctx, sx, sy, footprint * 1.25);

  ctx.save();
  ctx.translate(sx, sy);
  switch (prop.type) {
    case 'pine':
      drawPine(ctx, h, prop.variant);
      break;
    case 'rock':
      drawRock(ctx, h);
      break;
    case 'spike':
      drawSpike(ctx, h, prop.variant);
      break;
    case 'bush':
      drawBush(ctx, h);
      break;
    case 'snowman':
      drawSnowman(ctx, h);
      break;
    case 'lantern':
      drawLantern(ctx, h, time, prop.variant);
      break;
    case 'banner':
      drawBanner(ctx, h);
      break;
    case 'workbench':
      drawWorkbench(ctx, h);
      break;
    case 'stall':
      drawStall(ctx, h);
      break;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Resource nodes
 * ------------------------------------------------------------------ */

/** What is left of a pine once someone has chopped it. */
export function drawStump(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, scale: number) {
  const r = 13 * scale * zoom;
  shadow(ctx, sx, sy, r * 1.4);
  ctx.save();
  ctx.translate(sx, sy);

  ctx.fillStyle = '#4a3827';
  ctx.beginPath();
  ctx.roundRect(-r * 0.7, -r * 1.1, r * 1.4, r * 1.1, r * 0.2);
  ctx.fill();

  ctx.fillStyle = '#8a6a48';
  ctx.beginPath();
  ctx.ellipse(0, -r * 1.1, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(74,56,39,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -r * 1.1, r * 0.38, r * 0.16, 0, 0, Math.PI * 2);
  ctx.stroke();

  // sawdust in the snow
  ctx.fillStyle = 'rgba(138,106,72,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 1.5, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A thicker slab of ice you can saw blocks out of. */
function drawIceBlock(ctx: CanvasRenderingContext2D, h: number, time: number, variant: number) {
  const w = h * 1.25;
  const shimmer = 0.75 + Math.sin(time * 0.002 + variant) * 0.12;

  ctx.fillStyle = `rgba(255,255,255,${0.5 * shimmer})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.62, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createLinearGradient(0, -h, 0, 0);
  g.addColorStop(0, 'rgba(236,252,255,0.97)');
  g.addColorStop(1, 'rgba(142,205,231,0.95)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w * 0.44, 0);
  ctx.lineTo(-w * 0.36, -h * 0.82);
  ctx.lineTo(w * 0.36, -h * 0.82);
  ctx.lineTo(w * 0.44, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.36, -h * 0.82);
  ctx.lineTo(0, -h);
  ctx.lineTo(w * 0.36, -h * 0.82);
  ctx.lineTo(0, -h * 0.66);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.66);
  ctx.lineTo(0, 0);
  ctx.stroke();
}

/** A hole cut in the ice — fish live down there. */
function drawFishingHole(ctx: CanvasRenderingContext2D, h: number, time: number, active: boolean) {
  const w = h * 1.6;

  // heaped snow rim from the cutting
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.52, w * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(126,173,199,0.5)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const water = ctx.createRadialGradient(0, -w * 0.02, 1, 0, 0, w * 0.38);
  water.addColorStop(0, '#07303f');
  water.addColorStop(1, '#155a73');
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.38, w * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  if (active) {
    // slow ripples so a usable hole reads as alive
    ctx.strokeStyle = 'rgba(190,235,255,0.6)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const t = ((time * 0.0006 + i * 0.5) % 1);
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.12 + w * 0.24 * t, (w * 0.06 + w * 0.11 * t), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

export interface WorldNode {
  id: string;
  type: string;
  x: number;
  y: number;
}

const NODE_HEIGHT: Record<string, number> = { ice: 34, hole: 56 };

export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: WorldNode,
  sx: number,
  sy: number,
  zoom: number,
  time: number,
  depleted: boolean
) {
  const h = (NODE_HEIGHT[node.type] ?? 30) * zoom;
  ctx.save();
  ctx.translate(sx, sy);
  if (node.type === 'ice') {
    if (depleted) {
      // just the scar in the ice where the block was cut out
      ctx.fillStyle = 'rgba(96,152,181,0.35)';
      ctx.beginPath();
      ctx.ellipse(0, 0, h * 0.8, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      shadow(ctx, 0, 0, h * 0.7);
      drawIceBlock(ctx, h, time, node.x);
    }
  } else if (node.type === 'hole') {
    drawFishingHole(ctx, h, time, !depleted);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Player-built igloos
 * ------------------------------------------------------------------ */

interface IglooStyle {
  /** dome shading, lit from the upper left */
  lit: string;
  mid: string;
  shade: string;
  /** brick mortar lines */
  mortar: string;
  /** light spilling out of the doorway */
  glow: string;
  icicles: boolean;
}

const IGLOO_STYLES: Record<string, IglooStyle> = {
  classic: {
    lit: '#ffffff',
    mid: '#e6f1fa',
    shade: '#c3daea',
    mortar: 'rgba(120,162,190,0.55)',
    glow: 'rgba(255,196,110,0.85)',
    icicles: false,
  },
  frost: {
    lit: '#f4fcff',
    mid: '#d8eefc',
    shade: '#a9cee5',
    mortar: 'rgba(92,146,180,0.6)',
    glow: 'rgba(150,220,255,0.85)',
    icicles: true,
  },
  amber: {
    lit: '#fffaf0',
    mid: '#f7e9d4',
    shade: '#dcc4a3',
    mortar: 'rgba(176,142,102,0.5)',
    glow: 'rgba(255,170,70,0.95)',
    icicles: false,
  },
};

/** The dome, its brick courses and the doorway arch. */
function iglooDome(ctx: CanvasRenderingContext2D, w: number, h: number, st: IglooStyle) {
  // shading across the dome: bright at the upper left, deep at the lower right
  const g = ctx.createRadialGradient(-w * 0.2, -h * 0.72, h * 0.08, 0, -h * 0.1, w * 0.72);
  g.addColorStop(0, st.lit);
  g.addColorStop(0.5, st.mid);
  g.addColorStop(1, st.shade);

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h, Math.PI, 0, Math.PI * 2);
  ctx.fill();

  // Snow-brick courses, drawn as arcs that follow the dome rather than
  // straight lines across it — that is what sells the curvature.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h, Math.PI, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = st.mortar;
  ctx.lineWidth = 1.5;
  const courses = 5;
  for (let i = 1; i < courses; i++) {
    const t = i / courses;
    ctx.beginPath();
    ctx.ellipse(0, 0, (w / 2) * (1 - t * t * 0.55), h * (1 - t), 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  // staggered vertical joints, denser toward the base
  for (let i = 0; i < courses; i++) {
    const tTop = i / courses;
    const tBot = (i + 1) / courses;
    const rTop = h * (1 - tTop);
    const rBot = h * (1 - tBot);
    const wTop = (w / 2) * (1 - tTop * tTop * 0.55);
    const wBot = (w / 2) * (1 - tBot * tBot * 0.55);
    const joints = 7 - i;
    for (let j = 0; j <= joints; j++) {
      const a = Math.PI + (Math.PI * (j + (i % 2 ? 0.5 : 0))) / joints;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * wTop, Math.sin(a) * rTop);
      ctx.lineTo(Math.cos(a) * wBot, Math.sin(a) * rBot);
      ctx.stroke();
    }
  }
  ctx.restore();

  // crisp silhouette so a white dome does not vanish into white snow
  ctx.strokeStyle = 'rgba(74,120,148,0.8)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h, Math.PI, 0, Math.PI * 2);
  ctx.stroke();
}

/** The tunnel you actually walk in through, pushed toward the camera. */
function iglooEntrance(ctx: CanvasRenderingContext2D, w: number, h: number, st: IglooStyle) {
  const tw = w * 0.34;
  const th = h * 0.52;

  // warm light pooling on the snow in front of the door
  const pool = ctx.createRadialGradient(0, th * 0.2, 2, 0, th * 0.2, tw * 1.5);
  pool.addColorStop(0, st.glow);
  pool.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(0, th * 0.18, tw * 1.5, tw * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // the tunnel body
  const g = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
  g.addColorStop(0, st.mid);
  g.addColorStop(0.35, st.lit);
  g.addColorStop(1, st.shade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-tw / 2, th * 0.2);
  ctx.lineTo(-tw / 2, -th * 0.35);
  ctx.quadraticCurveTo(0, -th * 1.05, tw / 2, -th * 0.35);
  ctx.lineTo(tw / 2, th * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(74,120,148,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // the dark opening, with light leaking from inside
  ctx.fillStyle = '#16323f';
  ctx.beginPath();
  ctx.moveTo(-tw * 0.3, th * 0.2);
  ctx.lineTo(-tw * 0.3, -th * 0.25);
  ctx.quadraticCurveTo(0, -th * 0.78, tw * 0.3, -th * 0.25);
  ctx.lineTo(tw * 0.3, th * 0.2);
  ctx.closePath();
  ctx.fill();

  const inner = ctx.createLinearGradient(0, th * 0.2, 0, -th * 0.5);
  inner.addColorStop(0, st.glow);
  inner.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.globalAlpha = 1;

  // brick line over the arch
  ctx.strokeStyle = st.mortar;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-tw * 0.42, -th * 0.3);
  ctx.quadraticCurveTo(0, -th * 0.95, tw * 0.42, -th * 0.3);
  ctx.stroke();
}

export function drawIgloo(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  style: string,
  owner: string,
  time = 0
) {
  const h = 96 * zoom;
  const w = h * 1.75;
  const st = (Object.hasOwn(IGLOO_STYLES, style) && IGLOO_STYLES[style]) || IGLOO_STYLES.classic;

  shadow(ctx, sx, sy, w * 0.52);
  ctx.save();
  ctx.translate(sx, sy);

  // drift of snow banked against the base
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.58, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  iglooDome(ctx, w, h, st);

  // a vent at the crown, with a thread of smoke
  ctx.fillStyle = st.shade;
  ctx.beginPath();
  ctx.ellipse(w * 0.06, -h * 0.94, w * 0.05, h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6 * zoom;
  ctx.beginPath();
  ctx.moveTo(w * 0.06, -h * 0.96);
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    ctx.lineTo(w * 0.06 + Math.sin(time * 0.0012 + i) * 7 * zoom, -h * (0.96 + t * 0.28));
  }
  ctx.stroke();
  ctx.restore();

  if (st.icicles) {
    ctx.fillStyle = 'rgba(226,247,255,0.9)';
    for (let i = -3; i <= 3; i++) {
      const a = Math.PI + (Math.PI * (i + 3.5)) / 7;
      const px = Math.cos(a) * (w / 2) * 0.94;
      const py = Math.sin(a) * h * 0.94;
      const len = 8 + ((i * 37) % 9);
      ctx.beginPath();
      ctx.moveTo(px - 2.4, py);
      ctx.lineTo(px + 2.4, py);
      ctx.lineTo(px, py + len * zoom);
      ctx.closePath();
      ctx.fill();
    }
  }

  iglooEntrance(ctx, w, h, st);

  // nameplate
  ctx.font = `700 ${12 * zoom}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = `${owner}'s igloo`;
  const tw = ctx.measureText(label).width + 18;
  ctx.fillStyle = 'rgba(9,41,48,0.78)';
  ctx.beginPath();
  ctx.roundRect(-tw / 2, -h - 26 * zoom, tw, 19 * zoom, 10);
  ctx.fill();
  ctx.fillStyle = '#eef6fb';
  ctx.fillText(label, 0, -h - 16.5 * zoom);

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Plaza stations
 * ------------------------------------------------------------------ */

/** Crafting bench: a log table with tools and a stack of cut timber. */
function drawWorkbench(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.5;

  // legs and top
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(-w * 0.4, -h * 0.42, w * 0.09, h * 0.42);
  ctx.fillRect(w * 0.31, -h * 0.42, w * 0.09, h * 0.42);
  ctx.fillStyle = '#8a6a48';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h * 0.56, w, h * 0.16, 3);
  ctx.fill();
  ctx.strokeStyle = '#4a3827';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // stacked logs underneath
  ctx.fillStyle = '#7a5738';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(-w * 0.22 + i * w * 0.15, -h * 0.12, w * 0.075, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // an axe leaning on the bench
  ctx.strokeStyle = '#6b5136';
  ctx.lineWidth = h * 0.05;
  ctx.beginPath();
  ctx.moveTo(w * 0.2, -h * 0.05);
  ctx.lineTo(w * 0.34, -h * 0.8);
  ctx.stroke();
  ctx.fillStyle = '#b9c4cc';
  ctx.beginPath();
  ctx.moveTo(w * 0.34, -h * 0.82);
  ctx.lineTo(w * 0.52, -h * 0.74);
  ctx.lineTo(w * 0.36, -h * 0.6);
  ctx.closePath();
  ctx.fill();

  // snow on the bench top
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(-w * 0.1, -h * 0.57, w * 0.3, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Market stall: a striped awning over a counter with a coin sign. */
function drawStall(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.6;

  // posts
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(-w * 0.46, -h * 0.9, w * 0.07, h * 0.9);
  ctx.fillRect(w * 0.39, -h * 0.9, w * 0.07, h * 0.9);

  // counter
  ctx.fillStyle = '#8a6a48';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h * 0.42, w, h * 0.14, 3);
  ctx.fill();
  ctx.strokeStyle = '#4a3827';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // striped awning
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#ff7a3d' : '#f6f2ea';
    ctx.beginPath();
    ctx.moveTo(-w * 0.55 + (i * w * 1.1) / stripes, -h * 0.92);
    ctx.lineTo(-w * 0.55 + ((i + 1) * w * 1.1) / stripes, -h * 0.92);
    ctx.lineTo(-w * 0.55 + ((i + 1) * w * 1.1) / stripes, -h * 0.72);
    ctx.lineTo(-w * 0.55 + (i * w * 1.1) / stripes, -h * 0.72);
    ctx.closePath();
    ctx.fill();
  }
  // scalloped hem
  ctx.fillStyle = '#e8643a';
  for (let i = 0; i < stripes; i++) {
    const cx = -w * 0.55 + ((i + 0.5) * w * 1.1) / stripes;
    ctx.beginPath();
    ctx.arc(cx, -h * 0.72, (w * 1.1) / stripes / 2, 0, Math.PI);
    ctx.fill();
  }

  // a coin on the counter
  ctx.fillStyle = '#ffc93c';
  ctx.beginPath();
  ctx.ellipse(w * 0.2, -h * 0.46, h * 0.09, h * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b8790d';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // a folded scarf as stock
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.roundRect(-w * 0.34, -h * 0.5, w * 0.24, h * 0.08, 3);
  ctx.fill();
}

/**
 * The translucent igloo that follows the player while they pick a spot.
 * Green means the API will accept it; red means it will not, and the HUD
 * says why — both sides run the same `canBuildAt`, so this never lies.
 */
export function drawIglooGhost(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  style: string,
  ok: boolean
) {
  const h = 96 * zoom;
  const w = h * 1.75;
  const tint = ok ? '82, 214, 163' : '240, 96, 72';

  ctx.save();

  // the footprint it will claim
  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = `rgba(${tint},0.95)`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(sx, sy, w * 0.52, w * 0.52 * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `rgba(${tint},0.14)`;
  ctx.fill();

  // the dome itself, see-through
  ctx.globalAlpha = 0.55;
  ctx.translate(sx, sy);
  const st = (Object.hasOwn(IGLOO_STYLES, style) && IGLOO_STYLES[style]) || IGLOO_STYLES.classic;
  ctx.fillStyle = st.mid;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h, Math.PI, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = `rgba(${tint},0.95)`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h, Math.PI, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * $POG pickup
 * ------------------------------------------------------------------ */

export function drawCoin(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, zoom: number) {
  const bob = Math.sin(time * 0.003 + sx * 0.01) * 5 * zoom;
  const spin = Math.abs(Math.cos(time * 0.0022 + sx * 0.02));
  const r = 15 * zoom;
  const cy = sy - 26 * zoom + bob;

  ctx.fillStyle = 'rgba(66,103,133,0.2)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.7, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(sx, cy);
  ctx.shadowColor = 'rgba(255,190,60,0.85)';
  ctx.shadowBlur = 16 * zoom;

  ctx.fillStyle = '#c47a12';
  ctx.beginPath();
  ctx.ellipse(0, 1.5 * zoom, r * Math.max(0.12, spin), r, 0, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(0.5, '#ffc93c');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * Math.max(0.12, spin), r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (spin > 0.45) {
    ctx.fillStyle = '#8a5a08';
    ctx.font = `800 ${r * 1.15}px "Baloo 2", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.scale(spin, 1);
    ctx.fillText('P', 0, r * 0.06);
    ctx.restore();
  }
  ctx.restore();
}
