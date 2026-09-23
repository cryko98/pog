// Furnishings, drawn procedurally like everything else in the world: the
// stall that sells them, and each piece as it stands inside an igloo.

import { drawLantern } from './scenery';

/** The furnishing stall, out on the snow east of the plaza. */
export function drawFurnishStall(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.35;

  // back wall
  ctx.fillStyle = '#6b513a';
  ctx.beginPath();
  ctx.roundRect(-w * 0.46, -h * 0.82, w * 0.92, h * 0.6, 4);
  ctx.fill();
  ctx.strokeStyle = '#4a3827';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // shelves of odds and ends
  ctx.strokeStyle = '#8a6a48';
  ctx.lineWidth = 3;
  for (const t of [0.42, 0.62]) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, -h * t);
    ctx.lineTo(w * 0.42, -h * t);
    ctx.stroke();
  }
  ['#9fe0f7', '#ffc93c', '#ff7a3d', '#d8c0a8', '#9fe8cb'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(-w * 0.36 + i * w * 0.17, -h * 0.55, w * 0.1, h * 0.11, 2);
    ctx.fill();
  });

  // a rolled rug leaning on the counter
  ctx.fillStyle = '#c0563a';
  ctx.beginPath();
  ctx.roundRect(-w * 0.5, -h * 0.4, w * 0.11, h * 0.4, 5);
  ctx.fill();
  ctx.fillStyle = '#e0765a';
  ctx.beginPath();
  ctx.ellipse(-w * 0.445, -h * 0.4, w * 0.055, h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  // counter
  ctx.fillStyle = '#8a6a48';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h * 0.24, w, h * 0.14, 3);
  ctx.fill();
  ctx.strokeStyle = '#4a3827';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // posts and awning
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(-w * 0.48, -h * 0.9, w * 0.05, h * 0.9);
  ctx.fillRect(w * 0.43, -h * 0.9, w * 0.05, h * 0.9);
  ctx.fillStyle = '#3fc7c0';
  ctx.beginPath();
  ctx.roundRect(-w * 0.56, -h, w * 1.12, h * 0.11, 3);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, -h, w * 0.52, h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One furnishing, standing on the floor of a room.
 *
 * `s` scales everything: the room shrinks to fit a small window, and the
 * furniture has to shrink with it or it will not fit through its own door.
 */
