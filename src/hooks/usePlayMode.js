import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { noteNameToMidi, transposeNote } from "../libs/utils.js";
import { getHighestNote } from "../components/utils/fingeringUtils.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// How many beats BEFORE a note's position the user can play and still be accepted.
const ACCEPT_EARLY_BEATS = 0.8;

// Small grace period AFTER the note's beat before we declare it missed.
// Gives the mic detection loop a couple of frames to register the onset.
const GRACE_BEATS = 0.15;

// ─── Autocorrelation pitch detector ──────────────────────────────────────────

function detectMidiFromAudio(buffer, sampleRate) {
  // Compute RMS — bail on silence.
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return null;

  const minLag = Math.floor(sampleRate / 2600); // ~2 600 Hz upper limit
  const maxLag = Math.min(
    Math.floor(sampleRate / 200),
    Math.floor(buffer.length / 2),
  );

  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const len = buffer.length - lag;
    for (let i = 0; i < len; i++) corr += buffer[i] * buffer[i + lag];
    corr /= len;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Reject weak correlations (noise floor ~ rms²).
  if (bestCorr < 0.05 * rms * rms) return null;

  const freq = sampleRate / bestLag;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return midi >= 0 && midi <= 127 ? midi : null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePlayMode — play along mode driven by MIDI controller or microphone.
 *
 * Core idea (input-queue):
 *   Every time the user plays a note (MIDI note-on or mic onset) we push
 *   { midi, beat } onto inputQueueRef.  Each entry can satisfy exactly ONE
 *   note event in the song.  When the song reaches a note's check window
 *   (note.time + GRACE_BEATS) we search the queue for a matching entry and
 *   splice it out (consumed).  If nothing matches, we pause and wait.
 *
 * Why this fixes same-note repetitions:
 *   C4 → C4 in the score needs two separate C4 presses.  After the first
 *   press is consumed for note[0] it is gone from the queue, so note[1]
 *   cannot reuse it — the user must press C4 again.  Works for any sequence
 *   (C4 D4 C4, C4 C4 C4, …) without special-casing.
 *
 * Early playing:
 *   A note played up to ACCEPT_EARLY_BEATS before its score position is kept
 *   in the queue and matched when the check window arrives.
 */
export default function usePlayMode({
  song,
  transpose,
  currentBeatRef, // MutableRefObject<number> — always-fresh, avoids stale closures
  isPlaying,
  startPlayback,
  handleScrub,
  setPauseGate,
}) {
  // ── Device state ──────────────────────────────────────────────────────────
  const [micStatus, setMicStatus] = useState(null); // null | 'requesting' | 'granted' | 'denied'
  const [micName, setMicName] = useState(null);
  const micStreamRef = useRef(null);
  const micContextRef = useRef(null);

  const [midiStatus, setMidiStatus] = useState(null);
  const [midiInputs, setMidiInputs] = useState([]);
  const [selectedMidiInput, setSelectedMidiInput] = useState(null);
  const midiAccessRef = useRef(null);

  // ── Play-mode UI state ────────────────────────────────────────────────────
  const [playModeEnabled, setPlayModeEnabled] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showSelectDevice, setShowSelectDevice] = useState(false);

  // Stable ref so callbacks that live outside React renders can read isWaiting.
  const isWaitingRef = useRef(false);
  useEffect(() => {
    isWaitingRef.current = isWaiting;
  }, [isWaiting]);

  // ── Beat-tracking refs ────────────────────────────────────────────────────
  const nextNoteIdxRef = useRef(0); // index into noteEvents of the next note to check
  const waitTargetRef = useRef(null); // the note event we are currently waiting on

  // Queue of user inputs.  Each entry { midi, beat } is consumed by at most
  // one note event — this is the key to correct same-note repetition handling.
  const inputQueueRef = useRef([]);

  // ── Computed note events (sorted) ─────────────────────────────────────────
  const noteEvents = useMemo(() => {
    if (!song?.tracks?.[0]) return [];
    return (song.tracks[0].actions ?? [])
      .filter((a) => a.type === "note")
      .map((a) => {
        const raw = getHighestNote(a.pitches ?? a.pitch);
        if (!raw) return null;
        const name = transposeNote(raw, transpose ?? 0);
        const midi = noteNameToMidi(name);
        if (midi === null) return null;
        return { time: a.time ?? 0, note: name, midi };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  }, [song, transpose]);

  // Stable ref so gate callbacks (which live outside React renders) can
  // access the current noteEvents without capturing a stale closure.
  const noteEventsRef = useRef(noteEvents);
  useEffect(() => {
    noteEventsRef.current = noteEvents;
  }, [noteEvents]);

  // ── Tracking reset ────────────────────────────────────────────────────────
  // Stable ref so onNoteInput can call handleScrub without a stale closure.
  const handleScrubRef = useRef(handleScrub);
  useEffect(() => {
    handleScrubRef.current = handleScrub;
  }, [handleScrub]);

  const resetTracking = useCallback(() => {
    nextNoteIdxRef.current = 0;
    waitTargetRef.current = null;
    inputQueueRef.current = [];
    isWaitingRef.current = false;
    setPauseGate?.(null);
    queueMicrotask(() => setIsWaiting(false));
  }, [setPauseGate]);

  // Reset whenever the song or transpose changes.
  useEffect(() => {
    resetTracking();
  }, [noteEvents, resetTracking]);

  // Reset when play mode is turned off.
  useEffect(() => {
    if (!playModeEnabled) resetTracking();
  }, [playModeEnabled, resetTracking]);

  // ── onNoteInput ───────────────────────────────────────────────────────────
  // Entry point for both MIDI note-on and confirmed mic onsets.
  const onNoteInputRef = useRef(null);

  const onNoteInput = useCallback(
    (midi) => {
      if (!playModeEnabled) return;

      // While waiting the user must replay the exact missed note.
      if (isWaitingRef.current) {
        if (waitTargetRef.current?.midi === midi) {
          // Synchronously clear waiting state so a rapid second event can't re-fire.
          isWaitingRef.current = false;
          // Scrub 1ms past the exact note beat.  The gate already prevented
          // the piano from pre-firing; resuming from e.time+0.001 lets the
          // piano's scheduled note (at e.time + pianoDelayBeats) play naturally
          // on resume — correct musical behaviour.
          const resumeBeat = (waitTargetRef.current?.time ?? 0) + 0.001;
          waitTargetRef.current = null;
          nextNoteIdxRef.current += 1;
          setIsWaiting(false);
          handleScrubRef.current?.(resumeBeat);
          startPlayback();
        }
        // Wrong note while waiting — ignore.
        return;
      }

      // Normal play: enqueue the onset.  The gate callback will
      // match and consume it when the note's check window arrives.
      const beat = currentBeatRef?.current ?? 0;
      inputQueueRef.current.push({ midi, beat });
    },
    [playModeEnabled, startPlayback, currentBeatRef],
  );

  useEffect(() => {
    onNoteInputRef.current = onNoteInput;
  }, [onNoteInput]);

  // ── Gate setup ────────────────────────────────────────────────────────────
  // setNextGateImplRef.current() installs a pauseGate in usePlayer for the
  // next required note.  Stored as a ref so it can recursively reference itself
  // without stale closure issues.
  const setNextGateImplRef = useRef(null);
  useEffect(() => {
    setNextGateImplRef.current = () => {
      if (!setPauseGate) return;
      const events = noteEventsRef.current;
      const idx = nextNoteIdxRef.current;
      if (idx >= events.length) {
        setPauseGate(null); // no more notes to gate
        return;
      }
      const e = events[idx];
      setPauseGate({
        atBeat: e.time,
        onGate: () => {
          // Check whether the user has played this note.
          const qIdx = inputQueueRef.current.findIndex(
            (inp) =>
              inp.midi === e.midi && inp.beat >= e.time - ACCEPT_EARLY_BEATS,
          );
          if (qIdx !== -1) {
            // Accepted — consume the input and advance to the next note.
            inputQueueRef.current.splice(qIdx, 1);
            nextNoteIdxRef.current += 1;
            setNextGateImplRef.current?.(); // install gate for the next note
            return false; // don't pause
          }
          // Missed — pause BEFORE any notes fire at this beat.
          waitTargetRef.current = e;
          isWaitingRef.current = true;
          queueMicrotask(() => {
            handleScrubRef.current?.(e.time);
            setIsWaiting(true);
          });
          return true; // pause
        },
      });
    };
  }, [setPauseGate]);

  // ── Gate activation ───────────────────────────────────────────────────────
  // When play starts in play-mode, reposition nextNoteIdx to the current beat
  // and install a gate for the next required note so the RAF tick pauses
  // BEFORE firing any accompaniment note at that beat.
  useEffect(() => {
    if (playModeEnabled && isPlaying && !isWaiting) {
      // Reposition nextNoteIdx to match the current playback cursor.
      const beat = currentBeatRef?.current ?? 0;
      const events = noteEventsRef.current;
      const idx = events.findIndex((e) => e.time >= beat);
      nextNoteIdxRef.current = idx === -1 ? events.length : Math.max(0, idx);
      inputQueueRef.current = [];
      setNextGateImplRef.current?.();
    } else if (!isPlaying) {
      setPauseGate?.(null);
    }
  }, [isPlaying, playModeEnabled, isWaiting, setPauseGate, currentBeatRef]);

  // ── cancelWait ────────────────────────────────────────────────────────────
  // Advances past the missed note so pressing Play after cancelling doesn't
  // immediately re-trigger the same wait.
  const cancelWait = useCallback(() => {
    isWaitingRef.current = false;
    const e = waitTargetRef.current;
    waitTargetRef.current = null;
    setPauseGate?.(null);
    // Scrub 1ms past the missed note so that when play resumes the gate-
    // activation effect repositions nextNoteIdx to the note AFTER this one.
    if (e !== null) {
      handleScrubRef.current?.(e.time + 0.001);
    }
    setIsWaiting(false);
  }, [setPauseGate]);

  // ── Microphone pitch detection ─────────────────────────────────────────────
  const startMicPitchDetection = useCallback((stream) => {
    if (micContextRef.current) {
      micContextRef.current.close().catch(() => {});
    }

    const context = new AudioContext();
    micContextRef.current = context;

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);

    // Two-state onset detector:
    //   lastConfirmed — the last MIDI note we fired onNoteInput for, or null.
    //
    // A new onset fires only when the confirmed note DIFFERS from lastConfirmed.
    // After silence, lastConfirmed resets to null, so the user CAN play the
    // same note again — they just have to release it first (go through silence).
    // This is what separates repeated notes: C4 → silence → C4 fires twice.
    let lastConfirmed = null;
    let pendingMidi = null;
    let pendingCount = 0;
    const STABLE_FRAMES = 2; // consecutive matching frames before confirming

    const tick = () => {
      if (!micContextRef.current || micContextRef.current.state === "closed")
        return;

      analyser.getFloatTimeDomainData(buffer);
      const detected = detectMidiFromAudio(buffer, context.sampleRate);

      if (detected === null) {
        // Silence — reset pending and clear lastConfirmed so same note can retrigger.
        pendingMidi = null;
        pendingCount = 0;
        lastConfirmed = null;
      } else if (detected !== pendingMidi) {
        // New candidate — start accumulating stability frames.
        pendingMidi = detected;
        pendingCount = 1;
      } else {
        pendingCount++;
        if (pendingCount === STABLE_FRAMES && detected !== lastConfirmed) {
          // Stable new note confirmed.
          lastConfirmed = detected;
          onNoteInputRef.current?.(detected);
        }
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, []); // only uses refs — stable forever

  // ── stopMicrophone ────────────────────────────────────────────────────────
  const stopMicrophone = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micContextRef.current?.close().catch(() => {});
    micContextRef.current = null;
    setMicStatus(null);
    setMicName(null);
  }, []);

  // ── requestMicrophone ─────────────────────────────────────────────────────
  const requestMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("denied");
      return;
    }

    setMicStatus("requesting");

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
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
      // Mutual exclusion: deselect any active MIDI input when mic is activated.
      setSelectedMidiInput(null);
      startMicPitchDetection(stream);
    } catch {
      setMicStatus("denied");
    }
  }, [startMicPitchDetection]);

  // ── selectMidiInput ───────────────────────────────────────────────────────
  // Wrapper around setSelectedMidiInput that enforces mic/MIDI mutual exclusion.
  const selectMidiInput = useCallback((input) => {
    if (input !== null) {
      // Mutual exclusion: stop mic when a MIDI input is activated.
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      micContextRef.current?.close().catch(() => {});
      micContextRef.current = null;
      setMicStatus(null);
      setMicName(null);
    }
    setSelectedMidiInput(input);
  }, []);

  // ── requestMidi ───────────────────────────────────────────────────────────
  const requestMidi = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus("denied");
      return;
    }

    setMidiStatus("requesting");

    try {
      const access = await navigator.requestMIDIAccess();
      midiAccessRef.current = access;
      setMidiStatus("granted");
      const updateInputs = () =>
        setMidiInputs(Array.from(access.inputs.values()));
      updateInputs();
      access.onstatechange = updateInputs;
    } catch {
      setMidiStatus("denied");
    }
  }, []);

  // Wire selected MIDI input → onNoteInput.
  useEffect(() => {
    if (!selectedMidiInput) return;

    const handler = (msg) => {
      const [status, note, velocity] = msg.data;
      // note-on with non-zero velocity
      if ((status & 0xf0) === 0x90 && velocity > 0) {
        onNoteInputRef.current?.(note);
      }
    };

    selectedMidiInput.addEventListener("midimessage", handler);
    return () => selectedMidiInput.removeEventListener("midimessage", handler);
  }, [selectedMidiInput]);

  // Auto-deselect a MIDI input that has disappeared from the device list.
  useEffect(() => {
    if (
      selectedMidiInput &&
      !midiInputs.find((i) => i.id === selectedMidiInput.id)
    ) {
      queueMicrotask(() => setSelectedMidiInput(null));
    }
  }, [midiInputs, selectedMidiInput]);

  // Auto-disable play mode when no input device is active.
  useEffect(() => {
    if (
      micStatus !== "granted" &&
      selectedMidiInput === null &&
      playModeEnabled
    ) {
      setPlayModeEnabled(false);
    }
  }, [micStatus, selectedMidiInput, playModeEnabled]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micContextRef.current?.close().catch(() => {});
      if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
    };
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const canEnablePlayMode =
    micStatus === "granted" || selectedMidiInput !== null;

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    // Microphone
    micStatus,
    micName,
    requestMicrophone,
    stopMicrophone,

    // MIDI
    midiStatus,
    midiInputs,
    selectedMidiInput,
    selectMidiInput,
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

    // Exposed for external wiring / testing
    onNoteInput,
  };
}
