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
