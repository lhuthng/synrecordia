import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { PIANO_DELAY_MS, FADE_MS } from "../libs/pixi/constants.js";
import { transposeNotes } from "../libs/utils.js";

/* Utility: compute end beat for a song */
const computeSongEndBeat = (songData) => {
  if (!songData || !Array.isArray(songData.tracks)) {
    return 0;
  }

  return songData.tracks.reduce((maxEnd, track) => {
    const actions = Array.isArray(track.actions) ? track.actions : [];
    return actions.reduce((trackMax, action) => {
      if (action.type !== "note") return trackMax;
      const end = (action.time ?? 0) + (action.duration ?? 0);
      return Math.max(trackMax, end);
    }, maxEnd);
  }, 0);
};

/* Utility: compute an ideal note width from song BPM and average note duration in track 0.
   Formula: 80 / (avgDurationBeats * sqrt(bpm / 120)), clamped to [40, 400].
   Lower BPM and shorter notes both push noteWidth higher. */
const computeIdealNoteWidth = (song) => {
  if (!song) return 100;

  const bpm = song.bpm ?? 120;
  const track0 = Array.isArray(song.tracks) ? song.tracks[0] : null;
  const notes = track0?.actions?.filter((a) => a.type === "note") ?? [];

  if (notes.length === 0) return 100;

  const avgDuration =
    notes.reduce((sum, a) => sum + (a.duration ?? 0), 0) / notes.length;

  if (avgDuration <= 0) return 100;

  const bpmFactor = Math.sqrt(bpm / 120);
  const raw = 80 / (avgDuration * bpmFactor);
  return Math.round(Math.max(40, Math.min(400, raw)));
};