export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  id: string,
  sx: number,
  sy: number,
  s: number,
  time: number
) {
  ctx.save();
  ctx.translate(sx, sy);

  const shade = (rx: number) => {
    ctx.fillStyle = 'rgba(86,132,158,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (id) {
    case 'rug': {
      const w = 92 * s;
      ctx.fillStyle = '#b9543c';
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.5, w * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8927a';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.36, w * 0.19, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8c9a8';
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.13, w * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'brazier': {
      const r = 26 * s;
      shade(r);
      ctx.fillStyle = '#7b8f9e';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.5, r * 0.8, r * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4c6272';
      ctx.lineWidth = 1.6 * s;
      ctx.stroke();
      const f = 0.8 + Math.sin(time * 0.004) * 0.2;
      const g = ctx.createRadialGradient(0, -r * 0.7, 1, 0, -r * 0.7, r * 1.4 * f);
      g.addColorStop(0, 'rgba(255,170,70,0.65)');
      g.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -r * 0.7, r * 1.4 * f, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8a2c';
      ctx.beginPath();
      ctx.moveTo(-r * 0.3, -r * 0.6);
      ctx.quadraticCurveTo(0, -r * (1.1 + 0.25 * f), r * 0.3, -r * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bed': {
      const w = 78 * s;
      shade(w * 0.5);
      ctx.fillStyle = '#6b513a';
      ctx.beginPath();
      ctx.roundRect(-w * 0.5, -w * 0.42, w, w * 0.44, 5 * s);
      ctx.fill();
      ctx.fillStyle = '#e9ddcb';
      ctx.beginPath();
      ctx.roundRect(-w * 0.46, -w * 0.5, w * 0.92, w * 0.3, 8 * s);
      ctx.fill();
      ctx.fillStyle = '#fdfaf4';
      ctx.beginPath();
      ctx.ellipse(-w * 0.28, -w * 0.44, w * 0.15, w * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'crate': {
      const w = 44 * s;
      shade(w * 0.55);
      ctx.fillStyle = '#8a6a48';
      ctx.beginPath();
      ctx.roundRect(-w * 0.5, -w * 0.85, w, w * 0.85, 3 * s);
      ctx.fill();
      ctx.strokeStyle = '#5b4632';
      ctx.lineWidth = 2 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, -w * 0.42);
      ctx.lineTo(w * 0.5, -w * 0.42);
      ctx.stroke();
      break;
    }
    case 'shelf': {
      const w = 64 * s;
      shade(w * 0.5);
      ctx.fillStyle = '#cbe7f3';
      ctx.beginPath();
      ctx.roundRect(-w * 0.5, -w * 1.1, w, w * 1.1, 4 * s);
      ctx.fill();
      ctx.strokeStyle = '#7fb4cd';
      ctx.lineWidth = 2 * s;
      ctx.stroke();
      for (const t of [0.4, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(-w * 0.5, -w * t);
        ctx.lineTo(w * 0.5, -w * t);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath();
      ctx.arc(-w * 0.2, -w * 0.5, w * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'table': {
      const w = 62 * s;
      shade(w * 0.52);
      ctx.strokeStyle = '#5b4632';
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.moveTo(-w * 0.34, 0);
      ctx.lineTo(-w * 0.3, -w * 0.4);
      ctx.moveTo(w * 0.34, 0);
      ctx.lineTo(w * 0.3, -w * 0.4);
      ctx.stroke();
      ctx.fillStyle = '#8a6a48';
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.44, w * 0.5, w * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a3827';
      ctx.lineWidth = 1.6 * s;
      ctx.stroke();
      break;
    }
    case 'lamp': {
      const h = 78 * s;
      shade(h * 0.2);
      ctx.strokeStyle = '#5b4632';
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -h * 0.72);
      ctx.stroke();
      ctx.save();
      ctx.translate(0, -h * 0.72);
      drawLantern(ctx, h * 0.42, time, 5);
      ctx.restore();
      break;
    }
    case 'banner': {
      const h = 86 * s;
      const w = h * 0.5;
      shade(w * 0.42);
      ctx.strokeStyle = '#5b4632';
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -h);
      ctx.stroke();
      ctx.fillStyle = '#0d2b3a';
      ctx.beginPath();
      ctx.moveTo(-w * 0.1, -h);
      ctx.lineTo(w * 0.95, -h);
      ctx.lineTo(w * 0.95, -h * 0.5);
      ctx.lineTo(w * 0.42, -h * 0.62);
      ctx.lineTo(-w * 0.1, -h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff5c17';
      ctx.font = '800 ' + Math.round(h * 0.2) + "px 'Baloo 2', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('$POG', w * 0.42, -h * 0.68);
      break;
    }
    case 'throne': {
      const w = 62 * s;
      shade(w * 0.54);
      const g = ctx.createLinearGradient(-w * 0.4, -w * 1.5, w * 0.4, 0);
      g.addColorStop(0, '#eafaff');
      g.addColorStop(0.5, '#a8dff5');
      g.addColorStop(1, '#5fb0d4');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w * 0.42, 0);
      ctx.lineTo(-w * 0.42, -w * 1.5);
      ctx.lineTo(-w * 0.2, -w * 1.2);
      ctx.lineTo(0, -w * 1.62);
      ctx.lineTo(w * 0.2, -w * 1.2);
      ctx.lineTo(w * 0.42, -w * 1.5);
      ctx.lineTo(w * 0.42, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2 * s;
      ctx.stroke();
      ctx.fillStyle = 'rgba(122,190,220,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.52, w * 0.34, w * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** A ghost of a piece, following the cursor while you decide where it goes. */
export function drawFurnitureGhost(
  ctx: CanvasRenderingContext2D,
  id: string,
  sx: number,
  sy: number,
  s: number,
  ok: boolean,
  time: number
) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  drawFurniture(ctx, id, sx, sy, s, time);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = ok ? 'rgba(82,214,163,0.95)' : 'rgba(240,96,72,0.95)';
  ctx.fillStyle = ok ? 'rgba(82,214,163,0.16)' : 'rgba(240,96,72,0.16)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.ellipse(sx, sy, 34 * s, 34 * s * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A furnishing drawn small, for a shop row or an inventory slot. */
export function furnitureThumb(id: string, size = 44): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.translate(size / 2, size * 0.84);
  drawFurniture(ctx, id, 0, 0, size / 120, 0);
  return c.toDataURL();
}

/**
 * The igloo market: a little office with a board of listings outside,
 * and a model igloo on the counter so it reads as an estate agent.
 */
export function drawMarketHouse(ctx: CanvasRenderingContext2D, h: number) {
  const w = h * 1.2;

  // walls
  ctx.fillStyle = '#e9f4fa';
  ctx.beginPath();
  ctx.roundRect(-w * 0.44, -h * 0.68, w * 0.88, h * 0.68, 4);
  ctx.fill();
  ctx.strokeStyle = '#8fb6cc';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // snow-laden roof
  ctx.fillStyle = '#0d5d5a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.54, -h * 0.66);
  ctx.lineTo(0, -h * 0.98);
  ctx.lineTo(w * 0.54, -h * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.54, -h * 0.66);
  ctx.lineTo(0, -h * 0.98);
  ctx.lineTo(w * 0.1, -h * 0.79);
  ctx.lineTo(-w * 0.3, -h * 0.72);
  ctx.closePath();
  ctx.fill();

  // a board of listings on the wall
  ctx.fillStyle = '#6b513a';
  ctx.beginPath();
  ctx.roundRect(-w * 0.36, -h * 0.58, w * 0.34, h * 0.36, 3);
  ctx.fill();
  ctx.fillStyle = '#f4f0e6';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.roundRect(-w * 0.33, -h * (0.54 - i * 0.1), w * 0.28, h * 0.07, 1.5);
    ctx.fill();
  }

  // doorway
  ctx.fillStyle = '#2b4d5e';
  ctx.beginPath();
  ctx.roundRect(w * 0.1, -h * 0.4, w * 0.2, h * 0.4, [4, 4, 0, 0]);
  ctx.fill();

  // a model igloo on the counter, for sale
  ctx.fillStyle = '#d9ecf6';
  ctx.beginPath();
  ctx.ellipse(-w * 0.19, -h * 0.68, w * 0.09, h * 0.09, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8fb6cc';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/**
 * The snowball arena: a low-walled rink of packed snow with two flags, a
 * pile of ready-made snowballs at each end, and a scoreboard post. Drawn
 * with its footprint at the origin, `h` tall.
 */
export function drawArenaRink(ctx: CanvasRenderingContext2D, h: number, time: number) {
  const w = h * 2.2;
  const d = h * 0.62; // the rink's depth on screen

  // packed-snow floor with a faint centre line
  ctx.fillStyle = '#dceefb';
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5, d * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,170,205,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -d * 0.42);
  ctx.lineTo(0, d * 0.42);
  ctx.stroke();

  // the wall: a snow bank all the way round
  ctx.strokeStyle = '#f6fbff';
  ctx.lineWidth = h * 0.16;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5, d * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,200,225,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5 + h * 0.08, d * 0.5 + h * 0.08, 0, 0, Math.PI * 2);
  ctx.stroke();

  // snowball piles at each end
  for (const side of [-1, 1]) {
    const px = side * w * 0.34;
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy, r] of [
      [-7, 2, 6],
      [7, 2, 6],
      [0, 3, 6.5],
      [0, -5, 5.5],
    ]) {
      ctx.beginPath();
      ctx.arc(px + dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150,190,215,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, 3, 6.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // two flags, one per corner, flapping
  const flap = Math.sin(time / 260) * 3;
  for (const [fx, colour] of [
    [-w * 0.46, '#ff5c17'],
    [w * 0.46, '#38bdf8'],
  ] as Array<[number, string]>) {
    ctx.strokeStyle = '#4e321c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(fx, -d * 0.1);
    ctx.lineTo(fx, -h * 0.95);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(fx, -h * 0.95);
    ctx.lineTo(fx + 22 + flap, -h * 0.88);
    ctx.lineTo(fx, -h * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  // the scoreboard post at the back
  ctx.fillStyle = '#4e321c';
  ctx.fillRect(-3, -h * 0.9, 6, h * 0.55);
  ctx.fillStyle = '#0f2f38';
  ctx.beginPath();
  ctx.roundRect(-30, -h, 60, h * 0.22, 4);
  ctx.fill();
  ctx.fillStyle = '#ffd44d';
  ctx.font = `800 ${Math.max(8, h * 0.12)}px "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('0 : 0', 0, -h * 0.89);
}

/**
 * The bear caves: a snowy hill with a black mouth in it, icicles along the
 * lip, a warning post and a few paw prints leading in. Drawn with its
 * footprint at the origin, `h` tall.
 */
export function drawCaveMouth(ctx: CanvasRenderingContext2D, h: number, time: number) {
  const w = h * 1.9;

  // the hill: rock under snow
  ctx.fillStyle = '#5b6b7a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, 0);
  ctx.quadraticCurveTo(-w * 0.42, -h * 0.72, -w * 0.12, -h * 0.9);
  ctx.quadraticCurveTo(0, -h, w * 0.14, -h * 0.9);
  ctx.quadraticCurveTo(w * 0.44, -h * 0.7, w * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  // snow on top
  ctx.fillStyle = '#f2f8fd';
  ctx.beginPath();
  ctx.moveTo(-w * 0.44, -h * 0.34);
  ctx.quadraticCurveTo(-w * 0.4, -h * 0.72, -w * 0.12, -h * 0.9);
  ctx.quadraticCurveTo(0, -h, w * 0.14, -h * 0.9);
  ctx.quadraticCurveTo(w * 0.42, -h * 0.7, w * 0.44, -h * 0.36);
  ctx.quadraticCurveTo(w * 0.2, -h * 0.5, 0, -h * 0.44);
  ctx.quadraticCurveTo(-w * 0.2, -h * 0.5, -w * 0.44, -h * 0.34);
  ctx.closePath();
  ctx.fill();
  // rock cracks
  ctx.strokeStyle = 'rgba(30,40,52,0.5)';
  ctx.lineWidth = 1.5;
  for (const [x0, y0, x1, y1] of [
    [-w * 0.36, -h * 0.2, -w * 0.3, -h * 0.05],
    [w * 0.33, -h * 0.24, w * 0.38, -h * 0.08],
    [-w * 0.25, -h * 0.3, -w * 0.28, -h * 0.18],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // the mouth
  const mw = w * 0.3;
  const mh = h * 0.62;
  const grad = ctx.createLinearGradient(0, -mh, 0, 0);
  grad.addColorStop(0, '#05080c');
  grad.addColorStop(1, '#141c26');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-mw * 0.5, 0);
  ctx.quadraticCurveTo(-mw * 0.55, -mh, 0, -mh);
  ctx.quadraticCurveTo(mw * 0.55, -mh, mw * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  // a pair of eyes in the dark, blinking now and then
  const blink = Math.sin(time / 900) > 0.92;
  if (!blink) {
    ctx.fillStyle = '#ffd44d';
    ctx.beginPath();
    ctx.ellipse(-7, -mh * 0.42, 3, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(7, -mh * 0.42, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // icicles along the lip
  ctx.fillStyle = '#cfeafc';
  for (let i = -3; i <= 3; i++) {
    const ix = i * mw * 0.13;
    const iy = -mh * (1 - (i * i) / 60) + 2;
    const len = 8 + ((i * 7 + 13) % 9);
    ctx.beginPath();
    ctx.moveTo(ix - 3, iy);
    ctx.lineTo(ix + 3, iy);
    ctx.lineTo(ix, iy + len);
    ctx.closePath();
    ctx.fill();
  }

  // paw prints leading in
  ctx.fillStyle = 'rgba(80,100,120,0.55)';
  for (let i = 0; i < 4; i++) {
    const px = w * 0.42 - i * 18;
    const py = 14 - i * 2 + (i % 2) * 6;
    ctx.beginPath();
    ctx.ellipse(px, py, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(px + k * 3.2, py - 4.5, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // the warning post
  const sx = -w * 0.4;
  ctx.fillStyle = '#4e321c';
  ctx.fillRect(sx - 2.5, -h * 0.5, 5, h * 0.5);
  ctx.fillStyle = '#e8dcc3';
  ctx.beginPath();
  ctx.roundRect(sx - 24, -h * 0.58, 48, h * 0.16, 3);
  ctx.fill();
  ctx.strokeStyle = '#4e321c';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#7a1f1f';
  ctx.font = `800 ${Math.max(7, h * 0.09)}px "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BEARS', sx, -h * 0.5);
}

/**
 * The casino: a striped tent with a string of lights round the awning, a
 * big die over the door and a chip-shaped sign. Drawn with its footprint
 * at the origin, `h` tall.
 */
export function drawCasinoTent(ctx: CanvasRenderingContext2D, h: number, time: number) {
  const w = h * 1.6;
  const wallTop = -h * 0.5;

  // the ground rug
  ctx.fillStyle = '#7a1f3d';
  ctx.beginPath();
  ctx.ellipse(0, 4, w * 0.5, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // walls: striped canvas
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const x0 = -w * 0.44 + (i / stripes) * w * 0.88;
    const x1 = x0 + (w * 0.88) / stripes;
    ctx.fillStyle = i % 2 ? '#f6f1ea' : '#c2185b';
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x1, 0);
    ctx.lineTo(x1, wallTop);
    ctx.lineTo(x0, wallTop);
    ctx.closePath();
    ctx.fill();
  }
  // the door
  const grad = ctx.createLinearGradient(0, wallTop, 0, 0);
  grad.addColorStop(0, '#2a0a18');
  grad.addColorStop(1, '#5a1533');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, 0);
  ctx.lineTo(-w * 0.12, wallTop * 0.7);
  ctx.quadraticCurveTo(0, wallTop * 1.05, w * 0.12, wallTop * 0.7);
  ctx.lineTo(w * 0.12, 0);
  ctx.closePath();
  ctx.fill();
  // a warm glow out of it
  const glow = ctx.createRadialGradient(0, -4, 2, 0, -4, w * 0.3);
  glow.addColorStop(0, 'rgba(255,200,120,0.45)');
  glow.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.36);

  // the roof: a peaked canvas with a scalloped awning
  ctx.fillStyle = '#c2185b';
  ctx.beginPath();
  ctx.moveTo(-w * 0.52, wallTop);
  ctx.lineTo(0, -h);
  ctx.lineTo(w * 0.52, wallTop);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6f1ea';
  for (let i = 0; i < 6; i++) {
    const x0 = -w * 0.52 + (i / 6) * w * 1.04;
    if (i % 2) continue;
    const x1 = x0 + w * 1.04 / 6;
    ctx.beginPath();
    ctx.moveTo(x0, wallTop);
    ctx.lineTo(x1, wallTop);
    ctx.lineTo(x1 * (0.001), -h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f6f1ea';
  for (let i = 0; i < 9; i++) {
    const cx = -w * 0.5 + (i / 8) * w;
    ctx.beginPath();
    ctx.arc(cx, wallTop, w / 16, 0, Math.PI);
    ctx.fill();
  }
  // lights along the awning, chasing
  const colours = ['#ffd44d', '#38bdf8', '#ff5c17', '#7cd67c'];
  for (let i = 0; i < 13; i++) {
    const cx = -w * 0.5 + (i / 12) * w;
    const on = Math.floor(time / 180 + i) % 3 === 0;
    ctx.fillStyle = colours[i % colours.length];
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.beginPath();
    ctx.arc(cx, wallTop + w / 16 + 3, 3, 0, Math.PI * 2);
    ctx.fill();
    if (on) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(cx, wallTop + w / 16 + 3, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // a big die on top, tilted
  ctx.save();
  ctx.translate(0, -h - 12);
  ctx.rotate(Math.sin(time / 900) * 0.12);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(-13, -13, 26, 26, 5);
  ctx.fill();
  ctx.strokeStyle = '#7a1f3d';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#c2185b';
  for (const [dx, dy] of [
    [-7, -7],
    [7, -7],
    [0, 0],
    [-7, 7],
    [7, 7],
  ]) {
    ctx.beginPath();
    ctx.arc(dx, dy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // a stack of chips by the door
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ['#38bdf8', '#ffd44d', '#ff5c17'][i];
    ctx.beginPath();
    ctx.ellipse(w * 0.3, -3 - i * 4, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
