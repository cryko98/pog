interface Props {
  scarf?: string;
  size?: number | string;
  className?: string;
}

/** The $POG penguin as vector art — same shapes the in-game sprite uses. */
export function PenguinMark({ scarf = '#ff6b2c', size, className }: Props) {
  return (
    <svg
      viewBox="0 0 200 220"
      className={className}
      style={size ? { width: size, height: 'auto' } : undefined}
      role="img"
      aria-label="POG penguin"
    >
      <defs>
        <linearGradient id="pm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#42424a" />
          <stop offset="55%" stopColor="#26262a" />
          <stop offset="100%" stopColor="#121214" />
        </linearGradient>
        <radialGradient id="pm-shine" cx="34%" cy="24%" r="48%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* flippers */}
      <ellipse cx="26" cy="146" rx="15" ry="34" fill="#17171a" transform="rotate(-14 26 146)" />
      <ellipse cx="174" cy="146" rx="15" ry="34" fill="#17171a" transform="rotate(14 174 146)" />

      {/* feet */}
      <ellipse cx="76" cy="206" rx="20" ry="10" fill="#d8450c" />
      <ellipse cx="124" cy="206" rx="20" ry="10" fill="#d8450c" />
      <ellipse cx="76" cy="203" rx="18" ry="8.5" fill="#ff5c17" />
      <ellipse cx="124" cy="203" rx="18" ry="8.5" fill="#ff5c17" />

      {/* torso */}
      <path
        d="M36 150c-6-46 16-72 64-72s70 26 64 72c-4 33-28 52-64 52s-60-19-64-52z"
        fill="url(#pm-body)"
      />
      {/* head */}
      <ellipse cx="100" cy="82" rx="66" ry="62" fill="url(#pm-body)" />
      <ellipse cx="100" cy="82" rx="66" ry="62" fill="url(#pm-shine)" />

      {/* scarf */}
      <path d="M38 134c20 14 42 20 62 20s42-6 62-20v22c-20 14-42 20-62 20s-42-6-62-20z" fill={scarf} />
      <path d="M150 152c10 16 12 32 8 46l-20-5c4-14 2-28-6-40z" fill={scarf} />
      <path
        d="M38 146c20 14 42 20 62 20s42-6 62-20v10c-20 14-42 20-62 20s-42-6-62-20z"
        fill="#000"
        opacity="0.22"
      />

      {/* eyes */}
      <circle cx="72" cy="76" r="23" fill="#cfd6db" />
      <circle cx="72" cy="74" r="22" fill="#f1f3f5" />
      <circle cx="70" cy="76" r="4.6" fill="#141416" />
      <circle cx="131" cy="76" r="21" fill="#cfd6db" />
      <circle cx="131" cy="74" r="20" fill="#f1f3f5" />
      <circle cx="129" cy="76" r="4.2" fill="#141416" />

      {/* beak */}
      <ellipse cx="103" cy="118" rx="38" ry="33" fill="#d8450c" />
      <ellipse cx="103" cy="115" rx="38" ry="33" fill="#ff5c17" />
      <ellipse cx="104" cy="117" rx="20.5" ry="18.5" fill="#121214" />
    </svg>
  );
}
