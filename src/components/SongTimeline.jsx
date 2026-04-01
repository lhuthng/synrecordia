import { useEffect, useRef, useState } from "react";

const NOTE_WIDTH_MIN = 40;
const NOTE_WIDTH_MAX = 200;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export default function SongTimeline({
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

  const thumbL = clamp(1 - latestBeat / dur, 0, 1); // visual left  = high beats
  const thumbR = clamp(1 - earliestBeat / dur, 0, 1); // visual right = low  beats
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
        const newLatest = startLatest + deltaBeat;
        const rawWindow = newLatest - startEarliest;
        const nw = clamp(
          tw / Math.max(rawWindow, 1e-4),
          NOTE_WIDTH_MIN,
          NOTE_WIDTH_MAX,
        );
        const actualWindow = tw / nw;

        const newCurrentBeat = startEarliest + (1 - pbPos) * actualWindow;
        setNW?.(nw);
        scrub?.(clamp(newCurrentBeat, 0, d));
      } else {
        const newEarliest = startEarliest + deltaBeat;
        const rawWindow = startLatest - newEarliest;
        const nw = clamp(
          tw / Math.max(rawWindow, 1e-4),
          NOTE_WIDTH_MIN,
          NOTE_WIDTH_MAX,
        );
        const actualWindow = tw / nw;

        const newCurrentBeat = startLatest - pbPos * actualWindow;
        setNW?.(nw);
        scrub?.(clamp(newCurrentBeat, 0, d));
      }
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ── Start a drag ──────────────────────────────────────────────────────────
  const startDrag = (type, e) => {
    e.stopPropagation();
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

  if (!durationBeats) return null;

  return (
    <div
      ref={trackRef}
      className="relative w-full h-7 bg-ui rounded-sm overflow-hidden select-none outline-note-full outline-2"
      title="Song timeline — drag thumb to scrub · drag edges to zoom"
    >
      {/* ── Dim regions outside the thumb ──────────────────────────────────── */}
      <div
        className="absolute top-0 bottom-0 left-0 bg-dark/40 pointer-events-none"
        style={{ right: `${(1 - thumbL) * 100}%` }}
      />
      <div
        className="absolute top-0 bottom-0 right-0 bg-dark/40 pointer-events-none"
        style={{ left: `${thumbR * 100}%` }}
      />

      {/* ── Thumb ──────────────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 bottom-0 border-x-2 bg-linear-to-r from-note-full/50 from-0% via-transparent via-50% to-note-full/50 to-100% border-note-full"
        style={{
          left: `${thumbL * 100}%`,
          right: `${(1 - thumbR) * 100}%`,
          minWidth: 24,
        }}
      >
        {/* Left handle — moves the high-beat (future) boundary */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1/3 cursor-ew-resize touch-none hover:bg-note-full/30 transition-colors duration-200"
          onPointerDown={(e) => startDrag("left", e)}
        />
        {/* Middle — scrub the whole view */}
        <div
          className="absolute top-0 bottom-0 left-1/3 right-1/3 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => startDrag("thumb", e)}
        />
        {/* Right handle — moves the low-beat (past) boundary */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1/3 cursor-ew-resize touch-none hover:bg-note-full/30 transition-colors duration-200"
          onPointerDown={(e) => startDrag("right", e)}
        />
      </div>

      {/* ── Playhead ───────────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none drop-shadow-[0_0_3px_rgba(255,255,255,0.8)]"
        style={{ left: `${playheadFrac * 100}%` }}
      />
    </div>
  );
}
