/**
 * A polar bear, drawn from shapes: white fur, a long head, a black nose.
 * Used on all fours in the caves (walking at you) and on the casino's
 * race track (running away from you).
 */

/**
 * A polar bear on all fours, walking left, drawn with its feet at
 * (x, ground) and `h` tall. `swipe` is -1 when it is not swiping, else
 * 0..1 through the swing.
 */
export function drawBear(ctx: CanvasRenderingContext2D, x: number, ground: number, h: number, now: number, walking: boolean, swipe: number, hpFrac: number, facing: -1 | 1 = -1) {
  const s = h / 96;
  const bob = walking ? Math.sin(now / 110) * 3 * s : 0;
  ctx.save();
  ctx.translate(x, ground + bob);
  // drawn facing left; mirrored to face right
  if (facing === 1) ctx.scale(-1, 1);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, -bob - 2, 62 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const fur = '#f4f7fb';
  const fur2 = '#d9e4ee';
  // legs
  const stride = walking ? Math.sin(now / 110) * 10 * s : 0;
  ctx.fillStyle = fur2;
  for (const [lx, phase] of [
    [-38, 1],
    [-16, -1],
    [18, 1],
    [42, -1],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.roundRect(lx * s + stride * phase - 9 * s, -40 * s, 18 * s, 40 * s, 8 * s);
    ctx.fill();
  }
  // body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -58 * s, 60 * s, 34 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // head, out to the left
  ctx.beginPath();
  ctx.ellipse(-62 * s, -72 * s, 26 * s, 22 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = fur2;
  ctx.beginPath();
  ctx.arc(-52 * s, -92 * s, 7 * s, 0, Math.PI * 2);
  ctx.arc(-74 * s, -90 * s, 7 * s, 0, Math.PI * 2);
  ctx.fill();
  // snout
  ctx.fillStyle = fur2;
  ctx.beginPath();
  ctx.ellipse(-84 * s, -66 * s, 12 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(-93 * s, -68 * s, 4.5 * s, 3.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // eye
  ctx.beginPath();
  ctx.arc(-70 * s, -78 * s, 2.6 * s, 0, Math.PI * 2);
  ctx.fill();
  // a swipe: the front paw comes round
  if (swipe >= 0) {
    const a = -1.2 + swipe * 2.2;
    ctx.save();
    ctx.translate(-40 * s, -50 * s);
    ctx.rotate(a);
    ctx.fillStyle = fur2;
    ctx.beginPath();
    ctx.roundRect(-8 * s, 0, 16 * s, 46 * s, 8 * s);
    ctx.fill();
    ctx.fillStyle = '#333';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 5 * s - 2 * s, 44 * s);
      ctx.lineTo(k * 5 * s, 54 * s);
      ctx.lineTo(k * 5 * s + 2 * s, 44 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // health
  if (hpFrac < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-30 * s, -108 * s, 60 * s, 6 * s);
    ctx.fillStyle = hpFrac > 0.5 ? '#7cd67c' : '#ff6b6b';
    ctx.fillRect(-30 * s, -108 * s, 60 * s * hpFrac, 6 * s);
  }
  ctx.restore();
}
