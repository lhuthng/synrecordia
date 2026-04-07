import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  noteNameToMidi,
  transposeNote,
  midiToNoteName,
} from "../libs/utils.js";
import { getHighestNote } from "../components/utils/fingeringUtils.js";

// ─── Timing windows ───────────────────────────────────────────────────────────

/**
 * How many beats *before* a note's scheduled beat the user can play and still
 * get credit.  Large window so users who play slightly early are not penalised.
 */
const EARLY_BEATS = 1.0;

/**
 * How many beats *after* a note's scheduled beat before the gate fires and
 * checks whether the user played.
 *
 * Set to 0 so the gate fires at exactly the note's scheduled beat, BEFORE
 * the tick loop triggers any notes at that beat for any track (including
 * accompaniment).  This means other instruments are silent while waiting —
 * they only play once the user has already played (gate accepts) or after
 * the user plays in the paused-waiting state.
 *
 * Users who play early (within EARLY_BEATS) are accepted normally through
 * the gate.  Users who play right on the beat or slightly late are handled
 * by the isWaiting / onNoteInput waiting path.
 */
const GATE_DELAY_BEATS = 0;

// ─── Mic detector parameters ─────────────────────────────────────────────────

/** Minimum RMS amplitude to treat a frame as non-silent. */
const MIC_SILENCE_THRESHOLD = 0.01;

/**
 * Consecutive frames that must return the same MIDI note before the note is
 * confirmed.  2 frames (~33 ms at 60 fps) is enough to reject single-frame
 * noise spikes while keeping detection latency low.
 */
const MIC_STABLE_FRAMES = 2;

// ─── NSDF pitch detector (McLeod Pitch Method) ────────────────────────────────

/**
 * Estimates the MIDI pitch of the dominant fundamental in `buffer` using the
 * Normalized Square Difference Function (NSDF) from McLeod & Wyvill (2005).
 *
 * NSDF(τ) = 2·r(τ) / m'(τ)
 *   r(τ)  = Σ x[n]·x[n+τ]               (cross-correlation)
 *   m'(τ) = Σ x[n]² + Σ x[n+τ]²         (normalisation)
 *
 * The normalised value lies in [−1, 1]; a peak near +1 indicates a true
 * periodic lag.  We search for the global maximum above a threshold in the
 * lag range that corresponds to our target pitch range and refine the winning
 * lag with parabolic interpolation for sub-sample accuracy.
 *
 * @param {Float32Array} buffer  PCM audio samples (typically 2048)
 * @param {number}       sampleRate  Audio context sample rate (e.g. 44100)
 * @returns {number|null}  Integer MIDI note (36–108) or null on failure
 */
