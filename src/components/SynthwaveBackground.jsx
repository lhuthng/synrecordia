import { memo, useEffect, useRef } from "react";

// ── Seeded LCG → deterministic star field ─────────────────────────────────────
const STARS = (() => {
  let s = 12345;
  const r = () => {
    s = (Math.imul(s, 1664525) + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  return Array.from({ length: 35 }, (_, id) => ({
    id,
    cx: r() * 160,
    cy: r() * 62,
    size: 0.4 + r() * 0.9, // overall star size (replaces radius)
    o: 0.25 + r() * 0.75,
    c: r() > 0.72 ? "var(--color-note-half-dark)" : "var(--color-note-half)",

    duration: 2 + r() * 4,
    delay: r() * -6,
    opacityBase: 0.4 + r() * 0.6,
  }));
})();

const getFourPointStarPoints = (cx, cy, size) => {
  const points = [];
  const spikes = 4; // 4-pointed star
  const outerRadius = size;
  const innerRadius = size * 0.35;

  for (let i = 0; i < spikes * 2; i++) {
    const angle = (Math.PI * 2 * i) / (spikes * 2) - Math.PI / 2; // start pointing up
    const radius = i % 2 === 0 ? outerRadius : innerRadius;

    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return points.join(" ");
};

const VP_Y = 67.5; // horizon y
const GROUND_H = 32.5;

const V_LINES = Array.from({ length: 20 }, (_, i) => {
  const t = i / 19;
  return {
    x2: t * 160, // top  x :   0 → 160
    y2: VP_Y,
    x1: -120 + t * 400, // bottom x: −120 → 280
    y1: 107, // just below max parallax viewport edge
  };
});

// 7 horizontal lines with t^2.5 spacing dense near the horizon, progressively wider toward the viewer.
const H_LINE_YS = Array.from({ length: 7 }, (_, i) => {
  const t = (i + 1) / 8;
  return VP_Y + GROUND_H * Math.pow(t, 2.5);
});

export default memo(function SynthwaveBackground() {
  const svgRef = useRef(null);

  useEffect(() => {
    let raf = null;

    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const shift = Math.min(window.scrollY * 0.02, 10);
        svgRef.current?.setAttribute("viewBox", `0 ${shift} 160 90`);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
        viewBox="0 0 160 90"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          {/* ── Sky gradient: deep-space navy → mauve → warm orange at horizon ── */}
          <linearGradient id="syn-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-dark)" />
            <stop offset="50%" stopColor="var(--color-dark)" />
            <stop offset="100%" stopColor="var(--color-note-half-dark)" />
          </linearGradient>

          {/* ── Ground gradient: hot-pink → deep purple → near-black ──*/}
          <linearGradient id="syn-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-pink)" />
            <stop offset="60%" stopColor="var(--color-accent-pink-dark)" />
            <stop offset="100%" stopColor="var(--color-dark)" />
          </linearGradient>

          {/* ── Atmospheric warm band centred on the horizon ── */}
          <linearGradient
            id="syn-atmo"
            x1="0"
            y1="62"
            x2="0"
            y2="73"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--color-dark)" stopOpacity="0" />
            <stop
              offset="62%"
              stopColor="var(--color-note-half)"
              stopOpacity="0.50"
            />
            <stop
              offset="100%"
              stopColor="var(--color-note-half-dark)"
              stopOpacity="0"
            />
          </linearGradient>

          {/* ── Grid opacity mask ── */}
          <linearGradient
            id="syn-grid-alpha"
            x1="0"
            y1="67.5"
            x2="0"
            y2="100"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="white" stopOpacity="0.05" />
            <stop offset="25%" stopColor="white" stopOpacity="0.30" />
            <stop offset="100%" stopColor="white" stopOpacity="0.70" />
          </linearGradient>
          <mask id="syn-grid-mask">
            <rect
              x="-150"
              y="67.5"
              width="500"
              height="35"
              fill="url(#syn-grid-alpha)"
            />
          </mask>

          {/* ── Horizon glow: blur + merge preserves a crisp bright core ── */}
          <filter
            id="syn-horizon-glow"
            filterUnits="userSpaceOnUse"
            x="0"
            y="62"
            width="160"
            height="12"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="0.55"
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter
            id="syn-atmo-blur"
            filterUnits="userSpaceOnUse"
            x="0"
            y="55"
            width="160"
            height="26"
          >
            <feGaussianBlur stdDeviation="1.5" />
          </filter>

          {/* ── Clip-path: confine grid strokes to the ground area ── */}
          <clipPath id="syn-ground-clip">
            <rect x="-150" y="67.5" width="500" height="35" />
          </clipPath>
        </defs>

        {/* ───────────────────── Sky ───────────────────── */}
        <rect x="0" y="0" width="160" height="67.5" fill="url(#syn-sky)" />

        {/* ───────────────────── Stars ───────────────────── */}
        {STARS.map((star) => (
          <g key={star.id} opacity={star.o}>
            <polygon
              points={getFourPointStarPoints(star.cx, star.cy, star.size)}
              fill={star.c}
              opacity={star.opacityBase}
              style={{
                animation: `pulse ${star.duration}s ease-in-out infinite`,
                animationDelay: `${star.delay}s`,
              }}
            />
          </g>
        ))}

        {/* ───────────────────── Ground ───────────────────── */}
        <rect
          x="0"
          y="67.5"
          width="160"
          height="32.5"
          fill="url(#syn-ground)"
        />

        {/* ───────────────────── Perspective grid ───────────────────── */}
        <g
          clipPath="url(#syn-ground-clip)"
          mask="url(#syn-grid-mask)"
          stroke="var(--color-note-half)"
          strokeWidth="0.15"
          fill="none"
        >
          {V_LINES.map((ln, i) => (
            <line key={`v${i}`} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} />
          ))}

          {H_LINE_YS.map((y, i) => (
            <line key={`h${i}`} x1="-150" y1={y} x2="310" y2={y} />
          ))}
        </g>

        {/* ───────────────────── Atmospheric glow band ───────────────────── */}
        <rect
          x="0"
          y="62"
          width="160"
          height="11"
          fill="url(#syn-atmo)"
          filter="url(#syn-atmo-blur)"
        />

        {/* ───────────────────── Horizon glow line (three layers) ───────────────────── */}
        <g filter="url(#syn-horizon-glow)">
          <line
            x1="0"
            y1="67.5"
            x2="160"
            y2="67.5"
            stroke="var(--color-main)"
            strokeWidth="0.18"
          />
        </g>
      </svg>
    </div>
  );
});
