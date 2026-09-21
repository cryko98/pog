/** Scarf palette. Kept in sync with SCARF_COLORS in src/server/game.ts. */
export const SCARF_COLORS = [
  '#ff6b2c',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#f87171',
  '#e2e8f0',
];

export const randomScarf = () => SCARF_COLORS[Math.floor(Math.random() * SCARF_COLORS.length)];
