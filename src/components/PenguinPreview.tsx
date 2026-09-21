import { useEffect, useRef } from 'react';
import { drawPenguin } from '../game/penguin';

interface Props {
  scarf: string;
  hat: string | null;
  size?: number;
}

/**
 * The shop sells looks, so it should show them. This draws the real
 * in-game penguin with the hat applied, using the same vector routine the
 * sprite sheet is built from — what you see is exactly what you will wear.
 */
export function PenguinPreview({ scarf, hat, size = 46 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // the penguin is drawn feet-at-origin and stands ~120 units tall with a hat
    const scale = size / 124;
    ctx.translate(size / 2, size * 0.96);
    ctx.scale(scale, scale);
    drawPenguin(ctx, 'down', 0, scarf, false, hat);
  }, [scarf, hat, size]);

  return <canvas ref={ref} className="penguin-preview" style={{ width: size, height: size }} />;
}
