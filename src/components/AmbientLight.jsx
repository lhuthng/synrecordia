import { useEffect, useRef } from "react";
import { useAnimate } from "motion/react";

// ── Per-slot palette ─────────────────────────────────────────────────────────
const SLOT_COLORS = [
  "var(--color-yellow-400)",
  "var(--color-note-full)",
  "var(--color-accent-pink)",
];

// ── Single layer ─────────────────────────────────────────────────────────────
// Fixed full-viewport layer at z-[1] (above SynthwaveBackground z-0, below
// content z-10). Portaled to document.body so it lives in the root stacking
// context and bleeds across the entire page. Opacity starts at 0 and springs
// up then decays each time flashCount increments (i.e. a note fires on this track).
function AmbientLayer({ color, flashCount }) {
  const [scope, animate] = useAnimate();
  const prevFlash = useRef(flashCount);

  useEffect(() => {
    if (flashCount === prevFlash.current || !scope.current) return;
    prevFlash.current = flashCount;

    // Spike → slow exponential decay back to 0.
    // The easing [0.16, 1, 0.3, 1] is an "expo-out"-like curve so the initial
    // peak is almost instant and the long tail is the visual "glow fading away".
    animate(
      scope.current,
      { opacity: [0.1, 0] },
      {
        duration: 1.6,
        ease: [0.16, 1, 0.3, 1],
      },
    );
  }, [flashCount, animate, scope]);

  return (
    // Outer: fixed full-viewport cover at z-1 in the root stacking context.
    // overflow-hidden clips the oversized inner blob to the viewport edge.
    // Starts invisible; animation drives opacity.
    <div
      ref={scope}
      className="fixed inset-0 z-1 pointer-events-none overflow-hidden"
      style={{ opacity: 0 }}
    >
      {/* Inner: intentionally larger than the parent so the blurred radial
          gradient produces soft feathered edges rather than hard clip artefacts. */}
      <div
        style={{
          position: "absolute",
          inset: "-40%",
          background: `radial-gradient(ellipse 70% 60% at 50% 55%, ${color} 0%, transparent 65%)`,
          filter: "blur(52px)",
        }}
      />
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────
// Renders one AmbientLayer per active track.
// Props:
//   flashCounters  – object keyed by track index, values are monotone counters
//   numTracks      – how many layers to render (derived from song.tracks.length)
export default function AmbientLight({ flashCounters, numTracks }) {
  if (!numTracks) return null;

  return Array.from({ length: numTracks }, (_, i) => (
    <AmbientLayer
      key={i}
      color={SLOT_COLORS[Math.min(i, SLOT_COLORS.length - 1)]}
      flashCount={flashCounters[i] ?? 0}
    />
  ));
}
