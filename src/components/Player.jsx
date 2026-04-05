import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import AmbientLight from "./AmbientLight.jsx";
import { useMatch } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import AdvancedSettingsModal from "./AdvancedSettingsModal";
import Directory from "./Directory";
import Visualizer from "./Visualizer";
import SongTimeline from "./SongTimeline";
import InstrumentManager from "./instruments/InstrumentManager";
import SettingTooltip from "./SettingTooltip";
import usePlayer from "../hooks/usePlayer.js";
import usePlayMode from "../hooks/usePlayMode.js";
import { useTranslation } from "react-i18next";
import { computeNoteRangeFromActions, midiToNoteName } from "../libs/utils.js";
import * as Tone from "tone";
import SelectDeviceModal from "./SelectDeviceModal";

export default function Player() {
  // URL param — present when route is /songs/:songId
  const songMatch = useMatch("/songs/:songId");
  const urlSongId = songMatch?.params?.songId;
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
    _internal: { samplersRef: internalSamplersRef },
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
    latencyMs,
    setLatencyMs,
    suppressAudioTrack,
    setPauseGate,
  } = usePlayer();

  // Always-fresh beat ref — passed to usePlayMode so the onNoteInput callback
  // can read the current beat without being in a stale closure.
  const currentBeatRef = useRef(currentBeat);
  useEffect(() => {
    currentBeatRef.current = currentBeat;
  }, [currentBeat]);

  // ── Play Mode ────────────────────────────────────────────────────────────────
  const {
    micStatus,
    micName,
    midiStatus,
    midiInputs,
    selectedMidiInput,
    selectMidiInput,
    requestMicrophone,
    stopMicrophone,
    requestMidi,
    playModeEnabled,
    setPlayModeEnabled,
    isWaiting,
    cancelWait,
    canEnablePlayMode,
    showSelectDevice,
    setShowSelectDevice,
  } = usePlayMode({
    song,
    transpose: transposeSemitones,
    currentBeat,
    currentBeatRef,
    isPlaying,
    pausePlayback,
    startPlayback,
    handleScrub,
    setPauseGate,
  });

  // Play mode (mic OR MIDI): silence the song scheduler for track 0 so the
  // note at the waited beat never auto-plays before the user triggers it.
  // suppressAudioTrack is checked every tick, so it works even when
  // startPlayback has already captured state.synth by value.
  useEffect(() => {
    if (!playModeEnabled) return;
    suppressAudioTrack(0, true);
    return () => suppressAudioTrack(0, false);
  }, [playModeEnabled, suppressAudioTrack]);

  // MIDI play mode only: route MIDI note-on/off directly to the sampler so
  // the controller drives audio instead of the (now-silenced) scheduler.
  useEffect(() => {
    if (!playModeEnabled || !selectedMidiInput) return;

    const handler = async (msg) => {
      const sampler = internalSamplersRef.current[0];
      if (!sampler) return;
      try {
        await Tone.start();
      } catch {
        return;
      }
      const [status, note, velocity] = msg.data;
      const noteName = midiToNoteName(note);
      if ((status & 0xf0) === 0x90 && velocity > 0) {
        sampler.triggerAttack(noteName, Tone.now(), velocity / 127);
      } else if (
        (status & 0xf0) === 0x80 ||
        ((status & 0xf0) === 0x90 && velocity === 0)
      ) {
        sampler.triggerRelease(noteName, Tone.now());
      }
    };

    selectedMidiInput.addEventListener("midimessage", handler);
    return () => selectedMidiInput.removeEventListener("midimessage", handler);
  }, [playModeEnabled, selectedMidiInput, internalSamplersRef]);

  // visual readiness is owned by the Visualizer component
  const [isVisualReady, setIsVisualReady] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Visual-effect preferences
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [pulseEnabled, setPulseEnabled] = useState(true);
  const [ambientEnabled, setAmbientEnabled] = useState(true);

  // Per-slot out-of-range status: Map<slot, { outOfRange, alternatives }>
  const rangeStatusRef = useRef({});
  const [rangeWarning, setRangeWarning] = useState(null);
  // null  → no warning
  // { alternatives: string[] } → warning active

  // Floating scroll-to-top button
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  const handleRangeStatus = useCallback(
    ({ outOfRange, alternatives, slot }) => {
      rangeStatusRef.current[slot] = { outOfRange, alternatives };
      const statuses = Object.values(rangeStatusRef.current);
      const anyOut = statuses.some((s) => s.outOfRange);
      if (!anyOut) {
        setRangeWarning(null);
        return;
      }
      // Merge alternatives from all out-of-range slots, deduplicate by system name.
      const seen = new Set();
      const merged = statuses
        .flatMap((s) => (s.outOfRange ? (s.alternatives ?? []) : []))
        .filter((a) => {
          if (seen.has(a.system)) return false;
          seen.add(a.system);
          return true;
        });
      setRangeWarning({ alternatives: merged });
    },
    [],
  );

  // Cancel any in-progress countdown when the loaded song changes
  useEffect(() => {
    cancelCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  // Re-evaluate the range warning when the song changes.
  // IMPORTANT: React runs child effects before parent effects, so by the time
  // this runs, InstrumentManager has already filed fresh outOfRange reports into
  // rangeStatusRef for every current slot. We only need to prune stale slots
  // (from a previous song with more tracks) and recompute from current data.
  useEffect(() => {
    const numTracks = song?.tracks?.length ?? 0;
    // Prune slots that no longer exist in the new song.
    for (const key of Object.keys(rangeStatusRef.current)) {
      if (Number(key) >= numTracks) {
        delete rangeStatusRef.current[key];
      }
    }
    // Recompute warning from the (now-fresh) slot data.
    const statuses = Object.values(rangeStatusRef.current);
    const anyOut = statuses.some((s) => s.outOfRange);
    if (!anyOut) {
      setRangeWarning(null);
      return;
    }
    const seen = new Set();
    const merged = statuses
      .flatMap((s) => (s.outOfRange ? (s.alternatives ?? []) : []))
      .filter((a) => {
        if (seen.has(a.system)) return false;
        seen.add(a.system);
        return true;
      });
    setRangeWarning({ alternatives: merged });
  }, [song?.id, song?.tracks?.length]);

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
      {/* Ambient glow — portalled to document.body so it lives in the root
          stacking context at z-[1], above the SynthwaveBackground (z-0) and
          below the page content (z-10). This lets the glow bleed through the
          entire viewport, not just the Player container. */}
      {ambientEnabled &&
        createPortal(
          <AmbientLight
            flashCounters={flashCounters}
            numTracks={song?.tracks?.length ?? 0}
          />,
          document.body,
        )}
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
            <div className="flex items-center gap-1">
              <label>{t("player.bpm")}:</label>
              <SettingTooltip>{t("player.tips.bpm")}</SettingTooltip>
            </div>
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

          {/* Transpose */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <label>{t("player.transpose")}:</label>
              <SettingTooltip>{t("player.tips.transpose")}</SettingTooltip>
            </div>
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

          {/* Note Width */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <label title="note width">{t("player.noteWidthFull")}:</label>
              <SettingTooltip>{t("player.tips.noteWidth")}</SettingTooltip>
            </div>
            <div className="flex-1 ml-4 mr-8">
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
            <DuoButton
              className="text-sm -translate-x-4"
              text="text-main"
              background="bg-note-half"
              padding="px-1.5"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              onClick={() => handleNoteWidthChange(160)}
              disabled={noteWidth === 160}
            >
              {t("player.reset")}
            </DuoButton>
          </div>

          {/* Advanced settings toggle */}
          <div className="mt-2 flex items-center gap-2">
            <DuoToggleButton
              value={showAdvancedSettings}
              onToggle={() => setShowAdvancedSettings(true)}
              offToggle={() => setShowAdvancedSettings(false)}
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
            >
              {t("player.advancedSettings")}
            </DuoToggleButton>
          </div>

          {/* Start timer selector */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <label>{t("player.start")}:</label>
              <SettingTooltip>{t("player.tips.start")}</SettingTooltip>
            </div>
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

        <div className="flex flex-col gap-2 justify-end">
          {/* Select Device + Play Mode row */}
          <div className="flex gap-2 justify-end items-center not-md:ml-auto">
            <DuoButton
              background="bg-note-half"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              text="text-main"
              onClick={() => setShowSelectDevice(true)}
            >
              {t("playMode.selectDevice")}
            </DuoButton>

            <DuoToggleButton
              value={playModeEnabled}
              onToggle={() => setPlayModeEnabled(true)}
              offToggle={() => setPlayModeEnabled(false)}
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
              disabled={!canEnablePlayMode && !playModeEnabled}
            >
              {t("playMode.title")}
            </DuoToggleButton>

            <SettingTooltip>{t("playMode.tip")}</SettingTooltip>
          </div>

          {/* Device status text */}
          <div className="flex justify-end gap-3 text-xs opacity-50 not-md:ml-auto">
            <span>
              {t("playMode.deviceStatus.microphone")}:{" "}
              {micStatus === "granted"
                ? (micName ?? t("playMode.deviceStatus.connected"))
                : (micStatus ?? t("playMode.deviceStatus.none"))}
            </span>
            <span>
              {t("playMode.deviceStatus.midi")}:{" "}
              {selectedMidiInput
                ? selectedMidiInput.name
                : t("playMode.deviceStatus.none")}
            </span>
          </div>

          {/* Playback buttons */}
          <div className="flex gap-2 justify-end not-md:ml-auto items-center *:h-8">
            <DuoToggleButton
              value={isPlaying || countdown !== null || isWaiting}
              onToggle={handlePlay}
              offToggle={() => {
                if (isWaiting) cancelWait();
                else if (countdown !== null) cancelCountdown();
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
                : isPlaying || isWaiting
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
                if (isWaiting) cancelWait();
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
      </div>

      <SelectDeviceModal
        isOpen={showSelectDevice}
        onClose={() => setShowSelectDevice(false)}
        micStatus={micStatus}
        micName={micName}
        onRequestMicrophone={requestMicrophone}
        midiStatus={midiStatus}
        midiInputs={midiInputs}
        selectedMidiInput={selectedMidiInput}
        onSelectMidiInput={selectMidiInput}
        onStopMicrophone={stopMicrophone}
        onRequestMidi={requestMidi}
      />

      <AdvancedSettingsModal
        isOpen={showAdvancedSettings}
        onClose={() => setShowAdvancedSettings(false)}
        latencyMs={latencyMs}
        onLatencyChange={setLatencyMs}
        particlesEnabled={particlesEnabled}
        onParticlesToggle={setParticlesEnabled}
        pulseEnabled={pulseEnabled}
        onPulseToggle={setPulseEnabled}
        ambientEnabled={ambientEnabled}
        onAmbientToggle={setAmbientEnabled}
      />

      {/* Floating scroll-to-top button */}
      <AnimatePresence>
        {showScrollTop && (
          <Motion.div
            key="scroll-top"
            className="fixed bottom-6 right-6 z-50"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <DuoButton
              padding="px-3 py-2"
              background="bg-note-half"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              text="text-main"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label={t("player.scrollToTop")}
            >
              ↑ {t("player.scrollToTop")}
            </DuoButton>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Visualizer with countdown overlay */}
      <div className="relative">
        <Visualizer
          song={song}
          currentBeat={currentBeat}
          durationBeats={durationBeats}
          isPlaying={isPlaying}
          bpm={bpm}
          noteWidth={noteWidth}
          particlesEnabled={particlesEnabled}
          playBarPosition={playBarPosition}
          rangeWarning={rangeWarning}
          onReady={() => {
            setIsVisualReady(true);
            if (pendingResetRef.current) {
              stopPlayback();
              pendingResetRef.current = false;
            }
          }}
          onScrubStart={() => {
            if (isWaiting) cancelWait();
            handleScrubStart();
          }}
          onScrub={handleScrub}
          onNoteClick={handleNoteClick}
          onPlayPause={handleTogglePlayback}
          onPlayBarPositionChange={setPlayBarPosition}
          fingeringSystem={fingeringSystem}
          transpose={transposeSemitones}
          latencyMs={latencyMs}
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
          onScrubStart={() => {
            if (isWaiting) cancelWait();
            handleScrubStart();
          }}
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
            muted={
              index === 0 &&
              playModeEnabled &&
              micStatus === "granted" &&
              selectedMidiInput === null
            }
            flashCount={pulseEnabled ? (flashCounters[index] ?? 0) : 0}
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
            onOutOfRange={handleRangeStatus}
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
