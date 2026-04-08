import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { usePixiVisualizer } from "../hooks/usePixiVisualizer.js";
import {
  DEFAULT_HEIGHT,
  FADE_MS,
  NUM_HOLES,
  HOLE_SIZE,
  FINGERING_GAPS,
} from "./utils/constants.js";
import RecorderIllustration from "./instruments/RecorderIllustration.jsx";
import fingeringChart from "../assets/references/fingering-chart.json";
import { motion as Motion, AnimatePresence } from "motion/react";

export { FADE_MS };

/** Hole IDs in top-to-bottom order, sourced from the fingering chart. */
const HOLES = fingeringChart.holes;

/**
 * Replicates getHolePositions + the Pixi centering formula so we can
 * compute hole guide-line Y positions in pure React without importing PIXI.
 */
function computeHoleLineYs(height) {
  const rh = HOLE_SIZE.y;
  const positions = [0];
  for (let i = 0; i < FINGERING_GAPS.length; i++) {
    positions.push(
      positions[positions.length - 1] + rh + FINGERING_GAPS[i] * rh,
    );
  }
  const holesTop = (height - (positions[NUM_HOLES - 1] + rh)) / 2;
  return positions.map((p) => holesTop + p + rh / 2);
}

const Visualizer = memo(function Visualizer({
  song,
  currentBeat = 0,
  durationBeats = 0,
  isPlaying = false,
  bpm = 120,
  fingeringSystem = "baroque",
  recorderType = "tenor",
  noteWidth = 70,
  height = DEFAULT_HEIGHT,
  playBarPosition = 0.95,
  transpose = 0,
  latencyMs = 0,
  particlesEnabled = true,
  ecoMode = false,
  rangeWarning = null,
  onReady,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayPause,
  onPlayBarPositionChange,
}) {
  const { t } = useTranslation();

  // ── Range-warning formatting helpers ───────────────────────────────────────
  const fmtST = (n) =>
    n === 0 ? "0" : n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`;
  const fmtRange = (tMin, tMax) =>
    tMin === tMax ? fmtST(tMin) : `${fmtST(tMin)} to ${fmtST(tMax)}`;

  // ── Range-warning dismiss state ─────────────────────────────────────────────
  // Dismissed resets automatically whenever rangeWarning becomes a new object
  // (new song, transpose change that causes/clears range issues).
  // Track *which* warning object was dismissed by reference identity.
  // When rangeWarning becomes a new object (new song, transpose change, etc.)
  // it will differ from dismissedWarning, so the overlay re-appears automatically
  // with no useEffect needed — avoids the cascading-setState lint warning.
  const [dismissedWarning, setDismissedWarning] = useState(null);

  // Show only when paused — hides automatically during playback and can be
  // manually dismissed with the × button.
  const showWarning =
    rangeWarning && song && rangeWarning !== dismissedWarning && !isPlaying;

  // ── Instrument overlay ──────────────────────────────────────────────────────
  const [showInstrument, setShowInstrument] = useState(false);
  const [holePoints, setHolePoints] = useState([]);

  // ── Interaction hint overlay ────────────────────────────────────────────────
  const [hintMsg, setHintMsg] = useState(null);
  const hintTimerRef = useRef(null);

  const showHint = useCallback((msg) => {
    setHintMsg(msg);
    clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHintMsg(null), 1800);
  }, []);

  // Clean up hint timer on unmount
  useEffect(() => () => clearTimeout(hintTimerRef.current), []);

  // ── Stable scroll-hint callback ─────────────────────────────────────────────
  const scrollHintTextRef = useRef(t("visualizer.scrollHint"));

  useEffect(() => {
    scrollHintTextRef.current = t("visualizer.scrollHint");
  }, [t]);

  const handleScrollHint = useCallback(
    () => showHint(scrollHintTextRef.current),
    [showHint],
  );

  const {
    wrapperRef,
    containerRef,
    width,
    isReady,
    displaySong,
    cursor,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  } = usePixiVisualizer({
    song,
    currentBeat,
    durationBeats,
    isPlaying,
    bpm,
    fingeringSystem,
    recorderType,
    noteWidth,
    height,
    playBarPosition,
    transpose,
    latencyMs,
    onReady,
    onScrubStart,
    onScrub,
    onNoteClick,
    onPlayBarPositionChange,
    onScrollHint: handleScrollHint,
    interactionLocked: showInstrument,
    particlesEnabled: particlesEnabled && !ecoMode,
    ecoMode,
  });

  // ── First-load "?" onboarding hint ──────────────────────────────────────────
  const Q_HINT_KEY = "synrecordia:qHintShown";
  const qHintShownRef = useRef(false);
  const [showQHint, setShowQHint] = useState(false);

  const dismissQHint = useCallback(() => {
    setShowQHint(false);
    try {
      sessionStorage.setItem(Q_HINT_KEY, "true");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    if (!isReady || song?.id !== displaySong?.id) return;
    if (qHintShownRef.current) return;
    try {
      if (sessionStorage.getItem(Q_HINT_KEY) === "true") {
        qHintShownRef.current = true;
        return;
      }
    } catch {
      /* storage unavailable */
    }
    qHintShownRef.current = true;
    // Defer setState out of the synchronous effect body (avoids cascading-render lint warning).
    const rafId = requestAnimationFrame(() => setShowQHint(true));
    const timerId = setTimeout(dismissQHint, 5000);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
  }, [isReady, song?.id, displaySong?.id, dismissQHint]);

  /** Playbar X in pixels from the left edge of the wrapper. */
  const barX = playBarPosition * width;

  /** Y centres of the 8 hole guide lines drawn in the Pixi canvas. */
  const holeLineYs = useMemo(() => computeHoleLineYs(height), [height]);

  /**
   * After the illustration panel mounts (or the canvas dimensions change),
   * measure each hole path element's centre in wrapper-relative coordinates
   * using the SVG CTM so we can draw connecting lines over the canvas.
   */
  useEffect(() => {
    // All setState calls live inside the rAF so none are synchronous in the
    // effect body (avoids cascading-render lint warning).
    const raf = requestAnimationFrame(() => {
      if (!showInstrument) {
        setHolePoints([]);
        return;
      }

      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!wrapperRect) {
        setHolePoints([]);
        return;
      }

      const pts = HOLES.map((id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        try {
          const bbox = el.getBBox();
          const matrix = el.getScreenCTM();
          if (!matrix) return null;
          const screenPt = new DOMPoint(
            bbox.x + bbox.width / 2,
            bbox.y + bbox.height / 2,
          ).matrixTransform(matrix);
          return {
            x: screenPt.x - wrapperRect.left,
            y: screenPt.y - wrapperRect.top,
            isHidden: el.getAttribute("data-hint") === "hidden",
          };
        } catch {
          return null;
        }
      });

      setHolePoints(pts);
    });

    return () => cancelAnimationFrame(raf);
    // wrapperRef is a stable useRef object — adding it satisfies the linter
    // without causing any extra re-runs.
  }, [showInstrument, width, height, wrapperRef]); // re-measure on resize too

  // ── "No song" placeholder ───────────────────────────────────────────────────
  if (!song) {
    return (
      <div
        className="text-main"
        ref={wrapperRef}
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 14, fontFamily: "monospace" }}>
          {t("visualizer.pickSong")}
        </span>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full rounded-xl bg-transparent overflow-hidden"
      ref={wrapperRef}
      style={{ height }}
    >
      {/* ── Pixi canvas ────────────────────────────────────────────────────── */}
      <div
        className="focus:outline-none"
        ref={containerRef}
        style={{
          width,
          height,
          cursor,
          touchAction: "none",
          opacity: isReady && song?.id === displaySong?.id ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
          willChange: "transform",
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.code === "Space") {
            e.preventDefault();
            onPlayPause?.();
          }
        }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onPointerLeave={handleDragEnd}
      />

      {/* ── Dim overlay — tints the canvas, leaves a soft window at barX ────── */}
      <AnimatePresence>
        {showInstrument && (
          <Motion.div
            key="dim-overlay"
            className="absolute inset-0 pointer-events-none z-5"
            style={{
              background: `linear-gradient(to right,
              rgba(6,10,12,0.72),
              rgba(6,10,12,0.72) ${barX - 16}px,
              transparent ${barX - 4}px,
              transparent ${barX + 4}px,
              rgba(6,10,12,0.72) ${barX + 16}px,
              rgba(6,10,12,0.72))`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}

        {/* ── RecorderIllustration overlay panel ─────────────────────────────── */}
        {showInstrument && (
          <Motion.div
            key="recorder-overlay"
            className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-fit flex items-center justify-center rounded-xl bg-radial-[at_50%_75%] from-dark via-transparent to-transparent px-4 z-10 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          >
            <RecorderIllustration height={`${height - 24}px`} />
          </Motion.div>
        )}

        {/* ── Connection lines: hole centres → playbar/hole-line intersections ── */}
        {showInstrument && holePoints.length > 0 && (
          <Motion.svg
            key="connection-lines"
            className="absolute inset-0 pointer-events-none z-20"
            width={width}
            height={height}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          >
            <defs>
              {/* filterUnits="userSpaceOnUse" so the blur region is in absolute
                SVG px — prevents the bounding-box trick from collapsing to
                zero on near-horizontal / near-vertical lines. */}
              <filter
                id="line-glow"
                x="0"
                y="0"
                width={width}
                height={height}
                filterUnits="userSpaceOnUse"
              >
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {HOLES.map((id, i) => {
              const pt = holePoints[i];
              const ty = holeLineYs[i];
              if (!pt || ty == null) return null;
              const dash = pt.isHidden ? "5 4" : undefined;
              return (
                <g key={id} filter="url(#line-glow)">
                  {/* broad soft halo */}
                  <line
                    className="stroke-accent-pink/20"
                    x1={pt.x}
                    y1={pt.y}
                    x2={barX}
                    y2={ty}
                    strokeWidth="6"
                    strokeDasharray={dash}
                  />
                  {/* sharp bright core */}
                  <line
                    className="stroke-main/80"
                    x1={pt.x}
                    y1={pt.y}
                    x2={barX}
                    y2={ty}
                    strokeWidth="2"
                    strokeDasharray={dash}
                  />
                </g>
              );
            })}
          </Motion.svg>
        )}
      </AnimatePresence>

      {/* ── "?" toggle circle at the bottom of the play bar ────────────────── */}
      {isReady && song?.id === displaySong?.id && (
        <button
          className="absolute flex items-center justify-center w-5 h-5 rounded-full text-dark text-sm font-bold leading-none cursor-pointer border border-main/70 bg-main hover:bg-main transition-all duration-150 z-30 select-none drop-shadow-2xl"
          style={{ right: 10, bottom: 10 }}
          onClick={() => {
            const next = !showInstrument;
            setShowInstrument(next);
            if (next) onScrubStart?.(); // pause the player when opening the guide
          }}
          title={
            showInstrument
              ? t("visualizer.hideFingering")
              : t("visualizer.showFingering")
          }
        >
          ?
        </button>
      )}

      {/* ── First-load "?" onboarding hint with curved arrow ───────────────── */}
      <AnimatePresence>
        {showQHint && (
          <Motion.div
            key="q-hint"
            className="absolute right-10 bottom-1 z-35 select-none"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
          >
            <button
              className="flex items-center gap-1.5 rounded-lg bg-dark/90 border border-note-full/50 px-3 py-1.5 text-xs text-note-full backdrop-blur-sm shadow-lg whitespace-nowrap cursor-pointer hover:border-note-full transition-colors"
              onClick={dismissQHint}
              aria-label={t("visualizer.dismissHint")}
            >
              <svg
                className="w-4 h-4 fill-note-full"
                viewBox="0 0 489.242 489.242"
              >
                <path d="M416.321,171.943c0-97.8-82.2-176.9-181-171.7c-89.5,5.2-160.3,79.1-162.4,168.6c0,44.7,16.6,86.3,45.8,118.6 c47.7,51.1,41.6,110.3,41.6,110.3c0,11.4,9.4,20.8,20.8,20.8h126.9c11.4,0,20.8-9.4,21.8-20.8c0,0-7-57.7,40.6-109.2 C399.621,257.243,416.321,215.643,416.321,171.943z M288.321,377.943h-87.4c-2.1-42.7-20.8-84.3-51-116.5 c-22.9-25-34.3-57.2-34.3-90.5c1-68.7,54.1-124.8,122.8-129c74.9-4.2,137.3,56.2,137.3,130c0,32.3-12.5,64.5-35.4,88.4 C309.121,293.643,290.421,335.243,288.321,377.943z"></path>{" "}
                <path d="M281.021,447.643h-73.9c-11.4,0-20.8,9.4-20.8,20.8s9.4,20.8,20.8,20.8h73.9c11.4,0,20.8-9.4,20.8-20.8 C301.821,457.043,292.521,447.643,281.021,447.643z"></path>
              </svg>
              <span>
                {t("visualizer.qHint")}
                {" >>"}
              </span>
            </button>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* ── Interaction hint overlay ────────────────────────────────────────── */}
      <AnimatePresence>
        {hintMsg && (
          <Motion.div
            key={hintMsg}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-40"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.18 }}
          >
            <span className="px-4 py-2 rounded-lg bg-dark/80 border border-main/20 text-main/80 text-sm font-iosevka select-none backdrop-blur-sm">
              {hintMsg}
            </span>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* ── Out-of-range warning overlay ─────────────────────────────────────── */}
      <AnimatePresence>
        {showWarning && (
          <Motion.div
            key="range-warning"
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-50"
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            <div className="relative flex flex-col gap-1 max-w-xs text-center rounded-xl bg-amber-950/90 border border-amber-500/60 px-5 py-3 text-amber-200 shadow-2xl backdrop-blur-sm select-none pointer-events-auto">
              {/* Dismiss button */}
              <button
                className="absolute top-1.5 right-2 leading-none text-amber-400/70 hover:text-amber-200 transition-colors cursor-pointer text-base"
                onClick={() => setDismissedWarning(rangeWarning)}
                aria-label="Dismiss warning"
              >
                ×
              </button>
              <span className="text-sm font-semibold pr-4">
                ⚠ {t("player.rangeWarning.default")}
              </span>
              {rangeWarning.alternatives.length > 0 ? (
                <span className="text-xs opacity-80">
                  {t("player.rangeWarning.trySystems")}{" "}
                  {rangeWarning.alternatives
                    .map((a) => `${a.system} (${fmtRange(a.tMin, a.tMax)})`)
                    .join(", ")}
                  .
                </span>
              ) : (
                <span className="text-xs opacity-80">
                  {t("player.rangeWarning.impossible")}
                </span>
              )}
            </div>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="absolute p-4 bottom-0 text-main select-none pointer-events-none">
        <p>
          <span className="inline-block rounded-sm w-4 h-4 bg-note-full"></span>{" "}
          {t("visualizer.legendFull")}
        </p>
        <p>
          <span className="inline-block rounded-sm w-4 h-4 bg-note-half"></span>{" "}
          {t("visualizer.legendHalf")}
        </p>
      </div>
    </div>
  );
});
export default Visualizer;
