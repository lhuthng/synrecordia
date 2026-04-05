import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { noteNameToMidi, transposeNote } from "../libs/utils.js";
import { getHighestNote } from "../components/utils/fingeringUtils.js";

// How many beats before a note the system starts listening for user input
const PRE_WINDOW_BEATS = 0.75;
// How many beats after the note's beat before we consider it missed
const POST_WINDOW_BEATS = 0.3;

// ---------------------------------------------------------------------------
// Pure helpers (module-level — no hook closure needed)
// ---------------------------------------------------------------------------

/**
 * Simple autocorrelation pitch detector.
 * Returns the closest MIDI note number, or null if the signal is too quiet
 * or the correlation is too weak.
 */
function detectMidiFromAudio(buffer, sampleRate) {
  const n = buffer.length;

  // RMS energy check — silence gate
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.015) return null;

  // Lag search bounded to the recorder's playable frequency range
  const minFreq = 200; // below the lowest recorder note
  const maxFreq = 2600; // above the highest recorder note
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) corr += buffer[i] * buffer[i + lag];
    corr /= len;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Reject if correlation strength is below a fraction of the signal's power
  let rms0 = 0;
  for (let i = 0; i < n; i++) rms0 += buffer[i] * buffer[i];
  if (bestCorr < 0.05 * (rms0 / n)) return null;

  const freq = sampleRate / bestLag;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return midi >= 0 && midi <= 127 ? midi : null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * usePlayMode — manages microphone + MIDI device selection and the "wait for
 * the player" play-mode beat-tracking logic.
 *
 * Required props from usePlayer:
 *   song, transpose, currentBeat, currentBeatRef,
 *   isPlaying, pausePlayback, startPlayback
 */
