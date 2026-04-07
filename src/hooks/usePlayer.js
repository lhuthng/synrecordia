import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { PIANO_DELAY_MS, FADE_MS } from "../components/utils/constants.js";
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
    await Tone.loaded();

    const getSecondsPerBeat = () => 60 / (bpmRef.current || 120);

    const startBeat = Math.max(0, cursorBeatsRef.current);
    const tracks = Array.isArray(song.tracks) ? song.tracks : [];

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
          notes:
            index === 0
              ? // for first track take highest pitch name string (if multiple)
                Array.isArray(action.pitches)
                ? action.pitches[0]
                : (action.pitch ?? action.pitches)
              : Array.isArray(action.pitches)
                ? action.pitches
                : (action.pitches ?? action.pitch),
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

    const getSecondsPerBeatLocalized = () => 60 / (bpmRef.current || 120);

    const tick = () => {
      const secondsPerBeat = getSecondsPerBeatLocalized();
      const beat =
        startBeatRef.current +
        (Tone.now() - startToneTimeRef.current) / secondsPerBeat;
      cursorBeatsRef.current = beat;
      setCurrentBeat(beat);

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
          const durationSeconds = action.duration * secondsPerBeat;
          const startTime = Tone.now();

          if (
            durationSeconds > 0 &&
            state.synth &&
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
              ? latencyMsRef.current / 1000 / secondsPerBeat
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
        const secondsPerBeatOld = 60 / bpmRef.current;
        const beatsSinceLastChange =
          (now - startToneTimeRef.current) / secondsPerBeatOld;

        // Advance startBeat so perceived beat at `now` stays the same
        startBeatRef.current = startBeatRef.current + beatsSinceLastChange;
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

      const computed = computeIdealNoteWidth(newSong);
      setNoteWidth(computed);
      setIdealNoteWidth(computed);

      clearTimeout(resetTimeoutRef.current);

      pausePlayback();

      resetTimeoutRef.current = setTimeout(() => {
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

  const isReady =
    /* visual ready is owned by visualizer; hook can't know that.
       Expose audio readiness info consumers can combine with visual readiness. */
    isAudioReady.length > 0 && isAudioReady.every(Boolean);

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
    },
  };
}
