import { useEffect, useRef, useState, memo } from "react";
import { cn } from "../../libs/utils";

const NOTE_WIDTH_MIN = 40;
const NOTE_WIDTH_MAX = 400;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const SongTimeline = memo(function SongTimeline({
  currentBeat = 0,
  durationBeats = 0,
  noteWidth = 70,
  playBarPosition = 0.95,
  onScrubStart,
  onScrub,
  onNoteWidthChange,
}) {
  const trackRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(1);
  const dragRef = useRef(null);
  const animRef = useRef(null);
  // Set to true when a handle drag ends so the subsequent synthetic click on the
  // track background (which fires after pointerup) is suppressed.
  const didDragRef = useRef(false);
  const atLimitRef = useRef(false);
  const [atLimit, setAtLimit] = useState(false);

  // Always-fresh callbacks — updated every render, no dep-array needed.
  const cbRef = useRef({ onScrubStart, onScrub, onNoteWidthChange });
  useEffect(() => {
    cbRef.current = { onScrubStart, onScrub, onNoteWidthChange };
  });

  // Measure own pixel width (matches the Visualizer above it).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setTrackWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Visible window on the canvas ──────────────────────────────────────────
  const dur = Math.max(1, durationBeats);
  const barXPx = playBarPosition * trackWidth;
  const latestBeat = currentBeat + barXPx / noteWidth; // LEFT  edge of canvas
  const earliestBeat = currentBeat - (trackWidth - barXPx) / noteWidth; // RIGHT edge of canvas

  // Right-to-left: visual left = high beats (future), visual right = low beats (past)
  const thumbL = clamp(1 - latestBeat / dur, 0, 1);
  const thumbR = clamp(1 - earliestBeat / dur, 0, 1);
  const playheadFrac = clamp(1 - currentBeat / dur, 0, 1);

  // ── Global drag listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;

      const { tw, d, pbPos, startX, startBeat, startEarliest, startLatest } =
        drag;
      const deltaX = e.clientX - startX;

      const deltaBeat = -(deltaX / tw) * d;

      const { onScrub: scrub, onNoteWidthChange: setNW } = cbRef.current;

      if (drag.type === "thumb") {
        // ── Scrub: move the whole view, zoom unchanged ──────────────────────
        scrub?.(clamp(startBeat + deltaBeat, 0, d));
      } else if (drag.type === "left") {
        // Left handle: adjust future (latest) boundary, keep earliest fixed
        const newLatest = startLatest + deltaBeat;
        const rawWindow = newLatest - startEarliest;
        const rawNw = tw / Math.max(rawWindow, 1e-4);
        const nw = clamp(rawNw, NOTE_WIDTH_MIN, NOTE_WIDTH_MAX);
        const actualWindow = tw / nw;
        // Update at-limit state
        const hitLimit = rawNw < NOTE_WIDTH_MIN || rawNw > NOTE_WIDTH_MAX;
        if (hitLimit !== atLimitRef.current) {
          atLimitRef.current = hitLimit;
          setAtLimit(hitLimit);
        }
        const newCurrentBeat = startEarliest + (1 - pbPos) * actualWindow;
        setNW?.(nw);
        scrub?.(clamp(newCurrentBeat, 0, d));
      } else {
        // Right handle: adjust past (earliest) boundary, keep latest fixed
        const newEarliest = startEarliest + deltaBeat;
        const rawWindow = startLatest - newEarliest;
        const rawNw = tw / Math.max(rawWindow, 1e-4);
        const nw = clamp(rawNw, NOTE_WIDTH_MIN, NOTE_WIDTH_MAX);
        const actualWindow = tw / nw;
        // Update at-limit state
        const hitLimit = rawNw < NOTE_WIDTH_MIN || rawNw > NOTE_WIDTH_MAX;
        if (hitLimit !== atLimitRef.current) {
          atLimitRef.current = hitLimit;
          setAtLimit(hitLimit);
        }
        const newCurrentBeat = startLatest - pbPos * actualWindow;
        setNW?.(nw);
        scrub?.(clamp(newCurrentBeat, 0, d));
      }
    };

    const onUp = () => {
      if (dragRef.current) {
        // A handle drag just finished. Mark it so the click event that the
        // browser fires immediately after pointerup is ignored.
        didDragRef.current = true;
      }
      if (atLimitRef.current) {
        atLimitRef.current = false;
        setAtLimit(false);
      }
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // ── Start a drag ──────────────────────────────────────────────────────────
  const startDrag = (type, e) => {
    e.stopPropagation();
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    cbRef.current.onScrubStart?.();

    dragRef.current = {
      type,
      startX: e.clientX,
      startBeat: currentBeat,
      startEarliest: earliestBeat,
      startLatest: latestBeat,
      tw: trackRef.current?.getBoundingClientRect().width ?? trackWidth,
      d: Math.max(1, durationBeats),
      pbPos: playBarPosition,
    };
  };

  // ── Click on track background to seek ────────────────────────────────────
  const handleTrackClick = (e) => {
    // Suppress the click that fires immediately after a handle drag ends.
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (dragRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickFrac = (e.clientX - rect.left) / rect.width;
    const d = Math.max(1, durationBeats);
    const targetBeat = clamp((1 - clickFrac) * d, 0, d);

    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    cbRef.current.onScrubStart?.();

    const startBeat = currentBeat;
    const startTime = performance.now();
    const DURATION = 380; // ms

    const animate = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      // Ease-out cubic
      const easedT = 1 - Math.pow(1 - t, 3);
      cbRef.current.onScrub?.(
        clamp(startBeat + (targetBeat - startBeat) * easedT, 0, d),
      );
      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(animate);
  };

  if (!durationBeats) return null;

  return (
    <div
      ref={trackRef}
      className="relative w-full h-7 rounded-sm overflow-hidden select-none cursor-pointer outline-note-full outline-2"
      title="Song timeline — drag thumb to scrub · drag edges to zoom"
      onClick={handleTrackClick}
    >
      {/* ── Thumb ──────────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "absolute top-0 bottom-0 border-x-2 bg-linear-to-r hover:brightness-150 transition-colors duration-200 ",
          atLimit ? "border-accent-pink" : "border-note-full",
          atLimit
            ? "from-accent-pink/60 via-accent-pink/10 to-accent-pink/60"
            : "from-note-full/60 via-note-full/10 to-note-full/60",
        )}
        style={{
          left: `${thumbL * 100}%`,
          right: `${(1 - thumbR) * 100}%`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left handle — moves the high-beat (future) boundary */}
        <div
          className={`absolute top-0 bottom-0 right-full cursor-ew-resize touch-none flex items-center justify-center px-1 hover:scale-120`}
          onPointerDown={(e) => startDrag("left", e)}
        >
          <svg
            viewBox="0 0 12 16"
            className={cn(
              "w-3 h-4 sm:-translate-x-2 fill-none stroke-2 transition-colors duration-200",
              atLimit ? "stroke-accent-pink" : "stroke-note-full",
            )}
            aria-hidden="true"
          >
            <line x1="10" y1="2" x2="2" y2="8" strokeLinecap="round" />
            <line x1="10" y1="14" x2="2" y2="8" strokeLinecap="round" />
          </svg>
        </div>
        <div
          className="absolute top-0 inset-0 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => startDrag("thumb", e)}
        />
        {/* Right handle — moves the low-beat (past) boundary */}
        <div
          className={`absolute top-0 bottom-0 left-full cursor-ew-resize touch-none flex items-center justify-center px-1 hover:scale-120`}
          onPointerDown={(e) => startDrag("right", e)}
        >
          <svg
            viewBox="0 0 12 16"
            className={cn(
              "w-3 h-4 sm:translate-x-2 fill-none stroke-2 transition-colors duration-200",
              atLimit ? "stroke-accent-pink" : "stroke-note-full",
            )}
            aria-hidden="true"
          >
            <line x1="2" y1="2" x2="10" y2="8" strokeLinecap="round" />
            <line x1="2" y1="14" x2="10" y2="8" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* ── Playhead ───────────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none drop-shadow-[0_0_3px_rgba(255,255,255,0.8)]"
        style={{ left: `${playheadFrac * 100}%`, willChange: "transform" }}
      />
    </div>
  );
});
export default SongTimeline;
