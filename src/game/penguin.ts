// The $POG penguin, drawn from vector paths to match the project artwork
// (round matte-black body, big white eyes, fat orange ring beak).
// Rendered once per scarf colour into a sprite sheet, then blitted per frame.

export type Dir = 'down' | 'left' | 'right' | 'up';

export const DIRS: Dir[] = ['down', 'left', 'right', 'up'];
export const FRAMES = 4; // walk-cycle frames
const COLS = FRAMES + 1; // column 0 holds the idle pose
export const CELL = 120; // logical px per sprite cell
export const FOOT_Y = 104; // where the feet sit inside a cell
export const PENGUIN_HEIGHT = 84; // world units, feet to crown

const SS = 2; // supersample so the sheet stays crisp on retina

const BODY_DARK = '#141416';
const BODY_MID = '#2c2c2f';
const BODY_LIGHT = '#3d3d41';
const EYE_WHITE = '#f1f3f5';
const EYE_SHADE = '#cfd6db';
const BEAK = '#ff5c17';
const BEAK_SHADE = '#d8450c';
const MOUTH = '#120f10';

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

/** Body silhouette: a wide torso blob with an oversized head fused on top. */
function drawSilhouette(ctx: CanvasRenderingContext2D, headX: number) {
  const grad = ctx.createLinearGradient(0, -86, 0, 0);
  grad.addColorStop(0, BODY_LIGHT);
  grad.addColorStop(0.45, BODY_MID);
  grad.addColorStop(1, BODY_DARK);
  ctx.fillStyle = grad;

  // torso
  ctx.beginPath();
  ctx.moveTo(-30, -20);
  ctx.bezierCurveTo(-33, -46, -22, -60, 0, -60);
  ctx.bezierCurveTo(22, -60, 33, -46, 30, -20);
  ctx.bezierCurveTo(28, -6, 17, 0, 0, 0);
  ctx.bezierCurveTo(-17, 0, -28, -6, -30, -20);
  ctx.closePath();
  ctx.fill();

  // head
  ellipse(ctx, headX, -58, 28, 26);
}

function drawFlipper(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.fillStyle = BODY_DARK;
  ellipse(ctx, x, y, 7.5, 16, rot);
}

function drawFeet(ctx: CanvasRenderingContext2D, leftLift: number, rightLift: number) {
  ctx.fillStyle = BEAK_SHADE;
  ellipse(ctx, -11, -2 - leftLift, 9.5, 5);
  ellipse(ctx, 11, -2 - rightLift, 9.5, 5);
  ctx.fillStyle = BEAK;
  ellipse(ctx, -11, -3 - leftLift, 8.5, 4.2);
  ellipse(ctx, 11, -3 - rightLift, 8.5, 4.2);
}

function drawScarf(ctx: CanvasRenderingContext2D, color: string, sway: number, back: boolean) {
  ctx.save();
  ctx.fillStyle = color;
  // neck band
  ctx.beginPath();
  ctx.moveTo(-27, -36);
  ctx.quadraticCurveTo(0, -26, 27, -36);
  ctx.lineTo(27, -27);
  ctx.quadraticCurveTo(0, -17, -27, -27);
  ctx.closePath();
  ctx.fill();

  // hanging tail
  ctx.beginPath();
  const tx = back ? -18 : 20;
  ctx.moveTo(tx, -31);
  ctx.quadraticCurveTo(tx + sway * 5 + 6, -20, tx + sway * 7 + 2, -6);
  ctx.lineTo(tx + sway * 7 - 7, -5);
  ctx.quadraticCurveTo(tx + sway * 4 - 5, -20, tx - 8, -30);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(-27, -30);
  ctx.quadraticCurveTo(0, -20, 27, -30);
  ctx.lineTo(27, -27);
  ctx.quadraticCurveTo(0, -17, -27, -27);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pupilDx: number) {
  ctx.fillStyle = EYE_SHADE;
  ellipse(ctx, x, y + 0.8, r, r);
  ctx.fillStyle = EYE_WHITE;
  ellipse(ctx, x, y, r * 0.95, r * 0.95);
  ctx.fillStyle = MOUTH;
  ellipse(ctx, x + pupilDx, y + 0.6, r * 0.2, r * 0.22);
}

/** The signature beak: a thick orange ring around an open dark mouth. */
function drawBeak(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = BEAK_SHADE;
  ellipse(ctx, x, y + 1.5, rx, ry);
  ctx.fillStyle = BEAK;
  ellipse(ctx, x, y, rx, ry);
  ctx.fillStyle = MOUTH;
  ellipse(ctx, x + rx * 0.05, y + ry * 0.06, rx * 0.54, ry * 0.56);
}

function drawFace(ctx: CanvasRenderingContext2D, dir: Dir) {
  if (dir === 'up') {
    // back of the head: just a soft highlight
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#9fd8ff';
    ellipse(ctx, -8, -66, 12, 8, -0.3);
    ctx.restore();
    return;
  }
  if (dir === 'down') {
    drawEye(ctx, -12, -61, 9.5, -0.6);
    drawEye(ctx, 12.5, -61, 8.8, -0.6);
    drawBeak(ctx, 1.5, -44, 15.5, 13);
    return;
  }
  const s = dir === 'left' ? -1 : 1;
  drawEye(ctx, 11 * s, -62, 9.2, -0.8 * s);
  ctx.save();
  ctx.globalAlpha = 0.85;
  drawEye(ctx, -9 * s, -62.5, 6.4, -0.5 * s);
  ctx.restore();
  drawBeak(ctx, 19 * s, -47, 13.5, 11);
}


