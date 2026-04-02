import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

export default function Visualizer({
  song,
  currentBeat = 0,
  durationBeats = 0,
  isPlaying = false,
  bpm = 120,
  fingeringSystem = "baroque",
  noteWidth = 70,
  height = DEFAULT_HEIGHT,
  playBarPosition = 0.95,
  onReady,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayPause,
  onPlayBarPositionChange,
}) {
  const { t } = useTranslation();

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
    noteWidth,
    height,
    playBarPosition,
    onReady,
    onScrubStart,
    onScrub,
    onNoteClick,
    onPlayBarPositionChange,
    onScrollHint: handleScrollHint,
    interactionLocked: showInstrument,
  });

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
      className="relative w-full bg-dark overflow-x-hidden"
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

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="absolute p-4 bottom-0 select-none pointer-events-none">
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
}
