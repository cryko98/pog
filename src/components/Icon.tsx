/**
 * Inline SVG icon set.
 *
 * Emoji were the first cut, but the newer ones — 🪵 U+1FAB5 and 🪙 U+1FA99,
 * both Emoji 12/13 — have no glyph in the default Windows font and render as
 * empty boxes. These draw the same shapes as paths, so every icon looks the
 * same on every machine and can take the surrounding text colour.
 */

export type IconName =
  | 'wood'
  | 'ice'
  | 'fish'
  | 'coin'
  | 'rod'
  | 'igloo'
  | 'backpack'
  | 'trophy'
  | 'palette'
  | 'close'
  | 'lock'
  | 'power'
  | 'play'
  | 'penguin'
  | 'guest'
  | 'warning'
  | 'world'
  | 'players'
  | 'key'
  | 'snowflake';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  /** decorative by default; pass a label when the icon carries meaning alone */
  label?: string;
}

/** Each entry draws inside a 24×24 box. */
const PATHS: Record<IconName, React.ReactNode> = {
  wood: (
    <>
      <path
        d="M6 7.5h9a4.5 4.5 0 0 1 0 9H6a4.5 4.5 0 0 1 0-9Z"
        fill="#8a5f3c"
        stroke="#5b3f27"
        strokeWidth="1.4"
      />
      <ellipse cx="6" cy="12" rx="2.6" ry="4.5" fill="#c08b57" stroke="#5b3f27" strokeWidth="1.4" />
      <ellipse cx="6" cy="12" rx="1.1" ry="2" fill="none" stroke="#5b3f27" strokeWidth="1" />
    </>
  ),
  ice: (
    <>
      <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6Z" fill="#bfe6f7" stroke="#5aa6c9" strokeWidth="1.4" />
      <path d="M12 3.2v17.6M4 7.6l8 4.4 8-4.4" fill="none" stroke="#5aa6c9" strokeWidth="1.3" />
      <path d="M6.5 6.4 12 9.4l5.5-3" fill="none" stroke="#ffffff" strokeWidth="1.1" opacity=".8" />
    </>
  ),
  fish: (
    <>
      <path
        d="M3.5 12c2.6-3.6 6-5.4 9.2-5.4 3.3 0 5.9 1.9 7.3 5.4-1.4 3.5-4 5.4-7.3 5.4-3.2 0-6.6-1.8-9.2-5.4Z"
        fill="#4fb3d9"
        stroke="#23708f"
        strokeWidth="1.3"
      />
      <path d="M20 12c1.2-1 2-1.9 2.4-2.8v5.6c-.4-.9-1.2-1.8-2.4-2.8Z" fill="#4fb3d9" stroke="#23708f" strokeWidth="1.3" />
      <circle cx="9" cy="10.8" r="1.1" fill="#0d3b4d" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.4" fill="#ffc93c" stroke="#b8790d" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="5.8" fill="none" stroke="#e8a81c" strokeWidth="1.2" />
      <path
        d="M10.1 15.6V8.4h2.6a2.4 2.4 0 0 1 0 4.8h-2.6"
        fill="none"
        stroke="#8a5a08"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  rod: (
    <>
      <path d="M4 20 17 5.4" stroke="#8a5f3c" strokeWidth="2" strokeLinecap="round" />
      <path d="M17 5.4c1.6.6 2.4 1.7 2.6 3.2" fill="none" stroke="#8a5f3c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19.6 8.6v5.2" stroke="#9fc4d2" strokeWidth="1.1" />
      <path d="M18.4 13.8a1.6 1.6 0 1 0 2.4 1.9" fill="none" stroke="#5aa6c9" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  igloo: (
    <>
      <path d="M2.6 17.6a9.4 9.4 0 0 1 18.8 0Z" fill="#e8f4fc" stroke="#6f9bb5" strokeWidth="1.4" />
      <path d="M2.6 17.6h18.8" stroke="#6f9bb5" strokeWidth="1.4" />
      <path d="M6 12.6c1 .3 2 .5 3.1.6M14.9 13.2c1.1-.1 2.1-.3 3.1-.6" fill="none" stroke="#6f9bb5" strokeWidth="1.1" />
      <path d="M9.4 17.6v-2.4a2.6 2.6 0 0 1 5.2 0v2.4Z" fill="#2b5567" stroke="#6f9bb5" strokeWidth="1.3" />
    </>
  ),
  backpack: (
    <>
      <path d="M9 4.6a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="4.4" y="6.6" width="15.2" height="13.4" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20v-4.4a3 3 0 0 1 6 0V20" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.6 12.4h14.8" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.6 4h8.8v5.2a4.4 4.4 0 0 1-8.8 0Z" fill="#ffc93c" stroke="#b8790d" strokeWidth="1.4" />
      <path d="M7.6 5.4H5a2.6 2.6 0 0 0 2.6 4.4M16.4 5.4H19a2.6 2.6 0 0 1-2.6 4.4" fill="none" stroke="#b8790d" strokeWidth="1.4" />
      <path d="M12 13.6V17M8.6 20h6.8" stroke="#b8790d" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  palette: (
    <>
      <path
        d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 2-.8 2-1.8 0-1.4-1.2-1.7-1.2-2.8 0-.8.7-1.4 1.6-1.4h1.7c2.5 0 4.5-2 4.5-4.6 0-3.7-3.8-6.6-8.6-6.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8" cy="10.4" r="1.3" fill="#ff5c17" />
      <circle cx="11.4" cy="7.4" r="1.3" fill="#38bdf8" />
      <circle cx="15.4" cy="8.6" r="1.3" fill="#34d399" />
    </>
  ),
  close: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  lock: (
    <>
      <rect x="5" y="10.4" width="14" height="9.4" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="14.8" r="1.4" fill="currentColor" />
    </>
  ),
  power: (
    <>
      <path d="M12 3.6v7.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.2 6.9a6.8 6.8 0 1 0 9.6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  play: <path d="M8 5.4 19 12 8 18.6Z" fill="currentColor" />,
  penguin: (
    <>
      <ellipse cx="12" cy="14.4" rx="6.4" ry="6.6" fill="currentColor" />
      <ellipse cx="12" cy="8.6" rx="5.4" ry="5" fill="currentColor" />
      <circle cx="9.9" cy="8.2" r="1.9" fill="#ffffff" />
      <circle cx="14.1" cy="8.2" r="1.8" fill="#ffffff" />
      <ellipse cx="12" cy="11.4" rx="2.6" ry="2.2" fill="#ff5c17" />
    </>
  ),
  guest: (
    <>
      <circle cx="12" cy="8.2" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.8 21.6 20H2.4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 9.6v4.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </>
  ),
  world: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.6 9.4h16.8M3.6 14.6h16.8" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  players: (
    <>
      <circle cx="9" cy="8.6" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.8 19.6a6.2 6.2 0 0 1 12.4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 5.6a3.4 3.4 0 0 1 0 6.6M17.4 14a6.2 6.2 0 0 1 3.8 5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12.2 12H21M18 12v3.4M15.2 12v2.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12 6.6 9.8 4.6M12 6.6l2.2-2M12 17.4l-2.2 2M12 17.4l2.2 2M7.2 9.4 4.4 9.6M7.2 9.4 6 6.9M16.8 14.6l2.8-.2M16.8 14.6l1.2 2.5M7.2 14.6l-2.8.2M7.2 14.6 6 17.1M16.8 9.4l2.8-.2M16.8 9.4 18 6.9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
};

export function Icon({ name, size = 18, className, label }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