/* Hook */
export default function usePlayer() {
  const [song, setSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [bpm, setBpm] = useState(() => song?.bpm ?? 120);
  const [noteWidth, setNoteWidth] = useState(100);
  const [idealNoteWidth, setIdealNoteWidth] = useState(100);
  const [latencyMs, setLatencyMs] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [isAudioReady, setIsAudioReady] = useState([]);
  const [fingeringSystem, setFingeringSystem] = useState("german");
  const [recorderType, setRecorderType] = useState("tenor");
  const [transposeSemitones, setTransposeSemitones] = useState(0);
  const [pendingHint, setPendingHint] = useState(null);

  const durationBeats = computeSongEndBeat(song);

  // mutable refs for playback machinery
  const samplersRef = useRef({});
  // Set of track indices whose scheduled audio should be silenced at runtime.
  // Checked every tick so it works even after startPlayback has already
  // captured state.synth by value.
  const suppressAudioRef = useRef(new Set());
  const pauseGateRef = useRef(null); // { atBeat: number, onGate: (beat: number) => boolean } | null
  const rafIdRef = useRef(null);
  const startToneTimeRef = useRef(0);
  const startBeatRef = useRef(0);
  const cursorBeatsRef = useRef(0);
  const trackStatesRef = useRef([]);
  const endBeatRef = useRef(0);
  const bpmRef = useRef(bpm);
  const repeatRef = useRef(repeat);
  const transposeSemitonesRef = useRef(0);
  const latencyMsRef = useRef(latencyMs);
  const noteTriggerListenerRef = useRef(null);
  // Points to the wallTimeToBeat closure set by the running startPlayback so
  // handleBpmChange can compute the correct beat across tempo sections.
  const wallTimeToBeatRef = useRef(null);

  // External instrument overrides — set from Player.jsx when track 0 is swapped.
  // Used by startPlayback to correctly determine monophonic vs polyphonic behaviour.
  const instrumentOverridesRef = useRef({});

  // Keep bpmRef up-to-date for the running tick
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  // Keep repeatRef up-to-date for the running tick
  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  // Keep transposeSemitonesRef up-to-date for the running tick
  useEffect(() => {
    transposeSemitonesRef.current = transposeSemitones;
  }, [transposeSemitones]);

  useEffect(() => {
    latencyMsRef.current = latencyMs;
  }, [latencyMs]);

  // Keep currentBeat and target refs in sync when external changes happen
  useEffect(() => {
    cursorBeatsRef.current = currentBeat;
  }, [currentBeat]);

  // Visibility handling: pause when tab hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pausePlayback();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // postMessage bridge — lets a parent page pause playback when this app is
  // embedded in an iframe (e.g. via IntersectionObserver on the iframe element).
  //
  // Parent-page usage:
  //
  //   const observer = new IntersectionObserver(([entry]) => {
  //     if (!entry.isIntersecting)
  //       iframe.contentWindow.postMessage({ type: "synrecordia:pause" }, "*");
  //   }, { threshold: 0.1 });
  //   observer.observe(iframeElement);
  //
  // "pause" is intentionally the only supported command — starting playback
  // from a parent page without a user gesture would be blocked by browsers.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type === "synrecordia:pause") {
        pausePlayback();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // pausePlayback is stable (no deps in its useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registerSampler = useCallback((slot, sampler) => {
    samplersRef.current[slot] = sampler;
  }, []);

  const deregisterSampler = useCallback((slot, onCallback) => {
    delete samplersRef.current[slot];
    if (typeof onCallback === "function") onCallback();
  }, []);

  const setPauseGate = useCallback((gate) => {
    pauseGateRef.current = gate;
  }, []);

  const pausePlayback = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pauseGateRef.current = null;
    setIsPlaying(false);
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    cursorBeatsRef.current = 0;
    setCurrentBeat(0);
    pauseGateRef.current = null;
    setIsPlaying(false);
  }, []);

  const playNote = useCallback(async (noteName, durationBeats = 0.25) => {
    try {
      await Tone.start();
    } catch {
      // if starting fails, just return
      return;
    }
    const sampler = samplersRef.current[0];
    if (!sampler?.loaded) return;
    const secondsPerBeat = 60 / (bpmRef.current || 120);
    const durationSeconds = Math.max(durationBeats * secondsPerBeat, 0.05);
    sampler.triggerAttackRelease(noteName, durationSeconds, Tone.now());
  }, []);

  const startPlayback = useCallback(async () => {
    if (!song) return;

    await Tone.start();

    const getSecondsPerBeat = () => 60 / (bpmRef.current || 120);

    const startBeat = Math.max(0, cursorBeatsRef.current);
    const tracks = Array.isArray(song.tracks) ? song.tracks : [];

    // ── Tempo-change helpers ──────────────────────────────────────────────────
    // bpms is the array of { beat, bpm } entries from the song JSON.
    // When absent or single-entry the helpers fall back to the flat-BPM formula.
    const bpms =
      Array.isArray(song.bpms) && song.bpms.length > 1 ? song.bpms : null;
    const baseBpm = bpms?.[0]?.bpm ?? (bpmRef.current || 120);

    // Convert elapsed wall-clock seconds (since the last startBeat anchor) into
    // the corresponding MIDI beat, honouring each section's scaled BPM.
    const wallTimeToBeat = (elapsed) => {
      if (!bpms) {
        return startBeatRef.current + elapsed * ((bpmRef.current || 120) / 60);
      }
      const scale = (bpmRef.current || 120) / baseBpm;
      let remaining = elapsed;
      let currentBeat = startBeatRef.current;

      // Find the BPM segment that contains startBeatRef.current
      let segIdx = 0;
      for (let i = bpms.length - 1; i >= 0; i--) {
        if (startBeatRef.current >= bpms[i].beat) {
          segIdx = i;
          break;
        }
      }

      while (remaining > 1e-9) {
        const effectiveBpm = bpms[segIdx].bpm * scale;
        const spb = 60 / effectiveBpm;
        const nextBeat =
          segIdx + 1 < bpms.length ? bpms[segIdx + 1].beat : Infinity;
        const beatsToNext = nextBeat - currentBeat;
        const secsToNext = beatsToNext * spb;

        if (!isFinite(secsToNext) || remaining <= secsToNext) {
          currentBeat += remaining / spb;
          remaining = 0;
        } else {
          remaining -= secsToNext;
          currentBeat = nextBeat;
          if (segIdx + 1 < bpms.length) {
            segIdx++;
          } else {
            currentBeat += remaining / spb;
            remaining = 0;
          }
        }
      }
      return currentBeat;
    };

    // Convert a range [beatStart, beatEnd) in MIDI beats to wall-clock seconds,
    // honouring each section's scaled BPM.
    const beatRangeToSeconds = (beatStart, beatEnd) => {
      if (!bpms) {
        return (beatEnd - beatStart) * (60 / (bpmRef.current || 120));
      }
      const scale = (bpmRef.current || 120) / baseBpm;
      let totalSecs = 0;
      let currentBeat = beatStart;

      let segIdx = 0;
      for (let i = bpms.length - 1; i >= 0; i--) {
        if (beatStart >= bpms[i].beat) {
          segIdx = i;
          break;
        }
      }

      while (currentBeat < beatEnd - 1e-9) {
        const effectiveBpm = bpms[segIdx].bpm * scale;
        const spb = 60 / effectiveBpm;
        const nextBeat =
          segIdx + 1 < bpms.length ? bpms[segIdx + 1].beat : Infinity;
        const segEnd = Math.min(nextBeat, beatEnd);
        totalSecs += (segEnd - currentBeat) * spb;
        currentBeat = segEnd;
        if (currentBeat < beatEnd - 1e-9 && segIdx + 1 < bpms.length) {
          segIdx++;
        }
      }
      return totalSecs;
    };

    // Expose wallTimeToBeat so handleBpmChange can use it while playing.
    wallTimeToBeatRef.current = wallTimeToBeat;

    const trackDelayMsArray = tracks.map((track) =>
      track.instrument === "piano" ? PIANO_DELAY_MS : 0,
    );
    const maxTrackDelayMs = Math.max(0, ...trackDelayMsArray);

    // For negative latency: audio starts early (pre-roll) so the visual can
    // show notes approaching the bar before audio plays them.
    const latencyBeats = latencyMsRef.current / 1000 / getSecondsPerBeat();

    const trackStates = tracks.map((track, index) => {
      const synth = samplersRef.current[index];
      const trackDelayMs = trackDelayMsArray[index];
      const delayBeats = trackDelayMs / 1000 / getSecondsPerBeat();

      const actions = (Array.isArray(track.actions) ? track.actions : [])
        .filter((action) => action.type === "note")
        .map((action) => ({
          time: (action.time ?? 0) + delayBeats,
          duration: action.duration ?? 0,
          notes: (() => {
            // Monophonic instruments (recorder family) take a single pitch.
            // Every other instrument (guitar, piano, …) plays all pitches.
            const effectiveInstrument =
              instrumentOverridesRef.current[index] ?? track.instrument;
            const isMonophonic =
              effectiveInstrument === "recorder" ||
              effectiveInstrument === "brecorder";
            if (isMonophonic) {
              return Array.isArray(action.pitches)
                ? action.pitches[0]
                : (action.pitch ?? action.pitches);
            }
            return Array.isArray(action.pitches)
              ? action.pitches
              : (action.pitches ?? action.pitch);
          })(),
          velocity: Math.min(Math.max((action.velocity ?? 80) / 100, 0), 1),
        }))
        .filter((action) => action.notes)
        .sort((a, b) => a.time - b.time);

      // binary search start index
      let idx = 0;
      let low = 0;
      let high = actions.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (actions[mid].time < startBeat) low = mid + 1;
        else high = mid;
      }
      idx = low;

      return {
        synth,
        actions,
        index: idx,
        notifyDelayMs: maxTrackDelayMs - trackDelayMs,
      };
    });

    const maxEndBeat = trackStates.reduce((max, state) => {
      const last = state.actions[state.actions.length - 1];
      if (!last) return max;
      return Math.max(max, last.time + (last.duration ?? 0));
    }, 0);

    trackStatesRef.current = trackStates;
    endBeatRef.current = maxEndBeat;
    const clampedStartBeat = Math.min(startBeat, maxEndBeat);
    // Negative latency: shift the audio start earlier so the visual (which
    // leads by |latencyMs|) begins exactly at the cursor position. The beat
    // count will be negative during the pre-roll; notes only fire at beat ≥ 0.
    const audioStartBeat =
      latencyMsRef.current < 0
        ? clampedStartBeat + latencyBeats // latencyBeats is negative here
        : clampedStartBeat;
    cursorBeatsRef.current = audioStartBeat;
    startToneTimeRef.current = Tone.now();
    startBeatRef.current = audioStartBeat;
    setIsPlaying(true);

    let frameCount = 0;
    const tick = () => {
      const beat = wallTimeToBeat(Tone.now() - startToneTimeRef.current);
      cursorBeatsRef.current = beat;
      // Throttle React state updates to ~30 fps; the PixiJS ticker
      // projects ahead with elapsed-time interpolation so visuals stay smooth.
      if (++frameCount % 2 === 0) {
        setCurrentBeat(beat);
      }

      // ── Play-mode gate: pause BEFORE firing notes at this beat ───────────
      // Checked every tick so play-mode can halt the scheduler before any
      // accompaniment note fires at a beat that requires user input.
      if (
        pauseGateRef.current !== null &&
        beat >= pauseGateRef.current.atBeat
      ) {
        const gate = pauseGateRef.current;
        pauseGateRef.current = null; // clear first so onGate can install a new gate
        if (gate.onGate(beat)) {
          // onGate says "pause" — stop the RAF without firing any notes
          if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          setIsPlaying(false);
          return;
        }
        // onGate returned false → user already played; continue tick normally
      }

      // advance each track state
      const triggerGroups = new Map(); // notifyDelayMs -> trackIndex[]
      trackStatesRef.current.forEach((state, trackIndex) => {
        let anyTriggered = false;
        while (
          state.index < state.actions.length &&
          state.actions[state.index].time <= beat
        ) {
          const action = state.actions[state.index];
          const durationSeconds = beatRangeToSeconds(
            action.time,
            action.time + action.duration,
          );
          const startTime = Tone.now();

          if (
            durationSeconds > 0 &&
            state.synth &&
            state.synth.loaded !== false &&
            !suppressAudioRef.current.has(trackIndex)
          ) {
            try {
              state.synth.triggerAttackRelease(
                transposeNotes(action.notes, transposeSemitonesRef.current),
                durationSeconds,
                startTime,
                action.velocity,
              );
            } catch {
              // ignore synth errors to avoid stopping the whole loop
            }
          }
          anyTriggered = true;
          state.index += 1;
        }
        if (anyTriggered) {
          const delay = state.notifyDelayMs ?? 0;
          const group = triggerGroups.get(delay) ?? [];
          group.push(trackIndex);
          triggerGroups.set(delay, group);
        }
      });
      triggerGroups.forEach((tracks, delayMs) => {
        if (delayMs === 0) {
          noteTriggerListenerRef.current?.(tracks);
        } else {
          setTimeout(() => noteTriggerListenerRef.current?.(tracks), delayMs);
        }
      });

      // handle loop / end
      const loopThreshold = 0.02;
      if (beat >= endBeatRef.current - loopThreshold) {
        if (repeatRef.current) {
          const overshoot = Math.max(0, beat - endBeatRef.current);

          startToneTimeRef.current = Tone.now();
          // Re-apply the negative-latency pre-roll on each loop so the visual
          // always restarts at beat 0 while the audio pre-rolls as needed.
          const repeatLatencyBeats =
            latencyMsRef.current < 0
              ? latencyMsRef.current /
                1000 /
                (60 /
                  (bpms
                    ? bpms[0].bpm * ((bpmRef.current || 120) / baseBpm)
                    : bpmRef.current || 120))
              : 0;
          startBeatRef.current = overshoot + repeatLatencyBeats;

          trackStatesRef.current.forEach((state) => {
            state.index = 0;
          });

          cursorBeatsRef.current = startBeatRef.current;
          setCurrentBeat(cursorBeatsRef.current);
        } else {
          pausePlayback();
          return;
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    // prime RAF loop
    rafIdRef.current = requestAnimationFrame(tick);
  }, [song, pausePlayback]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) pausePlayback();
    else startPlayback();
  }, [isPlaying, pausePlayback, startPlayback]);

  const handleNoteClick = useCallback(
    ({ note, duration }) => {
      playNote(note, duration);
    },
    [playNote],
  );

  const handleScrubStart = useCallback(() => {
    pausePlayback();
  }, [pausePlayback]);

  const handleScrub = useCallback(
    (beat) => {
      const clamped = Math.max(0, Math.min(durationBeats, beat));
      cursorBeatsRef.current = clamped;
      setCurrentBeat(clamped);
    },
    [durationBeats],
  );

  const handleRestart = useCallback(() => {
    stopPlayback();
  }, [stopPlayback]);

  const handleBpmChange = useCallback(
    (value) => {
      const next = Math.max(30, Math.min(240, Number(value) || 0));

      if (isPlaying) {
        const now = Tone.now();
        // Use the BPM-section-aware helper if available (song with tempo changes),
        // otherwise fall back to the simple single-BPM formula.
        const elapsed = now - startToneTimeRef.current;
        const currentBeat = wallTimeToBeatRef.current
          ? wallTimeToBeatRef.current(elapsed)
          : startBeatRef.current + elapsed / (60 / (bpmRef.current || 120));

        // Advance startBeat so perceived beat at `now` stays the same
        startBeatRef.current = currentBeat;
        startToneTimeRef.current = now;
      }

      setBpm(next);
      bpmRef.current = next;

      try {
        Tone.getTransport().bpm.value = next;
      } catch {
        // ignore if transport isn't used
      }
    },
    [isPlaying],
  );

  const resetTimeoutRef = useRef(null);
  const selectSong = useCallback(
    (newSong) => {
      setSong(newSong);
      setIsPlaying(false);
      setIsAudioReady(Array(newSong?.tracks?.length || 0).fill(false));
      setBpm(newSong?.bpm ?? 120);
      bpmRef.current = newSong?.bpm ?? 120;

      // Apply per-track-0 recorder type hint from song data
      const RECORDER_HINTS = ["soprano", "alto", "tenor", "bass"];
      const hint0 = newSong?.tracks?.[0]?.hint;
      if (hint0 && RECORDER_HINTS.includes(hint0)) {
        setRecorderType(hint0);
        setPendingHint(hint0);
      } else {
        setPendingHint(null);
      }

      clearTimeout(resetTimeoutRef.current);

      pausePlayback();

      resetTimeoutRef.current = setTimeout(() => {
        const computed = computeIdealNoteWidth(newSong);
        setNoteWidth(computed);
        setIdealNoteWidth(computed);
        stopPlayback();
        setCurrentBeat(0);
      }, FADE_MS); // delay reset until visualizer fade completes (FADE_MS)
    },
    [pausePlayback, stopPlayback],
  );

  const handleToggleChanged = useCallback(
    (slot, value) => {
      if (slot === selectedTrack) {
        if (!value) setSelectedTrack(null);
      } else if (value) {
        setSelectedTrack(slot);
      }
    },
    [selectedTrack],
  );

  const handleAudioReady = useCallback((slot, value) => {
    setIsAudioReady((prev) => {
      const next = [...prev];
      next[slot] = value;
      return next;
    });
  }, []);

  // cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Pre-warm the AudioContext on first user gesture so that the play button
  // response is immediate. Tone.start() is idempotent; calling it early on
  // touchstart/mousedown is safe and required by browsers to unlock audio.
  useEffect(() => {
    const unlock = () => {
      Tone.start().catch(() => {});
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("mousedown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    document.addEventListener("touchstart", unlock, true);
    document.addEventListener("mousedown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => {
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("mousedown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, []); // empty deps — register once on mount, self-removes after first gesture

  const isReady =
    /* Only track 0 needs to be ready before allowing playback.
       Tracks 1-N load in background; their notes are silently skipped until decoded. */
    isAudioReady.length > 0 && isAudioReady[0] === true;

  return {
    // state
    song,
    setSong,
    selectSong,

    isPlaying,
    currentBeat,
    bpm,
    noteWidth,
    idealNoteWidth,
    latencyMs,
    repeat,
    selectedTrack,
    fingeringSystem,
    recorderType,
    pendingHint,
    clearPendingHint: () => setPendingHint(null),

    // derived
    durationBeats,
    isAudioReady,
    isReady,

    // setters / handlers
    setNoteWidth: setNoteWidth,
    setLatencyMs,
    setRepeat: setRepeat,
    setNoteTriggerListener: (fn) => {
      noteTriggerListenerRef.current = fn;
    },
    transposeSemitones,
    setTransposeSemitones,
    setSelectedTrack: setSelectedTrack,
    setFingeringSystem: setFingeringSystem,
    setRecorderType: setRecorderType,
    handleBpmChange,
    handleNoteWidthChange: setNoteWidth,
    handlePlayPause,
    startPlayback,
    pausePlayback,
    stopPlayback,
    playNote,
    handleNoteClick,
    handleScrubStart,
    handleScrub,
    handleRestart,
    handleToggleChanged,

    // samplers
    registerSampler,
    deregisterSampler,
    handleAudioReady,

    // Suppress / restore scheduled audio for a track without restarting playback.
    suppressAudioTrack: (trackIndex, suppress) => {
      if (suppress) suppressAudioRef.current.add(trackIndex);
      else suppressAudioRef.current.delete(trackIndex);
    },
    setPauseGate,

    // low-level refs (if a consumer component needs them)
    _internal: {
      samplersRef,
      rafIdRef,
      startToneTimeRef,
      startBeatRef,
      cursorBeatsRef,
      trackStatesRef,
      endBeatRef,
      bpmRef,
      instrumentOverridesRef,
    },
  };
}
