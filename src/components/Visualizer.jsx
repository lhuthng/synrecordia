import { usePixiVisualizer } from "../hooks/usePixiVisualizer.js";
import { DEFAULT_HEIGHT, FADE_MS } from "./utils/constants.js";

export { FADE_MS };

export default function Visualizer({
  song,
  currentBeat = 0,
  durationBeats = 0,
  isPlaying = false,
  bpm = 120,
  fingeringSystem = "recorder",
  baroque = true,
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
    baroque,
    noteWidth,
    height,
    playBarPosition,
    onReady,
    onScrubStart,
    onScrub,
    onNoteClick,
    onPlayBarPositionChange,
  });

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
          Pick a song to get started
        </span>
      </div>
    );
  }

  return (
    <div
      className="relative w-full bg-dark overflow-x-hidden"
      ref={wrapperRef}
      style={{ height }}
    >
      <div
        className="focus:outline-none"
        ref={containerRef}
        style={{
          width,
          height,
          cursor,
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
      <div className="absolute p-4 bottom-0 select-none pointer-events-none">
        <p>
          <span className="inline-block rounded-sm w-4 h-4 bg-note-full"></span>{" "}
          Full
        </p>
        <p>
          <span className="inline-block rounded-sm w-4 h-4 bg-note-half"></span>{" "}
          Half
        </p>
      </div>
    </div>
  );
}
