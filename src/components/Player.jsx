import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import Directory from "./Directory";
import Visualizer from "./Visualizer";
import SongTimeline from "./SongTimeline";
import InstrumentManager from "./instruments/InstrumentManager";
import usePlayer from "../hooks/usePlayer.js";
import { useTranslation } from "react-i18next";
import { computeNoteRangeFromActions } from "../libs/utils.js";

export default function Player() {
  // URL param — present when route is /songs/:songId
  const { songId: urlSongId } = useParams();
  const { t } = useTranslation();

  // player hook encapsulates audio/playback logic
  const {
    song,
    selectSong,
    isPlaying,
    currentBeat,
    bpm,
    noteWidth,
    repeat,
    setRepeat,
    setNoteTriggerListener,
    selectedTrack,
    fingeringSystem,
    durationBeats,
    isAudioReady,
    isReady: isAudioReadyAll,
    transposeSemitones,
    setTransposeSemitones,
    // handlers
    registerSampler,
    deregisterSampler,
    startPlayback,
    pausePlayback,
    stopPlayback,
    handleNoteClick,
    handleScrubStart,
    handleScrub,
    handleRestart,
    handleBpmChange,
    handleNoteWidthChange,
    handleToggleChanged,
    handleAudioReady,
    setFingeringSystem,
  } = usePlayer();

  // visual readiness is owned by the Visualizer component
  const [isVisualReady, setIsVisualReady] = useState(false);

  // URL-based loading state
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState(null);

  // Cache for songs fetched via URL so navigating back doesn't re-fetch
  const songCacheRef = useRef({});
  // When true, Player should perform the playback position reset after the
  // Visualizer finishes its fade transition (onReady). This avoids the visual
  // cross-fade being interrupted by an immediate reset.
  const pendingResetRef = useRef(false);

  // ── Start timer ────────────────────────────────────────────────────────────
  // How many seconds to count down before starting playback (0 = instant)
  const [startDelay, setStartDelay] = useState(0);
  // Current countdown value being displayed; null when idle
  const [countdown, setCountdown] = useState(null);
  const countdownTimerRef = useRef(null);

  const cancelCountdown = useCallback(() => {
    clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
  }, []);

  const handlePlay = useCallback(() => {
    if (startDelay === 0) {
      startPlayback();
      return;
    }
    // Kick off a visual countdown, then start playback when it reaches 0
    let remaining = startDelay;
    setCountdown(remaining);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        setCountdown(null);
        startPlayback();
      } else {
        setCountdown(remaining);
        countdownTimerRef.current = setTimeout(tick, 1000);
      }
    };
    countdownTimerRef.current = setTimeout(tick, 1000);
  }, [startDelay, startPlayback]);

  // Combined handler used by both the Play button and the Space-bar shortcut
  const handleTogglePlayback = useCallback(() => {
    if (countdown !== null) cancelCountdown();
    else if (isPlaying) pausePlayback();
    else handlePlay();
  }, [countdown, isPlaying, cancelCountdown, pausePlayback, handlePlay]);

  // Cancel any in-progress countdown when the loaded song changes
  useEffect(() => {
    cancelCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  // Cleanup the timer on unmount
  useEffect(() => {
    return () => clearTimeout(countdownTimerRef.current);
  }, []);

  // Pause playback whenever the transpose value changes (skip initial mount)
  const isFirstTransposeRender = useRef(true);
  useEffect(() => {
    if (isFirstTransposeRender.current) {
      isFirstTransposeRender.current = false;
      return;
    }
    pausePlayback();
  }, [transposeSemitones, pausePlayback]);

  // per-track flash counters — increment each time a track fires a note
  const [flashCounters, setFlashCounters] = useState({});
  const flashCountersRef = useRef(flashCounters);
  useEffect(() => {
    flashCountersRef.current = flashCounters;
  }, [flashCounters]);

  useEffect(() => {
    setNoteTriggerListener((trackIndices) => {
      setFlashCounters((prev) => {
        const next = { ...prev };
        for (const i of trackIndices) {
          next[i] = (next[i] ?? 0) + 1;
        }
        return next;
      });
    });
    return () => setNoteTriggerListener(null);
  }, [setNoteTriggerListener]);

  // Load a song when the URL param changes
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
        // Return from cache if available
        if (songCacheRef.current[urlSongId]) {
          if (!cancelled) {
            pendingResetRef.current = true;
            setIsVisualReady(false);
            selectSong(songCacheRef.current[urlSongId]);
            setUrlLoading(false);
          }
          return;
        }

        // Fetch the song index to resolve the file name
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

        // Fetch the song file
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
    // selectSong is stable (wrapped in useCallback inside the hook)
  }, [urlSongId, selectSong]);

  // play bar position is a UI concern kept locally
  const [playBarPosition, setPlayBarPosition] = useState(0.95);

  // instrument controller DOM node
  const [controllerNode, setControllerNode] = useState(null);

  const isReady = isVisualReady && isAudioReadyAll;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-[calc(100dvh-8rem)] text-main space-y-2">
      {/* Song selector row */}
      <div className="flex items-center gap-2">
        <Directory />

        {urlLoading ? (
          <span className="opacity-60 italic">{t("player.loadingSong")}</span>
        ) : urlError ? (
          /* Error banner for invalid / failed song IDs */
          <span className="flex items-center gap-2 text-sm">
            <span className="inline-block rounded-lg bg-red-900/60 border border-red-500 px-3 py-1 text-red-200">
              ⚠ {urlError}
            </span>
          </span>
        ) : (
          <span>
            {song ? (
              <>
                {song.title}
                {song.composer && (
                  <span className="opacity-60 text-sm"> — {song.composer}</span>
                )}
              </>
            ) : (
              t("player.selectSong")
            )}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="w-full flex justify-between gap-2 not-sm:flex-col">
        <div className="max-w-full sm:max-w-100 grow text-base">
          {/* BPM */}
          <div className="mt-2 flex items-center gap-2">
            <label title="bpm">{t("player.bpm")}:</label>
            <div className="flex-1 ml-4 mr-8">
              <DuoSlideBar
                min={30}
                max={240}
                step={1}
                value={bpm}
                onChange={(v) => handleBpmChange(v)}
                thumbColors={{
                  background: "bg-note-half",
                  border: "border-note-half-dark",
                  text: "text-main",
                }}
                barColor="bg-note-full"
              />
            </div>
            <DuoButton
              className="text-sm -translate-x-4"
              text="text-main"
              background="bg-note-half"
              padding="px-1.5"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              onClick={() => song && handleBpmChange(song.bpm)}
              disabled={!isReady}
            >
              {t("player.reset")}
            </DuoButton>
          </div>

          {/* Note width */}
          <div className="mt-2 flex items-center gap-2">
            <label title="note width">{t("player.noteWidth")}:</label>
            <div className="flex-1 mx-4">
              <DuoSlideBar
                min={40}
                max={200}
                step={1}
                value={noteWidth}
                onChange={(v) => handleNoteWidthChange(v)}
                thumbColors={{
                  background: "bg-note-half",
                  border: "border-note-half-dark",
                  text: "text-main",
                }}
                barColor="bg-note-full"
              />
            </div>
          </div>

          {/* Transpose */}
          <div className="mt-2 flex items-center gap-2">
            <label title="transpose semitones">{t("player.transpose")}:</label>
            <div className="flex-1 ml-4 mr-8">
              <DuoSlideBar
                min={-24}
                max={24}
                step={1}
                value={transposeSemitones}
                onChange={(v) => setTransposeSemitones(v)}
                thumbColors={{
                  background:
                    transposeSemitones !== 0 ? "bg-amber-400" : "bg-note-half",
                  border:
                    transposeSemitones !== 0
                      ? "border-amber-600"
                      : "border-note-half-dark",
                  text: transposeSemitones !== 0 ? "text-black" : "text-main",
                }}
                barColor={
                  transposeSemitones !== 0 ? "bg-amber-400/60" : "bg-note-full"
                }
              />
            </div>
            <DuoButton
              className="text-sm -translate-x-4"
              text="text-main"
              background="bg-note-half"
              padding="px-1.5"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              onClick={() => setTransposeSemitones(0)}
              disabled={transposeSemitones === 0}
            >
              {t("player.reset")}
            </DuoButton>
          </div>

          {/* Start timer selector */}
          <div className="mt-2 flex items-center gap-2">
            <label title="start timer">{t("player.start")}:</label>
            <div className="flex gap-1 ml-4">
              {[0, 1, 2, 3].map((s) => (
                <DuoButton
                  key={s}
                  padding="px-1.5 py-0.5"
                  className="w-10 text-sm"
                  text={startDelay === s ? "text-card-bg" : "text-main"}
                  background={
                    startDelay === s ? "bg-note-full" : "bg-note-half"
                  }
                  shadowBackground={
                    startDelay === s ? "bg-note-full-dark" : "bg-note-half-dark"
                  }
                  border={
                    startDelay === s
                      ? "border-note-full-dark"
                      : "border-note-half-dark"
                  }
                  onClick={() => setStartDelay(s)}
                  disabled={!isReady}
                >
                  {s}s
                </DuoButton>
              ))}
            </div>
          </div>
        </div>

        {/* Playback buttons */}
        <div className="flex gap-2 not-md:ml-auto items-center *:h-8">
          <DuoToggleButton
            value={isPlaying || countdown !== null}
            onToggle={handlePlay}
            offToggle={() =>
              countdown !== null ? cancelCountdown() : pausePlayback()
            }
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

      {/* Visualizer with countdown overlay */}
      <div className="relative">
        <Visualizer
          song={song}
          currentBeat={currentBeat}
          durationBeats={durationBeats}
          isPlaying={isPlaying}
          bpm={bpm}
          noteWidth={noteWidth}
          playBarPosition={playBarPosition}
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
          transpose={transposeSemitones}
        />

        {/* Countdown number overlay — shown over the visualizer */}
        <AnimatePresence>
          {countdown !== null && (
            <Motion.div
              key="countdown-overlay"
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

      {/* Song timeline */}
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

      <div className="flex mt-4 gap-2">
        {song?.tracks?.map((track, index) => (
          <InstrumentManager
            controllerNode={controllerNode}
            key={`${index}-${track.instrument}`}
            slot={index}
            flashCount={flashCounters[index] ?? 0}
            name={track.instrument}
            register={registerSampler}
            deregister={deregisterSampler}
            toggle={index === selectedTrack}
            onToggleChanged={handleToggleChanged}
            initialReady={isAudioReady?.[index]}
            handleAudioReady={(value) => handleAudioReady(index, value)}
            onReady={() => handleAudioReady(index, true)}
            offReady={() => handleAudioReady(index, false)}
            trackNoteRange={
              track.noteRange ?? computeNoteRangeFromActions(track.actions)
            }
            transpose={transposeSemitones}
            fingeringSystem={fingeringSystem}
            callbacks={{
              pausePlayback,
              setFingeringSystem,
            }}
          />
        ))}
      </div>

      {!!song && (
        <div className="space-y-2">
          <h2>
            {t("player.instrumentController")}:
            {selectedTrack === null && (
              <span> {t("player.selectInstrumentHint")}</span>
            )}
          </h2>
          <div className="pl-2" ref={(node) => setControllerNode(node)}></div>
        </div>
      )}
    </div>
  );
}
