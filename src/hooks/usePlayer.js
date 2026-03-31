import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

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

/* Hook */
export default function usePlayer() {
  const [song, setSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [bpm, setBpm] = useState(() => song?.bpm ?? 120);
  const [noteWidth, setNoteWidth] = useState(70);
  const [repeat, setRepeat] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [isAudioReady, setIsAudioReady] = useState([]);
  const [fingeringSystem, setFingeringSystem] = useState("recorder");

  const durationBeats = computeSongEndBeat(song);

  // mutable refs for playback machinery
  const samplersRef = useRef({});
  const rafIdRef = useRef(null);
  const startToneTimeRef = useRef(0);
  const startBeatRef = useRef(0);
  const cursorBeatsRef = useRef(0);
  const trackStatesRef = useRef([]);
  const endBeatRef = useRef(0);
  const bpmRef = useRef(bpm);

  // Keep bpmRef up-to-date for the running tick
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

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

  const registerSampler = useCallback((slot, sampler) => {
    samplersRef.current[slot] = sampler;
  }, []);

  const deregisterSampler = useCallback((slot, onCallback) => {
    delete samplersRef.current[slot];
    if (typeof onCallback === "function") onCallback();
  }, []);

  const pausePlayback = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    cursorBeatsRef.current = 0;
    setCurrentBeat(0);
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

    const pianoDelaySeconds = 0.08;
    const getSecondsPerBeat = () => 60 / (bpmRef.current || 120);
    const pianoDelayBeats = pianoDelaySeconds / getSecondsPerBeat();

    const startBeat = Math.max(0, cursorBeatsRef.current);
    const tracks = Array.isArray(song.tracks) ? song.tracks : [];

    const trackStates = tracks.map((track, index) => {
      const synth = samplersRef.current[index];
      const delayBeats = track.instrument === "piano" ? pianoDelayBeats : 0;

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

      return { synth, actions, index: idx };
    });

    const maxEndBeat = trackStates.reduce((max, state) => {
      const last = state.actions[state.actions.length - 1];
      if (!last) return max;
      return Math.max(max, last.time + (last.duration ?? 0));
    }, 0);

    trackStatesRef.current = trackStates;
    endBeatRef.current = maxEndBeat;
    const clampedStartBeat = Math.min(startBeat, maxEndBeat);
    cursorBeatsRef.current = clampedStartBeat;
    startToneTimeRef.current = Tone.now();
    startBeatRef.current = clampedStartBeat;
    setIsPlaying(true);

    const getSecondsPerBeatLocalized = () => 60 / (bpmRef.current || 120);

    const tick = () => {
      const secondsPerBeat = getSecondsPerBeatLocalized();
      const beat =
        startBeatRef.current +
        (Tone.now() - startToneTimeRef.current) / secondsPerBeat;
      cursorBeatsRef.current = beat;
      setCurrentBeat(beat);

      // advance each track state
      trackStatesRef.current.forEach((state) => {
        while (
          state.index < state.actions.length &&
          state.actions[state.index].time <= beat
        ) {
          const action = state.actions[state.index];
          const durationSeconds = action.duration * secondsPerBeat;
          const startTime = Tone.now();

          if (durationSeconds > 0 && state.synth) {
            try {
              state.synth.triggerAttackRelease(
                action.notes,
                durationSeconds,
                startTime,
                action.velocity,
              );
            } catch {
              // ignore synth errors to avoid stopping the whole loop
            }
          }
          state.index += 1;
        }
      });

      // handle loop / end
      const loopThreshold = 0.02;
      if (beat >= endBeatRef.current - loopThreshold) {
        if (repeat) {
          const overshoot = Math.max(0, beat - endBeatRef.current);

          startToneTimeRef.current = Tone.now();
          startBeatRef.current = overshoot;

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
  }, [song, pausePlayback, repeat]);

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

      clearTimeout(resetTimeoutRef.current);

      pausePlayback();

      resetTimeoutRef.current = setTimeout(() => {
        stopPlayback();
        setCurrentBeat(0);
      }, 200); // keep a small fade timeout; visual component may coordinate with FADE_MS
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
    repeat,
    selectedTrack,
    fingeringSystem,

    // derived
    durationBeats,
    isAudioReady,
    isReady,

    // setters / handlers
    setNoteWidth: setNoteWidth,
    setRepeat: setRepeat,
    setSelectedTrack: setSelectedTrack,
    setFingeringSystem: setFingeringSystem,
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