/* ------------------------------------------------------------------ *
 * Hats — the shop's whole inventory
 * ------------------------------------------------------------------ */

/** Drawn in head space: the crown of the skull sits at about y = -84. */
function drawHat(ctx: CanvasRenderingContext2D, hat: string, dir: Dir) {
  const back = dir === 'up';
  ctx.save();
  switch (hat) {
    case 'beanie': {
      ctx.fillStyle = '#2f6f8f';
      ctx.beginPath();
      ctx.ellipse(0, -76, 27, 20, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d8cb3';
      ctx.beginPath();
      ctx.roundRect(-28, -78, 56, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#eaf6ff';
      ctx.beginPath();
      ctx.arc(0, -96, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'santa': {
      ctx.fillStyle = '#d3312f';
      ctx.beginPath();
      ctx.moveTo(-26, -76);
      ctx.quadraticCurveTo(-6, -104, 26, -92);
      ctx.quadraticCurveTo(6, -80, 26, -76);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fbfbfb';
      ctx.beginPath();
      ctx.roundRect(-29, -80, 58, 10, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(26, -92, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'earmuffs': {
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, -70, 29, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.ellipse(-28, -66, 9, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(28, -66, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.fillStyle = 'rgba(190,232,248,0.95)';
      ctx.beginPath();
      ctx.moveTo(-24, -78);
      ctx.lineTo(-24, -92);
      ctx.lineTo(-12, -84);
      ctx.lineTo(0, -100);
      ctx.lineTo(12, -84);
      ctx.lineTo(24, -92);
      ctx.lineTo(24, -78);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, -82, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cap': {
      ctx.fillStyle = '#1f7a5a';
      ctx.beginPath();
      ctx.ellipse(0, -78, 27, 19, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (!back) {
        ctx.fillStyle = '#2a9c74';
        ctx.beginPath();
        ctx.ellipse(-30, -78, 14, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ff5c17';
      ctx.beginPath();
      ctx.arc(0, -95, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw a penguin with its feet at the current origin, facing `dir`.
 * `frame` drives the waddle: a vertical bob plus an alternating body tilt.
 */
export function drawPenguin(
  ctx: CanvasRenderingContext2D,
  dir: Dir,
  frame: number,
  scarfColor: string,
  moving: boolean,
  hat: string | null = null
) {
  const f = moving ? frame % FRAMES : 0;
  const bob = moving ? [0, -2.5, 0, -2.5][f] : 0;
  const tilt = moving ? [0, -0.06, 0, 0.06][f] : 0;
  const leftLift = moving ? [0, 5, 0, 0][f] : 0;
  const rightLift = moving ? [0, 0, 0, 5][f] : 0;
  const headX = dir === 'left' ? -3 : dir === 'right' ? 3 : 0;

  ctx.save();
  drawFeet(ctx, leftLift, rightLift);
  ctx.translate(0, bob);
  ctx.rotate(tilt);

  // back flipper first so it reads behind the torso
  if (dir !== 'left') drawFlipper(ctx, 28, -30, moving ? 0.35 + tilt * 2 : 0.18);
  if (dir !== 'right') drawFlipper(ctx, -28, -30, moving ? -0.35 + tilt * 2 : -0.18);

  drawSilhouette(ctx, headX);
  drawScarf(ctx, scarfColor, tilt * 8, dir === 'up');

  ctx.save();
  ctx.translate(headX, 0);
  drawFace(ctx, dir);
  if (hat) drawHat(ctx, hat, dir);
  ctx.restore();

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Sprite sheet cache — one sheet per scarf colour
 * ------------------------------------------------------------------ */

const sheets = new Map<string, HTMLCanvasElement>();

/** One sheet per look, keyed by scarf colour and hat. */
export function getPenguinSheet(scarfColor: string, hat: string | null = null): HTMLCanvasElement {
  const key = scarfColor + (hat ? '|' + hat : '');
  const cached = sheets.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = CELL * COLS * SS;
  canvas.height = CELL * DIRS.length * SS;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SS, SS);

  DIRS.forEach((dir, row) => {
    for (let col = 0; col < COLS; col++) {
      ctx.save();
      ctx.translate(col * CELL + CELL / 2, row * CELL + FOOT_Y);
      drawPenguin(ctx, dir, col - 1, scarfColor, col > 0, hat);
      ctx.restore();
    }
  });

  sheets.set(key, canvas);
  return canvas;
}

/** Blit a cached penguin so its feet land on (x, y) in screen space. */
export function blitPenguin(
  ctx: CanvasRenderingContext2D,
  scarfColor: string,
  dir: Dir,
  frame: number,
  moving: boolean,
  x: number,
  y: number,
  height: number,
  hat: string | null = null
) {
  const sheet = getPenguinSheet(scarfColor, hat);
  const row = Math.max(0, DIRS.indexOf(dir));
  const col = moving ? 1 + (((frame % FRAMES) + FRAMES) % FRAMES) : 0;
  const scale = height / PENGUIN_HEIGHT;
  const w = CELL * scale;
  const h = CELL * scale;
  ctx.drawImage(
    sheet,
    col * CELL * SS,
    row * CELL * SS,
    CELL * SS,
    CELL * SS,
    x - w / 2,
    y - FOOT_Y * scale,
    w,
    h
  );
}
