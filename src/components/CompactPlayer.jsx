import { useState, useEffect, useRef, useCallback } from "react";
import { useMatch } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import Directory from "./Directory";
import Visualizer from "./Visualizer";
import SongTimeline from "./SongTimeline";
import InstrumentManager from "./instruments/InstrumentManager";
import usePlayer from "../hooks/usePlayer.js";
import { computeNoteRangeFromActions } from "../libs/utils.js";

export default function CompactPlayer() {
  const { t } = useTranslation();

  // Resolve songId from /compact/songs/:songId — null when at /compact
  const songMatch = useMatch("/compact/songs/:songId");
  const urlSongId = songMatch?.params?.songId;

  const {
    song,
    selectSong,
    isPlaying,
    currentBeat,
    bpm,
    noteWidth,
    repeat,
    setRepeat,

    durationBeats,
    isAudioReady,
    isReady: isAudioReadyAll,
    transposeSemitones,
    fingeringSystem,
    recorderType,
    registerSampler,
    deregisterSampler,
    startPlayback,
    pausePlayback,
    stopPlayback,
    handleNoteClick,
    handleScrubStart,
    handleScrub,
    handleRestart,
    handleNoteWidthChange,
    handleAudioReady,
  } = usePlayer();

  // ── Visual readiness ─────────────────────────────────────────────────────
  const [isVisualReady, setIsVisualReady] = useState(false);
  const pendingResetRef = useRef(false);
  const isReady = isVisualReady && isAudioReadyAll;

  // ── Countdown before playback ────────────────────────────────────────────
  const [countdown, setCountdown] = useState(null);
  const countdownTimerRef = useRef(null);

  const cancelCountdown = useCallback(() => {
    clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
  }, []);

  useEffect(() => {
    return () => clearTimeout(countdownTimerRef.current);
  }, []);

  // Cancel countdown on song change
  useEffect(() => {
    cancelCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  const handlePlay = useCallback(() => {
    startPlayback();
  }, [startPlayback]);

  const handleTogglePlayback = useCallback(() => {
    if (countdown !== null) cancelCountdown();
    else if (isPlaying) pausePlayback();
    else handlePlay();
  }, [countdown, isPlaying, cancelCountdown, pausePlayback, handlePlay]);

  // ── Play bar position ────────────────────────────────────────────────────
  const [playBarPosition, setPlayBarPosition] = useState(0.95);

  // ── URL-based song loading ───────────────────────────────────────────────
  const [, setUrlLoading] = useState(false);
  const [, setUrlError] = useState(null);
  const songCacheRef = useRef({});

  useEffect(() => {
    if (!urlSongId) {
      setUrlError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setUrlLoading(true);
      setUrlError(null);

      try {
        if (songCacheRef.current[urlSongId]) {
          if (!cancelled) {
            pendingResetRef.current = true;
            setIsVisualReady(false);
            selectSong(songCacheRef.current[urlSongId]);
            setUrlLoading(false);
          }
          return;
        }

        const indexRes = await fetch("/songs/index.json");
        if (!indexRes.ok) throw new Error("Failed to load song index.");
        const index = await indexRes.json();

        const meta = Array.isArray(index)
          ? index.find((s) => s.id === urlSongId)
          : null;

        if (!meta) {
          if (!cancelled) {
            setUrlError(
              `No song with the id "${urlSongId}" was found in the library.`,
            );
            setUrlLoading(false);
          }
          return;
        }

        const songRes = await fetch(`/songs/${meta.file}`);
        if (!songRes.ok)
          throw new Error(`Failed to load song file "${meta.file}".`);
        const songData = await songRes.json();

        if (!cancelled) {
          songCacheRef.current[urlSongId] = songData;
          pendingResetRef.current = true;
          setIsVisualReady(false);
          selectSong(songData);
          setUrlLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setUrlError(err.message ?? "An unexpected error occurred.");
          setUrlLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [urlSongId, selectSong]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-dvh overflow-hidden space-y-4 bg-dark font-iosevka">
      {/* Hidden InstrumentManagers — audio loads silently, no UI */}
      <div className="hidden">
        {song?.tracks?.map((track, index) => (
          <InstrumentManager
            key={`${index}-${track.instrument}`}
            slot={index}
            muted={false}
            flashCount={0}
            name={track.instrument}
            register={registerSampler}
            deregister={deregisterSampler}
            toggle={false}
            onToggleChanged={() => {}}
            initialReady={isAudioReady?.[index]}
            handleAudioReady={(value) => handleAudioReady(index, value)}
            onReady={() => handleAudioReady(index, true)}
            offReady={() => handleAudioReady(index, false)}
            trackNoteRange={
              track.noteRange ?? computeNoteRangeFromActions(track.actions)
            }
            transpose={transposeSemitones}
            fingeringSystem={fingeringSystem}
            recorderType={recorderType}
            onOutOfRange={() => {}}
            callbacks={{
              pausePlayback,
              setFingeringSystem: () => {},
              setRecorderType: () => {},
            }}
          />
        ))}
      </div>

      {/* ── Top bar: Directory (left) + playback buttons (right) ── */}
      <div className="flex items-center justify-between gap-2 pointer-events-auto">
        {/* Directory — navigates to /compact/songs/:id */}
        <div className="flex items-center gap-2">
          <Directory basePath="/compact/songs" position="left-0" />
        </div>

        {/* Playback buttons */}
        <div className="flex gap-2 items-center *:h-8">
          <DuoToggleButton
            value={isPlaying || countdown !== null}
            onToggle={handlePlay}
            offToggle={() => {
              if (countdown !== null) cancelCountdown();
              else pausePlayback();
            }}
            onColors={{
              background: "bg-note-full",
              shadowBackground: "bg-note-full-dark",
              border: "border-note-full-dark",
              text: "text-dark",
            }}
            offColors={{
              background: "bg-note-half",
              shadowBackground: "bg-note-half-dark",
              border: "border-note-half-dark",
              text: "text-main",
            }}
            disabled={!isReady}
          >
            {countdown !== null
              ? countdown
              : isPlaying
                ? t("player.pause")
                : t("player.play")}
          </DuoToggleButton>

          <DuoButton
            text="text-main"
            background="bg-note-half"
            shadowBackground="bg-note-half-dark"
            border="border-note-half-dark"
            onClick={() => {
              cancelCountdown();
              handleRestart();
            }}
            disabled={!isReady}
          >
            {t("player.restart")}
          </DuoButton>

          <DuoToggleButton
            onColors={{
              background: "bg-note-full",
              shadowBackground: "bg-note-full-dark",
              border: "border-note-full-dark",
              text: "text-dark",
            }}
            offColors={{
              background: "bg-note-half",
              shadowBackground: "bg-note-half-dark",
              border: "border-note-half-dark",
              text: "text-main",
            }}
            value={repeat}
            onToggle={() => setRepeat(true)}
            offToggle={() => setRepeat(false)}
            aria-label="Repeat song"
          >
            {t("player.repeat")}
          </DuoToggleButton>
        </div>
      </div>

      {/* Visualizer — fills the whole viewport */}
      <Visualizer
        song={song}
        currentBeat={currentBeat}
        durationBeats={durationBeats}
        isPlaying={isPlaying}
        bpm={bpm}
        noteWidth={noteWidth}
        particlesEnabled={true}
        playBarPosition={playBarPosition}
        rangeWarning={null}
        onReady={() => {
          setIsVisualReady(true);
          if (pendingResetRef.current) {
            stopPlayback();
            pendingResetRef.current = false;
          }
        }}
        onScrubStart={handleScrubStart}
        onScrub={handleScrub}
        onNoteClick={handleNoteClick}
        onPlayPause={handleTogglePlayback}
        onPlayBarPositionChange={setPlayBarPosition}
        fingeringSystem={fingeringSystem}
        recorderType={recorderType}
        transpose={transposeSemitones}
        latencyMs={0}
      />

      {/* Controls overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 gap-2">
        {/* Countdown overlay (centered, sits above the middle of the visualizer) */}
        <AnimatePresence>
          {countdown !== null && (
            <Motion.div
              key="compact-countdown"
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <AnimatePresence mode="wait">
                <Motion.span
                  key={countdown}
                  className="text-9xl font-iosevka font-bold text-accent-pink text-shadow-[0_0_48px_var(--color-note-full)] select-none"
                  initial={{ opacity: 0, scale: 1.7, y: -16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.55, y: 16 }}
                  transition={{ type: "spring", stiffness: 280, damping: 22 }}
                >
                  {countdown}
                </Motion.span>
              </AnimatePresence>
            </Motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* ── Bottom: Timeline ── */}
      <div className="mt-1 px-2 py-1 pointer-events-auto">
        {song && (
          <SongTimeline
            currentBeat={currentBeat}
            durationBeats={durationBeats}
            noteWidth={noteWidth}
            playBarPosition={playBarPosition}
            onScrubStart={handleScrubStart}
            onScrub={handleScrub}
            onNoteWidthChange={handleNoteWidthChange}
          />
        )}
      </div>
    </div>
  );
}
