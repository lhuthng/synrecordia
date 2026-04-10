import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import {
  VISUALIZABLE_INSTRUMENTS,
  NON_VISUALIZABLE_INSTRUMENTS,
  ALL_INSTRUMENTS,
} from "../libs/packedSampler/factory";
import * as Tone from "tone";
import SelectDeviceModal from "./SelectDeviceModal";
import { useMobileMenu } from "../context/useMobileMenu";
import { useEcoMode } from "../context/EcoModeContext";

export default function Player() {
  // URL param — present when route is /songs/:songId
  const songMatch = useMatch("/songs/:songId");
  const urlSongId = songMatch?.params?.songId;
  const { t } = useTranslation();
  const { ecoMode, autoDetected: autoEcoMode, setManualEcoMode } = useEcoMode();

  // player hook encapsulates audio/playback logic
  const {
    song,
    selectSong,
    isPlaying,
    currentBeat,
    bpm,
    noteWidth,
    idealNoteWidth,
    repeat,
    setRepeat,
    setNoteTriggerListener,
    selectedTrack,
    fingeringSystem,
    recorderType,
    durationBeats,
    isAudioReady,
    isReady: isAudioReadyAll,
    transposeSemitones,
    setTransposeSemitones,
    // handlers
    registerSampler,
    deregisterSampler,
    _internal: {
      samplersRef: internalSamplersRef,
      instrumentOverridesRef: internalInstrumentOverridesRef,
    },
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
    setRecorderType,
    latencyMs,
    setLatencyMs,
    suppressAudioTrack,
    setPauseGate,
    pendingHint,
    clearPendingHint,
  } = usePlayer();

  useEffect(() => {
    if (!pendingHint) return;
    const id = setTimeout(() => clearPendingHint(), 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHint]);

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
    detectedNote,
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

  const { setExtraContent } = useMobileMenu();

  // visual readiness is owned by the Visualizer component
  const [isVisualReady, setIsVisualReady] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Per-slot instrument overrides: { [slotIndex]: instrumentName }
  const [instrumentOverrides, setInstrumentOverrides] = useState({});

  // Keep the usePlayer instrumentOverridesRef in sync so startPlayback can
  // use the correct monophonic/polyphonic behaviour after a swap.
  useEffect(() => {
    internalInstrumentOverridesRef.current = instrumentOverrides;
  }, [instrumentOverrides, internalInstrumentOverridesRef]);

  // Song seen by the Visualizer — track 0's instrument is replaced by any
  // active override so the correct visualizer renderer is used immediately.
  const visualizerSong = useMemo(() => {
    if (!song) return song;
    const override = instrumentOverrides[0];
    if (!override || override === song.tracks?.[0]?.instrument) return song;
    const newTracks = song.tracks.map((track, i) =>
      i === 0 ? { ...track, instrument: override } : track,
    );
    return { ...song, tracks: newTracks };
  }, [song, instrumentOverrides]);

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

  // Push Select Device + Play Mode controls into the mobile hamburger menu
  useEffect(() => {
    setExtraContent(
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 items-center flex-wrap *:mx-auto">
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
        </div>
        <div className="flex flex-col items-end gap-0.5 text-xs text-main opacity-60">
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
      </div>,
    );
    return () => setExtraContent(null);
  }, [
    playModeEnabled,
    canEnablePlayMode,
    micStatus,
    micName,
    selectedMidiInput,
    t,
    setExtraContent,
    setShowSelectDevice,
    setPlayModeEnabled,
  ]);

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

  const handleSwapInstrument = useCallback(
    (slot, newName) => {
      if (
        newName ===
        (instrumentOverrides[slot] ?? song?.tracks?.[slot]?.instrument)
      )
        return;
      pausePlayback();
      setInstrumentOverrides((prev) => ({ ...prev, [slot]: newName }));
    },
    [instrumentOverrides, song, pausePlayback],
  );

  // Stable per-track handler map — prevents InstrumentManager from re-rendering
  // on every currentBeat tick caused by inline arrow functions recreated each render.
  const trackHandlers = useMemo(
    () =>
      (song?.tracks ?? []).map((_, i) => ({
        handleAudioReady: (value) => handleAudioReady(i, value),
        onSwapInstrument: (newName) => handleSwapInstrument(i, newName),
      })),
    // Only re-create when track count or stable callbacks change.
    // handleAudioReady and handleSwapInstrument are both useCallback — they are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song?.tracks?.length, handleAudioReady, handleSwapInstrument],
  );

  // Stable shared callbacks object for InstrumentManager → Presentation.
  // pausePlayback is useCallback; setFingeringSystem/setRecorderType are state setters — all stable.
  const instrumentCallbacks = useMemo(
    () => ({ pausePlayback, setFingeringSystem, setRecorderType }),
    [pausePlayback, setFingeringSystem, setRecorderType],
  );

  // Cancel any in-progress countdown when the loaded song changes
  useEffect(() => {
    cancelCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  // Reset instrument overrides when a new song is loaded
  useEffect(() => {
    setInstrumentOverrides({});
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
      selectSong(null);
      setIsVisualReady(false);
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
    <div className="w-full text-main space-y-2">
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
              <Motion.span className="inline-flex items-center gap-1.5 select-none">
                {/* Bouncing left arrow drawing attention to the Directory folder button */}
                <Motion.span
                  className="text-note-full font-bold leading-none"
                  animate={{ x: [-3, 1, -3] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.0,
                    ease: "easeInOut",
                  }}
                  aria-hidden="true"
                >
                  ←
                </Motion.span>
                {/* Pulsing text */}
                <Motion.span
                  animate={{ opacity: [0.65, 1, 0.65] }}
                  transition={{
                    repeat: Infinity,
                    duration: 2.5,
                    ease: "easeInOut",
                  }}
                >
                  {t("player.selectSong")}
                </Motion.span>
              </Motion.span>
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
                max={400}
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
              onClick={() => handleNoteWidthChange(idealNoteWidth)}
              disabled={noteWidth === idealNoteWidth}
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
          {/* Select Device + Play Mode row — hidden on mobile (moved to hamburger menu) */}
          <div className="hidden sm:flex gap-2 justify-end items-center not-md:ml-auto">
            <DuoButton
              background="bg-note-half"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              text="text-main"
              onClick={() => setShowSelectDevice(true)}
            >
              {t("playMode.selectDevice")}
            </DuoButton>
            <SettingTooltip>{t("playMode.tip")}</SettingTooltip>
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
          </div>

          {/* Device status text — hidden on mobile (moved to hamburger menu) */}
          <div className="hidden sm:flex justify-end gap-3 text-xs opacity-50 not-md:ml-auto">
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
          <div className="flex gap-2 justify-end not-md:ml-auto items-center">
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
        ecoMode={ecoMode}
        autoEcoMode={autoEcoMode}
        onEcoModeToggle={setManualEcoMode}
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
        {pendingHint && (
          <Motion.div
            key="hint-toast"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-note-half border-2 border-note-half-dark px-3 py-2 font-semibold text-base text-note-half-dark shadow-lg cursor-pointer hover:brightness-125 transition-[filter]"
              onClick={clearPendingHint}
            >
              <span>♪</span>
              <span>
                {t("player.hint.recorderType", {
                  type: t(`recorderType.${pendingHint}`),
                })}
              </span>
              <span className="opacity-40 ml-1 text-xs">✕</span>
            </button>
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Visualizer with countdown overlay */}
      <div className="relative">
        <Visualizer
          song={visualizerSong}
          currentBeat={currentBeat}
          durationBeats={durationBeats}
          isPlaying={isPlaying}
          bpm={bpm}
          noteWidth={noteWidth}
          particlesEnabled={particlesEnabled}
          ecoMode={ecoMode}
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
          recorderType={recorderType}
          transpose={transposeSemitones}
          latencyMs={latencyMs}
        />

        {/* Play-mode note-detection badge — flashes on every confirmed mic/MIDI onset */}
        <AnimatePresence>
          {playModeEnabled && detectedNote && (
            <Motion.div
              key={detectedNote.ts}
              className="absolute top-2 pointer-events-none z-10 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-black/70 text-note-full border border-note-full-dark select-none"
              style={{ left: `calc(${playBarPosition * 100}% - 2rem)` }}
              initial={{ opacity: 0, y: -6, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.85 }}
              transition={{ duration: 0.12 }}
            >
              <svg className="w-4 fill-note-full" viewBox="0 0 24 24">
                <path d="M19.8497 4.70055C19.4524 3.57581 18.353 2.87898 17.1944 3.01758C16.9333 3.04881 16.6802 3.14255 16.4231 3.2575C16.1681 3.3715 15.8568 3.53109 15.4744 3.7272L12.999 4.99649C12.7146 5.14218 12.4921 5.25614 12.3014 5.40562C11.8107 5.79042 11.4753 6.34702 11.3591 6.96924C11.314 7.21097 11.3141 7.46603 11.3143 7.79211L11.3143 7.86969C11.3143 7.97438 11.3143 8.07441 11.3145 8.16992L11.3143 14.2982C10.5374 13.5505 9.49228 13.0925 8.34284 13.0925C5.94436 13.0925 4 15.0866 4 17.5463C4 20.0061 5.94436 22.0001 8.34284 22.0001C10.7413 22.0001 12.6857 20.0061 12.6857 17.5463V11.1833C13.1164 11.4089 13.6124 11.5084 14.1199 11.4477C14.381 11.4165 14.6341 11.3227 14.8912 11.2078C15.1462 11.0938 15.4574 10.9342 15.8399 10.7381L18.3152 9.46882C18.5997 9.32312 18.8222 9.20917 19.0128 9.05968C19.5036 8.67488 19.839 8.11828 19.9551 7.49606C20.0002 7.25434 20.0001 6.99929 20 6.67322L20 6.59559C20 6.15712 20 5.80024 19.9854 5.51536C19.9706 5.2281 19.9392 4.95404 19.8497 4.70055Z"></path>
              </svg>
              {detectedNote.name}
            </Motion.div>
          )}
        </AnimatePresence>

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
        {song?.tracks?.map((track, index) => {
          const effectiveInstrument =
            instrumentOverrides[index] ?? track.instrument;
          // Track 0 can only be swapped to visualizable instruments; others can only use non-visualizable
          const swappable =
            index === 0
              ? VISUALIZABLE_INSTRUMENTS
              : NON_VISUALIZABLE_INSTRUMENTS;
          return (
            <InstrumentManager
              controllerNode={controllerNode}
              key={`${index}-${effectiveInstrument}`}
              slot={index}
              muted={
                index === 0 &&
                playModeEnabled &&
                micStatus === "granted" &&
                selectedMidiInput === null
              }
              flashCount={pulseEnabled ? (flashCounters[index] ?? 0) : 0}
              name={effectiveInstrument}
              register={registerSampler}
              deregister={deregisterSampler}
              toggle={index === selectedTrack}
              onToggleChanged={handleToggleChanged}
              initialReady={isAudioReady?.[index]}
              handleAudioReady={trackHandlers[index]?.handleAudioReady}
              trackNoteRange={
                track.noteRange ?? computeNoteRangeFromActions(track.actions)
              }
              transpose={transposeSemitones}
              fingeringSystem={fingeringSystem}
              recorderType={recorderType}
              onOutOfRange={handleRangeStatus}
              swappableInstruments={swappable}
              onSwapInstrument={trackHandlers[index]?.onSwapInstrument}
              callbacks={instrumentCallbacks}
            />
          );
        })}
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