function detectPitch(buffer, sampleRate) {
  const N = buffer.length;

  // Lag range: corresponds to roughly 100 Hz – 2600 Hz
  const minLag = Math.floor(sampleRate / 2600);
  const maxLag = Math.min(Math.floor(sampleRate / 100), Math.floor(N / 2) - 1);

  // Quick energy check — bail on silence before doing any real work.
  let totalSq = 0;
  for (let i = 0; i < N; i++) totalSq += buffer[i] * buffer[i];
  if (totalSq < 1e-10) return null;

  // ── Compute NSDF incrementally ──────────────────────────────────────────
  // The normalisation denominator satisfies the recurrence:
  //   denom(0)   = 2 · totalSq
  //   denom(τ)   = denom(τ−1) − x[N−τ]² − x[τ−1]²
  // This avoids an extra O(N) pass per lag.
  const nsdf = new Float32Array(maxLag + 1);
  let denom = 2 * totalSq;

  for (let tau = 0; tau <= maxLag; tau++) {
    if (tau > 0) {
      denom -= buffer[N - tau] * buffer[N - tau];
      denom -= buffer[tau - 1] * buffer[tau - 1];
    }

    if (tau < minLag) continue; // update denom but skip NSDF computation

    let num = 0;
    const len = N - tau;
    for (let i = 0; i < len; i++) num += buffer[i] * buffer[i + tau];
    nsdf[tau] = denom > 1e-12 ? (2 * num) / denom : 0;
  }

  // ── Find first key maximum above threshold ───────────────────────────────
  // A periodic signal at frequency F has NSDF peaks at lags T, 2T, 3T, …
  // (all near 1.0 for a pure tone).  Taking the GLOBAL maximum is essentially
  // random between those peaks — which is why playing G5 sometimes returns G4
  // or G3.  The correct fix is to take the FIRST local maximum above a
  // threshold (smallest lag = highest frequency = the fundamental).
  //
  // Algorithm (McLeod & Wyvill, 2005):
  //   1. Compute the global max to establish a relative acceptance floor.
  //   2. Walk from minLag upward; the first local max that clears the floor
  //      is the fundamental period.
  //   3. Fall back to the global max lag if no clean local max is found
  //      (e.g. very flat peak on a pure sine).
  const NSDF_THRESHOLD = 0.8;

  // Pass 1 – global max (sets the relative cutoff).
  let globalMax = 0;
  let globalMaxLag = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (nsdf[tau] > globalMax) {
      globalMax = nsdf[tau];
      globalMaxLag = tau;
    }
  }

  if (globalMax < NSDF_THRESHOLD) return null;

  // Pass 2 – first local maximum above 85 % of the global peak.
  // 85 % is loose enough to find the fundamental even when the harmonic
  // series makes the first peak slightly lower than a sub-harmonic peak.
  const cutoff = 0.85 * globalMax;
  let bestLag = -1;
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    if (
      nsdf[tau] >= cutoff &&
      nsdf[tau] >= nsdf[tau - 1] &&
      nsdf[tau] >= nsdf[tau + 1]
    ) {
      bestLag = tau;
      break;
    }
  }

  // Fallback – no clean local max found; use the global max lag.
  if (bestLag === -1) bestLag = globalMaxLag;

  // ── Parabolic interpolation for sub-sample lag accuracy ─────────────────
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const alpha = nsdf[bestLag - 1];
    const beta = nsdf[bestLag];
    const gamma = nsdf[bestLag + 1];
    const d = alpha - 2 * beta + gamma;
    // d < 0 means a valid downward-opening parabola peak
    if (d < 0) refinedLag = bestLag - (0.5 * (gamma - alpha)) / d;
  }

  const freq = sampleRate / refinedLag;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return midi >= 36 && midi <= 108 ? midi : null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePlayMode — play-along mode driven by MIDI controller or microphone.
 *
 * ── Mic onset detection ──────────────────────────────────────────────────────
 * Rather than tracking pitch frame-by-frame with a "lastConfirmed" gate (which
 * requires complex external resets for consecutive identical notes), we use
 * *energy-rise onset detection*:
 *
 *   • A slow exponential moving average (EMA) tracks the background energy.
 *   • A fast EMA tracks the current frame energy.
 *   • An onset fires when fast/slow > ONSET_RISE_RATIO, the level is above
 *     the silence threshold, and a cooldown has elapsed since the last onset.
 *   • Because onset fires once per *attack*, holding a note never fires twice
 *     and replaying the same pitch always produces a fresh event.
 *   • No external reset flag is ever needed.
 *
 * After an onset, pitch detection is retried for up to MAX_DETECT_FRAMES
 * frames.  This handles the common case where the analyser buffer is only
 * partially filled with the new note at the moment the onset is declared.
 * The beat timestamp is captured at onset time so that timing-window checks
 * in the gate remain accurate regardless of how many frames it takes to
 * confirm the pitch.
 *
 * ── Input log with per-entry consumed flag ───────────────────────────────────
 * Every confirmed onset (mic or MIDI) appends { midi, beat, used } to
 * inputLogRef.  Entries are never spliced — the gate marks an entry `used`
 * when it is consumed.  This avoids the "double-accept" bug that arose from
 * modifying the array mid-iteration.
 *
 * ── Gate timing ──────────────────────────────────────────────────────────────
 * The gate fires at note.time + GATE_DELAY_BEATS.  It searches inputLog for a
 * matching, unused entry whose beat falls in
 *   [note.time − EARLY_BEATS, note.time + GATE_DELAY_BEATS].
 * If found → advance; if not → pause and wait for the user to play.
 *
 * ── Consecutive identical notes (e.g. C4 → C4 in Twinkle Twinkle) ───────────
 * Each note attack produces a separate log entry.  An entry can satisfy at
 * most one gate.  Holding C4 through two gates misses the second (no second
 * onset entry) → correct pause.  Re-attacking C4 after the pause produces a
 * new entry → resumes correctly.
 */
