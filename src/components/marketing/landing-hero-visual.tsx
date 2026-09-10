/**
 * Full-bleed cadastral grid + shield-pin mark for the marketing hero.
 * Mobile: smaller shield in the upper field so copy stays clear at the bottom.
 */
export function LandingHeroVisual() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(58,160,184,0.32),transparent_55%),radial-gradient(ellipse_70%_55%_at_85%_40%,rgba(58,160,184,0.22),transparent_60%),radial-gradient(ellipse_50%_40%_at_10%_90%,rgba(36,90,114,0.55),transparent_55%)]" />

      <svg
        className="landing-grid-drift absolute inset-0 h-full w-full opacity-[0.28] md:opacity-[0.35]"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern
            id="landing-cadastre"
            width="72"
            height="72"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 0h72v72H0z"
              fill="none"
              stroke="rgba(247,245,240,0.22)"
              strokeWidth="1"
            />
            <path
              d="M36 0v72M0 36h72"
              fill="none"
              stroke="rgba(247,245,240,0.12)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#landing-cadastre)" />
      </svg>

      {/* Mobile: upper-right mark. Desktop: large side focal. */}
      <div
        className="absolute top-[4.5rem] right-[-8%] h-[42vmin] w-[42vmin] max-h-[240px] max-w-[240px] opacity-80 sm:top-24 sm:right-0 sm:h-[46vmin] sm:w-[46vmin] sm:max-h-[280px] sm:max-w-[280px] md:right-[2%] md:top-1/2 md:h-[min(72%,520px)] md:w-auto md:max-h-none md:max-w-[46vw] md:-translate-y-1/2 md:opacity-90"
      >
        <svg
          className="landing-shield-rise h-full w-full md:w-auto"
          viewBox="0 0 200 240"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            fill="rgba(247,245,240,0.94)"
            d="M100 12 176 42v68c0 48-33 92-76 106C57 202 24 158 24 110V42L100 12Z"
          />
          <path
            fill="#245A72"
            d="M100 72c-18 0-32.5 14-32.5 31.5 0 22.5 26 55.5 30.5 61a2.8 2.8 0 0 0 4 0c4.5-5.5 30.5-38.5 30.5-61C132.5 86 118 72 100 72Zm0 44.5a13 13 0 1 1 0-26 13 13 0 0 1 0 26Z"
          />
        </svg>
      </div>

      {/* Mobile readability scrim over lower half */}
      <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[#1A3F52] via-[#1A3F52]/92 to-transparent md:hidden" />
      <div className="absolute inset-y-0 left-0 hidden w-[58%] bg-gradient-to-r from-[#1A3F52] via-[#1A3F52]/80 to-transparent md:block" />
    </div>
  )
}
