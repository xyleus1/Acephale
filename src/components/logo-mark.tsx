type LogoMarkProps = {
  mini?: boolean;
  className?: string;
};

export function LogoMark({ mini = false, className }: LogoMarkProps) {
  const classes = ["brand-mark", mini ? "brand-mark-mini" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img" focusable="false">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#eaf2fb" />
        <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#7db3e3" />

        <g transform="rotate(-44 32 32)">
          <path d="M31 6.2L32 3.5L33 6.2L35 39H29L31 6.2Z" fill="#1f5d96" stroke="#0a1f3a" strokeWidth="0.8" />
          <path d="M32 9.5V35.5" stroke="#b8d8f4" strokeWidth="1.1" strokeLinecap="round" opacity="0.92" />
          <path d="M22.2 38.1H41.8L39 43.2H25L22.2 38.1Z" fill="#2f7fb7" stroke="#0a1f3a" strokeWidth="0.8" />
          <rect x="29.1" y="41.8" width="5.8" height="10.6" rx="2.3" fill="#0a1f3a" />
          <circle cx="32" cy="54.2" r="3.2" fill="#2f7fb7" stroke="#0a1f3a" strokeWidth="0.8" />
        </g>

        <g transform="rotate(44 32 32)">
          <path d="M31 6.2L32 3.5L33 6.2L35 39H29L31 6.2Z" fill="#123f70" stroke="#0a1f3a" strokeWidth="0.8" />
          <path d="M32 9.5V35.5" stroke="#d8ebfb" strokeWidth="1.1" strokeLinecap="round" opacity="0.92" />
          <path d="M22.2 38.1H41.8L39 43.2H25L22.2 38.1Z" fill="#5aa0d7" stroke="#0a1f3a" strokeWidth="0.8" />
          <rect x="29.1" y="41.8" width="5.8" height="10.6" rx="2.3" fill="#0a1f3a" />
          <circle cx="32" cy="54.2" r="3.2" fill="#5aa0d7" stroke="#0a1f3a" strokeWidth="0.8" />
        </g>

        <g fill="none" stroke="#0a1f3a" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="13.5" r="5.4" strokeWidth="3.8" />
          <path d="M32 19.5V43.5" strokeWidth="5.2" />
          <path d="M21.5 25H42.5" strokeWidth="5.2" />
          <path d="M17.2 38.7C18.9 48.9 26.8 53.9 32 45.2C37.2 53.9 45.1 48.9 46.8 38.7" strokeWidth="5" />
        </g>
        <path d="M14.7 38.2L24.1 35.7L20.4 45.4Z" fill="#0a1f3a" />
        <path d="M49.3 38.2L39.9 35.7L43.6 45.4Z" fill="#0a1f3a" />
        <path d="M28.4 42.2H35.6L32 50.8Z" fill="#0a1f3a" />
      </svg>
    </span>
  );
}