export default function usePlayMode({
  song,
  transpose,
  currentBeatRef, // MutableRefObject<number> — always-fresh playback cursor
  isPlaying,
  startPlayback,
  handleScrub,
  setPauseGate,
}) {
  // ── Device state ──────────────────────────────────────────────────────────
  const [micStatus, setMicStatus] = useState(null); // null|'requesting'|'granted'|'denied'
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

  /**
   * Last MIDI note confirmed by the mic (or MIDI controller).
   * Shown in the UI as a brief visual indicator; auto-cleared after 900 ms.
   */
  const [detectedNote, setDetectedNote] = useState(null); // { name, midi, ts }
  const detectedNoteTimerRef = useRef(null);

  // Stable ref mirror so gate callbacks (which live outside React renders) can
  // read `isWaiting` without capturing stale closure values.
  const isWaitingRef = useRef(false);
  useEffect(() => {
    isWaitingRef.current = isWaiting;
  }, [isWaiting]);

  // ── Tracking refs ─────────────────────────────────────────────────────────
  /** Index into noteEvents for the next note gate to install. */
  const nextNoteIdxRef = useRef(0);

  /** The note event we are currently paused on (null when not waiting). */
  const waitTargetRef = useRef(null);

  /**
   * Log of user onsets: { midi: number, beat: number, used: boolean }.
   * Appended on every confirmed onset; entries marked used by gates.
   * Pruned lazily to prevent unbounded growth.
   */
  const inputLogRef = useRef([]);

  // ── Computed note events ───────────────────────────────────────────────────
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

  const noteEventsRef = useRef(noteEvents);
  useEffect(() => {
    noteEventsRef.current = noteEvents;
  }, [noteEvents]);

  // ── Stable callback refs ───────────────────────────────────────────────────
  // These allow closures created once to call the latest version of a callback
  // without being recreated themselves (avoids cascading effect re-runs).
  const handleScrubRef = useRef(handleScrub);
  useEffect(() => {
    handleScrubRef.current = handleScrub;
  }, [handleScrub]);

  const onNoteInputRef = useRef(null);
  const installNextGateRef = useRef(null);

  // ── resetTracking ─────────────────────────────────────────────────────────
  const resetTracking = useCallback(() => {
    nextNoteIdxRef.current = 0;
    waitTargetRef.current = null;
    inputLogRef.current = [];
    isWaitingRef.current = false;
    setPauseGate?.(null);
    queueMicrotask(() => setIsWaiting(false));
  }, [setPauseGate]);

  // Reset whenever the song changes or play mode is disabled.
  useEffect(() => {
    resetTracking();
  }, [noteEvents, resetTracking]);
  useEffect(() => {
    if (!playModeEnabled) resetTracking();
  }, [playModeEnabled, resetTracking]);

  // ── onNoteInput ───────────────────────────────────────────────────────────
  /**
   * Entry point for every confirmed user onset (MIDI note-on or mic attack).
   *
   * @param {number}       midi         MIDI note number of the detected pitch.
   * @param {number|null}  beatOverride Optional beat timestamp captured at the
   *                                    moment of onset (mic path).  When null
   *                                    the current playback cursor is used.
   */
  const onNoteInput = useCallback(
    (midi, beatOverride = null) => {
      if (!playModeEnabled) return;

      // Flash the visual note indicator on every confirmed onset.
      setDetectedNote({ name: midiToNoteName(midi), midi, ts: Date.now() });
      clearTimeout(detectedNoteTimerRef.current);
      detectedNoteTimerRef.current = setTimeout(
        () => setDetectedNote(null),
        900,
      );

      // ── Waiting (paused) path ─────────────────────────────────────────────
      if (isWaitingRef.current) {
        const target = waitTargetRef.current;
        if (target && midi % 12 === target.midi % 12) {
          // Correct note played — resolve the block.
          // Clear state synchronously before any React updates so that a rapid
          // second event cannot re-enter the waiting path.
          isWaitingRef.current = false;
          waitTargetRef.current = null;
          inputLogRef.current = []; // discard stale entries accumulated during wait
          const resumeBeat = target.time + 0.001;
          nextNoteIdxRef.current += 1;
          setIsWaiting(false);
          handleScrubRef.current?.(resumeBeat);
          startPlayback();
        }
        // Wrong note while paused → ignore completely; do NOT log it.
        return;
      }

      // ── Normal (playing) path ─────────────────────────────────────────────
      const beat = beatOverride ?? currentBeatRef?.current ?? 0;
      inputLogRef.current.push({ midi, beat, used: false });

      // Prune entries that are too old to match any upcoming gate.
      const cutoff = beat - EARLY_BEATS - 0.5;
      inputLogRef.current = inputLogRef.current.filter((e) => e.beat >= cutoff);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playModeEnabled, startPlayback], // currentBeatRef is a stable ref object — omitted intentionally
  );

  useEffect(() => {
    onNoteInputRef.current = onNoteInput;
  }, [onNoteInput]);

  // ── installNextGate ────────────────────────────────────────────────────────
  /**
   * Installs a pauseGate in usePlayer for the next note that must be played.
   * The gate fires at note.time + GATE_DELAY_BEATS:
   *   • Match found  → mark entry used, advance index, install next gate.
   *   • No match     → pause playback and enter the waiting state.
   *
   * Stored as a ref so it can call itself recursively (next-gate chain)
   * without creating new closures on every render.
   */
  useEffect(() => {
    installNextGateRef.current = () => {
      if (!setPauseGate) return;

      const events = noteEventsRef.current;
      const idx = nextNoteIdxRef.current;

      if (idx >= events.length) {
        setPauseGate(null); // no more notes to gate — song can play to the end freely
        return;
      }

      const e = events[idx];

      setPauseGate({
        atBeat: e.time + GATE_DELAY_BEATS,
        onGate: () => {
          const log = inputLogRef.current;

          console.log(
            `[gate] beat=${e.time.toFixed(2)} expects ${e.note}(${e.midi}) | log:`,
            log.map(
              (x) =>
                `midi=${x.midi} beat=${x.beat.toFixed(2)}${x.used ? " used" : ""}`,
            ),
          );

          // Search for a matching, unconsumed onset within the accept window.
          // Pitch-class matching (% 12) tolerates octave errors from the mic
          // detector and handles soprano-vs-tenor octave differences.
          const matchIdx = log.findIndex(
            (entry) =>
              !entry.used &&
              entry.midi % 12 === e.midi % 12 &&
              entry.beat >= e.time - EARLY_BEATS &&
              entry.beat <= e.time + GATE_DELAY_BEATS,
          );

          if (matchIdx !== -1) {
            // Accepted — consume this entry and advance to the next note.
            log[matchIdx].used = true;
            nextNoteIdxRef.current += 1;
            installNextGateRef.current?.(); // chain: install gate for next note
            return false; // do NOT pause; let playback continue
          }

          // Missed — pause and wait for the user to play this note.
          waitTargetRef.current = e;
          isWaitingRef.current = true;
          queueMicrotask(() => {
            handleScrubRef.current?.(e.time);
            setIsWaiting(true);
          });
          return true; // pause playback
        },
      });
    };
  }, [setPauseGate]);

  // ── Gate activation ───────────────────────────────────────────────────────
  /**
   * When play starts in play-mode, reposition nextNoteIdx to the current
   * playback cursor and install the first gate.
   * When playback stops for any reason, clear the gate.
   */
  useEffect(() => {
    if (playModeEnabled && isPlaying && !isWaiting) {
      const beat = currentBeatRef?.current ?? 0;
      const events = noteEventsRef.current;
      const idx = events.findIndex((e) => e.time >= beat);
      nextNoteIdxRef.current = idx === -1 ? events.length : Math.max(0, idx);

      // Keep unused entries that are recent enough to match the upcoming gate;
      // discard already-consumed entries to prevent stale matches.
      inputLogRef.current = inputLogRef.current.filter((e) => !e.used);

      installNextGateRef.current?.();
    } else if (!isPlaying) {
      setPauseGate?.(null);
    }
  }, [isPlaying, playModeEnabled, isWaiting, setPauseGate, currentBeatRef]);

  // ── cancelWait ────────────────────────────────────────────────────────────
  /**
   * Called when the user presses "Skip" on the waiting overlay.
   * Skips past the missed note so the next press of Play advances correctly.
   */
  const cancelWait = useCallback(() => {
    isWaitingRef.current = false;
    const e = waitTargetRef.current;
    waitTargetRef.current = null;
    inputLogRef.current = [];
    setPauseGate?.(null);
    if (e !== null) {
      handleScrubRef.current?.(e.time + 0.001);
    }
    setIsWaiting(false);
  }, [setPauseGate]);

  // ── Microphone pitch detection ─────────────────────────────────────────────
  /**
   * Starts a continuous mic analysis loop using energy-rise onset detection
   * and NSDF pitch detection.
   *
   * Detection lifecycle per note:
   *   1. Monitor energyFast / energySlow ratio each frame.
   *   2. When ratio > ONSET_RISE_RATIO (and level > silence, cooldown elapsed):
   *      declare an onset, capture the current beat timestamp.
   *   3. Over the next MAX_DETECT_FRAMES frames, attempt detectPitch().
   *      On first success: fire onNoteInput(midi, onsetBeat).
   *   4. Once energyFast falls back below energySlow * 1.2, re-arm for the
   *      next attack.
   *
   * This approach requires zero external reset signals: holding a note never
   * fires twice (fast EMA catches up to slow EMA → no new onset), and
   * re-attacking the same pitch always fires a fresh onset event.
   */
  const startMicPitchDetection = useCallback((stream) => {
    // Clean up any previous context.
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

    // ── State machine ─────────────────────────────────────────────────────
    // 'idle'   — listening; looking for a stable pitch above the silence floor.
    // 'locked' — a note has just fired; same-pitch-class re-fire is blocked
    //            until silence, but a DIFFERENT pitch class can fire immediately
    //            once it is stable (allows smooth breath-blend between notes).
    //
    // Rules:
    //   • Silence always resets everything → 'idle'.
    //   • In 'idle': MIC_STABLE_FRAMES consecutive identical pitch-class frames
    //     → fire, enter 'locked'.
    //   • In 'locked':
    //       – Same pitch class as the locked note → ignore (no double-fire).
    //       – Different pitch class → run the same stability check; on confirm
    //         fire and update the locked pitch class (no silence gap needed).
    //       – Silence → back to 'idle' (same note can be re-attacked).
    let detectState = "idle"; // 'idle' | 'locked'
    let lockedPc = -1; // pitch class (midi % 12) of the currently-locked note
    let pendingMidi = null; // candidate MIDI being accumulated for stability
    let pendingCount = 0; // consecutive frames matching pendingMidi

    // Fire a confirmed MIDI note, update lock, reset pending state.
    const confirmNote = (midi) => {
      detectState = "locked";
      lockedPc = midi % 12;
      pendingMidi = null;
      pendingCount = 0;
      const beat = currentBeatRef?.current ?? 0;
      console.log("confirmed midi:", midi);
      onNoteInputRef.current?.(midi, beat);
    };

    // Run the stability accumulator for a detected MIDI value.
    // Uses exact MIDI comparison (not pitch-class) so that frames returning
    // G4 and G5 do NOT count toward each other — each must be individually
    // stable.  The improved NSDF now returns a consistent octave, so exact
    // comparison is reliable.
    // Returns true when a note was confirmed and fired.
    const accumulate = (midi) => {
      if (midi === pendingMidi) {
        pendingCount++;
        if (pendingCount >= MIC_STABLE_FRAMES) {
          confirmNote(midi);
          return true;
        }
      } else {
        pendingMidi = midi;
        pendingCount = 1;
      }
      return false;
    };

    // How many consecutive silent frames are required before the state resets.
    // Prevents a brief mid-breath RMS dip from unlocking and re-firing at a
    // different octave during a sustained note.
    const SILENCE_DEBOUNCE_FRAMES = 3;
    let silenceFrames = 0;

    const tick = () => {
      if (!micContextRef.current || micContextRef.current.state === "closed")
        return;

      analyser.getFloatTimeDomainData(buffer);

      // ── RMS energy ────────────────────────────────────────────────────────
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
      const rms = Math.sqrt(sumSq / buffer.length);
      const isSilent = rms < MIC_SILENCE_THRESHOLD;

      // ── Silence: debounced reset ──────────────────────────────────────────
      // Require SILENCE_DEBOUNCE_FRAMES consecutive silent frames before
      // resetting so that a brief mid-breath RMS dip does not unlock the
      // detector and allow the same note to re-fire at a wrong octave.
      if (isSilent) {
        silenceFrames++;
        if (silenceFrames >= SILENCE_DEBOUNCE_FRAMES) {
          detectState = "idle";
          lockedPc = -1;
          pendingMidi = null;
          pendingCount = 0;
          silenceFrames = 0;
        }
        requestAnimationFrame(tick);
        return;
      }
      silenceFrames = 0; // non-silent frame resets the silence counter

      // ── Detect pitch ──────────────────────────────────────────────────────
      const midi = detectPitch(buffer, context.sampleRate);
      if (midi === null) {
        // Ambiguous frame — don't reset pending, just wait.
        requestAnimationFrame(tick);
        return;
      }

      const detectedPc = midi % 12;

      if (detectState === "locked") {
        if (detectedPc === lockedPc) {
          // Same pitch class — still on the same note, nothing to do.
          pendingMidi = null;
          pendingCount = 0;
        } else {
          // Different pitch class — try to confirm a blend transition.
          accumulate(midi);
        }
      } else {
        // 'idle' — accumulate toward first confirmation.
        accumulate(midi);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // currentBeatRef is a stable ref object — safe to never recreate

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
      setSelectedMidiInput(null); // mutual exclusion: mic and MIDI are never both active
      startMicPitchDetection(stream);
    } catch {
      setMicStatus("denied");
    }
  }, [startMicPitchDetection]);

  // ── selectMidiInput ───────────────────────────────────────────────────────
  /** Selects a MIDI input and stops the mic (mutual exclusion). */
  const selectMidiInput = useCallback((input) => {
    if (input !== null) {
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

  // ── Wire MIDI input → onNoteInput ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedMidiInput) return;

    const handler = (msg) => {
      const [status, note, velocity] = msg.data;
      // note-on with non-zero velocity
      if ((status & 0xf0) === 0x90 && velocity > 0) {
        // MIDI has perfect timing; use current beat directly (no beat override needed).
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

    // Visual note-detection feedback
    detectedNote,
  };
}