export default function usePlayMode({
  song,
  transpose,
  currentBeat,
  currentBeatRef, // MutableRefObject<number> — always-fresh beat position
  isPlaying,
  pausePlayback,
  startPlayback,
  handleScrub, // seek to a specific beat position (from usePlayer)
}) {
  // ── Device state ──────────────────────────────────────────────────────────
  const [micStatus, setMicStatus] = useState(null); // null | 'requesting' | 'granted' | 'denied'
  const [micName, setMicName] = useState(null); // e.g. "Built-in Microphone"
  const micStreamRef = useRef(null); // active MediaStream
  const micContextRef = useRef(null); // AudioContext for pitch detection

  const [midiStatus, setMidiStatus] = useState(null); // null | 'requesting' | 'granted' | 'denied'
  const [midiInputs, setMidiInputs] = useState([]); // MIDIInput[]
  const [selectedMidiInput, setSelectedMidiInput] = useState(null); // MIDIInput | null
  const midiAccessRef = useRef(null); // Web MIDI MIDIAccess object

  // ── Play-mode state ───────────────────────────────────────────────────────
  const [playModeEnabled, setPlayModeEnabled] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showSelectDevice, setShowSelectDevice] = useState(false);

  // ── Beat-tracking refs ────────────────────────────────────────────────────
  const lastBeatRef = useRef(0); // previous beat — used to detect backward scrubs
  const nextNoteIdxRef = useRef(0); // index of the next note to evaluate
  const pendingWindowRef = useRef(null); // { idx, played, openedAtBeat } | null — active listening window
  const waitTargetRef = useRef(null); // { note, midi } | null — note being waited on
  const recentInputsRef = useRef([]); // Array<{ midi, beat }> — recent note inputs

  // ── Computed note events ──────────────────────────────────────────────────
  const pmNoteEvents = useMemo(() => {
    if (!song?.tracks?.[0]) return [];
    return (song.tracks[0].actions ?? [])
      .filter((a) => a.type === "note")
      .map((a) => {
        const raw = getHighestNote(a.pitches ?? a.pitch);
        if (!raw) return null;
        const name = transposeNote(raw, transpose ?? 0);
        const midi = noteNameToMidi(name);
        if (midi === null) return null;
        return {
          time: a.time ?? 0,
          duration: a.duration ?? 0,
          note: name,
          midi,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  }, [song, transpose]);

  // ── onNoteInput — the central "user played a note" callback ──────────────
  // Defined as useCallback so it can be returned and wired to MIDI/mic, but
  // also kept in a ref so the rAF pitch-detection loop always calls the latest
  // version without a stale closure.
  const onNoteInput = useCallback(
    (midiNote) => {
      if (!playModeEnabled) return;

      const beat = currentBeatRef?.current ?? 0;

      if (isWaiting) {
        const target = waitTargetRef.current;
        if (target && midiNote === target.midi) {
          waitTargetRef.current = null;
          pendingWindowRef.current = null;
          nextNoteIdxRef.current += 1; // advance past the waited note
          setIsWaiting(false);
          startPlayback();
        }
        return;
      }

      // Record the input stamped with the current beat position
      recentInputsRef.current.push({ midi: midiNote, beat });

      // Check against the currently open listening window.
      // Only accept inputs that arrived after the window was opened
      // (openedAtBeat guard) so that a held/sustained note from the previous
      // note cannot immediately satisfy the next adjacent note's window.
      if (pendingWindowRef.current && !pendingWindowRef.current.played) {
        const e = pmNoteEvents[pendingWindowRef.current.idx];
        const openedAt = pendingWindowRef.current.openedAtBeat ?? -Infinity;
        if (e && midiNote === e.midi && beat >= openedAt) {
          pendingWindowRef.current.played = true;
        }
      }
    },
    [playModeEnabled, isWaiting, pmNoteEvents, startPlayback, currentBeatRef],
  );

  // Always keep the ref pointing at the latest version of onNoteInput so the
  // rAF loop in startMicPitchDetection is never holding a stale closure.
  const onNoteInputRef = useRef(onNoteInput);
  useEffect(() => {
    onNoteInputRef.current = onNoteInput;
  }, [onNoteInput]);

  // ── Beat tracking effect ──────────────────────────────────────────────────
  useEffect(() => {
    if (!playModeEnabled || !isPlaying || isWaiting) return;

    const events = pmNoteEvents;
    if (!events.length) return;

    // Detect a backward scrub and reset all tracking state
    if (currentBeat < lastBeatRef.current - 0.5) {
      nextNoteIdxRef.current = 0;
      pendingWindowRef.current = null;
      recentInputsRef.current = [];
    }
    lastBeatRef.current = currentBeat;

    // Advance: consume all notes whose listening window has fully passed
    while (nextNoteIdxRef.current < events.length) {
      const e = events[nextNoteIdxRef.current];
      const windowEnd = e.time + POST_WINDOW_BEATS;

      if (currentBeat < windowEnd) break; // window not over yet

      // Was this note played during its window?
      const pw = pendingWindowRef.current;
      const played = pw?.idx === nextNoteIdxRef.current && pw?.played;

      if (!played) {
        // Missed — enter the waiting state and pause playback.
        // Seek back to the note's exact beat so the visualizer doesn't show a
        // position past the note (avoids the LERP overshoot).
        // Deferred via queueMicrotask to satisfy react-hooks/set-state-in-effect.
        waitTargetRef.current = e;
        pendingWindowRef.current = null;
        const noteTime = e.time;
        queueMicrotask(() => {
          pausePlayback();
          handleScrub?.(noteTime);
          setIsWaiting(true);
        });
        return;
      }

      pendingWindowRef.current = null;
      nextNoteIdxRef.current += 1;
    }

    // Open the listening window for the next upcoming note if we're in range
    if (nextNoteIdxRef.current < events.length) {
      const e = events[nextNoteIdxRef.current];
      if (currentBeat >= e.time - PRE_WINDOW_BEATS) {
        if (
          !pendingWindowRef.current ||
          pendingWindowRef.current.idx !== nextNoteIdxRef.current
        ) {
          pendingWindowRef.current = {
            idx: nextNoteIdxRef.current,
            played: false,
            openedAtBeat: currentBeat,
          };
        }
      }
    }
  }, [
    currentBeat,
    playModeEnabled,
    isPlaying,
    isWaiting,
    pmNoteEvents,
    pausePlayback,
    handleScrub,
  ]);

  // ── cancelWait — user opts out of the waiting state (stays paused) ────────
  const cancelWait = useCallback(() => {
    setIsWaiting(false);
    waitTargetRef.current = null;
    pendingWindowRef.current = null;
  }, []);

  // ── Mic pitch detection ───────────────────────────────────────────────────

  /** Start/restart the AudioContext + rAF pitch-detection loop. */
  const startMicPitchDetection = useCallback((stream) => {
    // Close any pre-existing context first
    if (micContextRef.current) {
      micContextRef.current.close().catch(() => {});
      micContextRef.current = null;
    }

    const context = new AudioContext();
    micContextRef.current = context;

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);

    // Per-frame pitch tracking with prevMidi onset gate.
    // detectMidiFromAudio runs every rAF frame so if one frame returns null
    // (signal not yet stable) the next frame retries automatically — unlike a
    // single-shot rising-edge detector which would permanently lose the input.
    // prevMidi resets to null whenever the signal drops below detectMidiFromAudio's
    // internal 0.015 RMS gate (i.e. during a tongue dip between notes), which
    // allows the same pitch to re-trigger for the next consecutive note.
    let prevMidi = null;

    const tick = () => {
      // Stop the loop if the context was closed (e.g. on unmount)
      if (!micContextRef.current || micContextRef.current.state === "closed")
        return;

      analyser.getFloatTimeDomainData(buffer);
      const midi = detectMidiFromAudio(buffer, context.sampleRate);

      // Fire only when the detected note is new or the pitch changed.
      // When midi is null (signal too quiet), prevMidi becomes null so the
      // same pitch fires again on the next attack — handling same-pitch
      // consecutive notes as long as tonguing dips below the silence gate.
      if (midi !== null && midi !== prevMidi) {
        onNoteInputRef.current?.(midi);
      }
      prevMidi = midi;

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, []); // refs only — no stale-closure risk

  const requestMicrophone = useCallback(async () => {
    // Guard: browser may not support getUserMedia at all
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("denied");
      return;
    }

    setMicStatus("requesting");

    // Stop any previously granted stream before requesting a new one
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      micStreamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      setMicName(track?.label || "Microphone");
      setMicStatus("granted");

      startMicPitchDetection(stream);
    } catch {
      setMicStatus("denied");
    }
  }, [startMicPitchDetection]);

  // ── MIDI ──────────────────────────────────────────────────────────────────
  const requestMidi = useCallback(async () => {
    // Guard: Web MIDI API not available in all browsers
    if (!navigator.requestMIDIAccess) {
      setMidiStatus("denied");
      return;
    }

    setMidiStatus("requesting");

    try {
      const access = await navigator.requestMIDIAccess();
      midiAccessRef.current = access;
      setMidiStatus("granted");

      const updateInputs = () => {
        setMidiInputs(Array.from(access.inputs.values()));
      };

      updateInputs();
      access.onstatechange = updateInputs;
    } catch {
      setMidiStatus("denied");
    }
  }, []);

  // Wire the selected MIDI input's onmidimessage → onNoteInput.
  // Uses the ref so the handler always calls the freshest onNoteInput version.
  useEffect(() => {
    if (!selectedMidiInput) return;

    const handler = (msg) => {
      const [status, note, velocity] = msg.data;
      // Note-on event (status 0x9x) with non-zero velocity
      if ((status & 0xf0) === 0x90 && velocity > 0) {
        onNoteInputRef.current?.(note);
      }
    };

    // MIDIInput extends EventTarget — use the standard listener API instead of
    // assigning onmidimessage directly, which avoids a false-positive linter
    // warning about mutating a React state value.
    selectedMidiInput.addEventListener("midimessage", handler);
    return () => {
      selectedMidiInput.removeEventListener("midimessage", handler);
    };
  }, [selectedMidiInput]); // ref-based handler — no need to list onNoteInput

  // Auto-deselect the selected MIDI input if it disappears from the device list.
  // Deferred via queueMicrotask to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (
      selectedMidiInput &&
      !midiInputs.find((i) => i.id === selectedMidiInput.id)
    ) {
      queueMicrotask(() => setSelectedMidiInput(null));
    }
  }, [midiInputs, selectedMidiInput]);

  // ── Side-effects: play mode toggled off ───────────────────────────────────
  useEffect(() => {
    if (!playModeEnabled) {
      // Reset all tracking state but leave mic/MIDI streams open.
      // Deferred via queueMicrotask to satisfy react-hooks/set-state-in-effect.
      queueMicrotask(() => setIsWaiting(false));
      nextNoteIdxRef.current = 0;
      lastBeatRef.current = 0;
      pendingWindowRef.current = null;
      waitTargetRef.current = null;
      recentInputsRef.current = [];
    }
  }, [playModeEnabled]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Stop microphone tracks
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      // Close AudioContext (stops the rAF loop via the state === 'closed' guard)
      if (micContextRef.current) {
        micContextRef.current.close().catch(() => {});
        micContextRef.current = null;
      }
      // Remove MIDI state-change listener
      if (midiAccessRef.current) {
        midiAccessRef.current.onstatechange = null;
        midiAccessRef.current = null;
      }
    };
  }, []); // intentionally empty — runs only on unmount

  // ── Derived ───────────────────────────────────────────────────────────────
  const canEnablePlayMode =
    micStatus === "granted" || selectedMidiInput !== null;

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    // Microphone
    micStatus,
    micName,
    requestMicrophone,

    // MIDI
    midiStatus,
    midiInputs,
    selectedMidiInput,
    setSelectedMidiInput,
    requestMidi,

    // Play mode
    playModeEnabled,
    setPlayModeEnabled,
    isWaiting,
    cancelWait,
    canEnablePlayMode,

    // Modal visibility
    showSelectDevice,
    setShowSelectDevice,

    // Exposed for testing / external wiring
    onNoteInput,
  };
}
