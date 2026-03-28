import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import Directory from "./Directory";
import Visualizer, { FADE_MS } from "./Visualizer";

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

export default function Player({ fluteDynamic, pianoVersion }) {
  const [song, setSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recorderReady, setRecorderReady] = useState(false);
  const [pianoReady, setPianoReady] = useState(false);
  const [bpm, setBpm] = useState(() => song?.bpm ?? 120);
  const [noteWidth, setNoteWidth] = useState(70);
  const [repeat, setRepeat] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [playBarPosition, setPlayBarPosition] = useState(0.95);

  const [fingeringSystem, setFingeringSystem] = useState("recorder");

  const durationBeats = computeSongEndBeat(song);
  const activeFluteDynamic = fluteDynamic ?? "mezzo-forte";
  const activePianoVersion = pianoVersion ?? "v8";
  const recorderSynthRef = useRef(null);
  const recorderFilterRef = useRef(null);
  const recorderVibratoRef = useRef(null);
  const recorderSamplerRef = useRef(null);
  const recorderSamplerGainRef = useRef(null);
  const recorderReverbRef = useRef(null);
  const pianoSamplerRef = useRef(null);
  const pianoSamplerGainRef = useRef(null);
  const pianoReverbRef = useRef(null);
  const pianoSynthRef = useRef(null);

  const rafIdRef = useRef(null);
  const startToneTimeRef = useRef(0);
  const startBeatRef = useRef(0);
  const cursorBeatsRef = useRef(0);
  const trackStatesRef = useRef([]);
  const endBeatRef = useRef(0);
  // bpmRef is a mutable ref that always holds the latest BPM value.
  // The playback `tick` closure (driven by requestAnimationFrame) reads
  // `bpmRef.current` so it always uses the up-to-date tempo even though
  // the closure itself was created earlier. This avoids stale-closure
  // problems where the tick would continue using the old `bpm` state
  // after a tempo change, which caused the displayed/played beat to jump.
  // We update `bpmRef.current` immediately when BPM changes so time->beat
  // conversions remain continuous.
  const bpmRef = useRef(bpm);

  const parseFluteSampleNote = (filename) => {
    const match = filename.match(/^flute_([A-G])(s?)(\d+)_/);
    if (!match) return null;
    const [, letter, sharp, octave] = match;
    return `${letter}${sharp ? "#" : ""}${octave}`;
  };

  const parsePianoSampleNote = (filename) => {
    const match = filename.match(/^([A-G])([s#]?)(\d+)v/);
    if (!match) return null;
    const [, letter, sharp, octave] = match;
    return `${letter}${sharp === "s" || sharp === "#" ? "#" : ""}${octave}`;
  };

  const noteNameToMidi = (name) => {
    const match = name.match(/^([A-G])(#?)(-?\d+)$/);
    if (!match) return 0;
    const [, letter, sharp, octaveStr] = match;
    const octave = Number(octaveStr);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] ?? 0;
    return (octave + 1) * 12 + base + (sharp ? 1 : 0);
  };

  const getHighestNoteName = (notes) => {
    if (Array.isArray(notes)) {
      return notes.reduce((best, current) => {
        return noteNameToMidi(current) > noteNameToMidi(best) ? current : best;
      }, notes[0]);
    }
    return notes;
  };

  const findStartIndex = (actions, startBeat) => {
    let low = 0;
    let high = actions.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (actions[mid].time < startBeat) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const pausePlayback = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsPlaying(false);
  };

  const stopPlayback = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    cursorBeatsRef.current = 0;
    setCurrentBeat(0);
    setIsPlaying(false);
  };

  const playNote = async (noteName, durationBeats) => {
    await Tone.start();
    const sampler = recorderSamplerRef.current;
    if (!sampler?.loaded) return;
    const secondsPerBeat = 60 / (bpm || 120);
    const durationSeconds = Math.max(durationBeats * secondsPerBeat, 0.1);
    sampler.triggerAttackRelease(noteName, durationSeconds, Tone.now());
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pausePlayback();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    recorderFilterRef.current = new Tone.Filter({
      type: "lowpass",
      frequency: 1400,
      Q: 1,
    }).toDestination();

    recorderVibratoRef.current = new Tone.Vibrato(5, 0.2);

    recorderSynthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 1.5 },
    });

    recorderSynthRef.current.connect(recorderVibratoRef.current);
    recorderVibratoRef.current.connect(recorderFilterRef.current);

    pianoSynthRef.current = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.5,
      modulationIndex: 8,
      oscillator: { type: "sine" },
      modulation: { type: "square" },
      envelope: { attack: 0.005, decay: 1.2, sustain: 0.1, release: 1.5 },
      modulationEnvelope: {
        attack: 0.01,
        decay: 0.5,
        sustain: 0.2,
        release: 0.8,
      },
    }).toDestination();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      recorderVibratoRef.current?.dispose();
      recorderFilterRef.current?.dispose();
      recorderSamplerGainRef.current?.dispose();
      recorderReverbRef.current?.dispose();
      recorderSamplerRef.current?.dispose();
      pianoSamplerGainRef.current?.dispose();
      pianoReverbRef.current?.dispose();
      pianoSamplerRef.current?.dispose();
      recorderSynthRef.current?.dispose();
      pianoSynthRef.current?.dispose();
      recorderVibratoRef.current = null;
      recorderFilterRef.current = null;
      recorderSamplerGainRef.current = null;
      recorderReverbRef.current = null;
      recorderSamplerRef.current = null;
      pianoSamplerGainRef.current = null;
      pianoReverbRef.current = null;
      pianoSamplerRef.current = null;
      recorderSynthRef.current = null;
      pianoSynthRef.current = null;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadFluteSampler = async () => {
      setRecorderReady(false);
      recorderSamplerRef.current?.dispose();
      recorderSamplerGainRef.current?.dispose();
      recorderReverbRef.current?.dispose();
      recorderSamplerRef.current = null;
      recorderSamplerGainRef.current = null;
      recorderReverbRef.current = null;

      try {
        const response = await fetch(
          `/samples/flute/${activeFluteDynamic}/index.json`,
        );
        if (!response.ok) return;

        const files = await response.json();
        const urls = {};

        files.forEach((file) => {
          const note = parseFluteSampleNote(file);
          if (note) {
            urls[note] = file;
          }
        });

        if (Object.keys(urls).length === 0) return;

        recorderSamplerRef.current = new Tone.Sampler({
          urls,
          baseUrl: `/samples/flute/${activeFluteDynamic}/`,
          onload: () => {
            if (isMounted) setRecorderReady(true);
          },
        });

        recorderSamplerGainRef.current = new Tone.Gain(4);
        recorderReverbRef.current = new Tone.Reverb({
          decay: 5,
          preDelay: 0.01,
          wet: 0.15,
        });
        recorderSamplerRef.current.connect(recorderSamplerGainRef.current);
        recorderSamplerGainRef.current.connect(recorderReverbRef.current);
        recorderReverbRef.current.connect(recorderVibratoRef.current);
      } catch (error) {
        console.error("Failed to load flute samples:", error);
      }
    };

    loadFluteSampler();

    return () => {
      isMounted = false;
    };
  }, [activeFluteDynamic]);

  useEffect(() => {
    let isMounted = true;

    const loadPianoSampler = async () => {
      setPianoReady(false);
      pianoSamplerGainRef.current?.dispose();
      pianoReverbRef.current?.dispose();
      pianoSamplerRef.current?.dispose();
      pianoSamplerGainRef.current = null;
      pianoReverbRef.current = null;
      pianoSamplerRef.current = null;

      try {
        const response = await fetch(
          `/samples/piano/${activePianoVersion}/index.json`,
        );
        if (!response.ok) return;

        const files = await response.json();
        const urls = {};

        files.forEach((file) => {
          const note = parsePianoSampleNote(file);
          if (note) {
            urls[note] = file;
          }
        });

        if (Object.keys(urls).length === 0) return;

        pianoSamplerRef.current = new Tone.Sampler({
          urls,
          baseUrl: `/samples/piano/${activePianoVersion}/`,
          onload: () => {
            if (isMounted) setPianoReady(true);
          },
        });

        pianoSamplerGainRef.current = new Tone.Gain(0.25);
        pianoReverbRef.current = new Tone.Reverb({
          decay: 5,
          preDelay: 0.02,
          wet: 0.15,
        });
        pianoSamplerRef.current.connect(pianoSamplerGainRef.current);
        pianoSamplerGainRef.current.connect(pianoReverbRef.current);
        pianoReverbRef.current.toDestination();
      } catch (error) {
        console.error("Failed to load piano samples:", error);
      }
    };

    loadPianoSampler();

    return () => {
      isMounted = false;
    };
  }, [activePianoVersion]);

  const startPlayback = async () => {
    if (!song) return;

    await Tone.start();
    await Tone.loaded();

    const recorderSampler = recorderSamplerRef.current;
    const pianoSampler = pianoSamplerRef.current;

    if (!recorderSampler?.loaded || !pianoSampler?.loaded) {
      return;
    }

    const pianoDelaySeconds = 0.08;
    const getSecondsPerBeat = () => 60 / bpmRef.current;
    const pianoDelayBeats = pianoDelaySeconds / getSecondsPerBeat();

    const startBeat = Math.max(0, cursorBeatsRef.current);
    const tracks = Array.isArray(song.tracks) ? song.tracks : [];
    const trackStates = tracks.map((track) => {
      const synth =
        track.instrument === "recorder" ? recorderSampler : pianoSampler;
      const delayBeats = track.instrument === "recorder" ? 0 : pianoDelayBeats;

      const actions = (Array.isArray(track.actions) ? track.actions : [])
        .filter((action) => action.type === "note")
        .map((action) => ({
          time: (action.time ?? 0) + delayBeats,
          duration: action.duration ?? 0,
          notes: getHighestNoteName(action.pitches ?? action.pitch),
          velocity: Math.min(Math.max((action.velocity ?? 80) / 100, 0), 1),
        }))
        .filter((action) => action.notes)
        .sort((a, b) => a.time - b.time);

      return { synth, actions, index: findStartIndex(actions, startBeat) };
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

    const tick = () => {
      const secondsPerBeat = getSecondsPerBeat();
      const beat =
        startBeatRef.current +
        (Tone.now() - startToneTimeRef.current) / secondsPerBeat;
      cursorBeatsRef.current = beat;

      setCurrentBeat(beat);

      trackStatesRef.current.forEach((state) => {
        while (
          state.index < state.actions.length &&
          state.actions[state.index].time <= beat
        ) {
          const action = state.actions[state.index];
          const durationSeconds = action.duration * secondsPerBeat;
          const startTime = Tone.now();

          if (durationSeconds > 0) {
            state.synth.triggerAttackRelease(
              action.notes,
              durationSeconds,
              startTime,
              action.velocity,
            );
          }
          state.index += 1;
        }
      });

      // loop / end handling
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

    rafIdRef.current = requestAnimationFrame(tick);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  };

  const handleNoteClick = ({ note, duration }) => {
    playNote(note, duration);
  };

  const handleScrubStart = () => {
    pausePlayback();
  };

  const handleScrub = (beat) => {
    setCurrentBeat(beat);
    const clamped = Math.max(0, Math.min(durationBeats, beat));
    cursorBeatsRef.current = clamped;
    setCurrentBeat(clamped);
  };

  const handleRestart = () => {
    stopPlayback();
  };

  const handleBpmChange = (value) => {
    const next = Math.max(30, Math.min(240, Number(value) || 0));

    if (isPlaying) {
      const now = Tone.now();
      const secondsPerBeatOld = 60 / bpmRef.current;
      const beatsSinceLastChange =
        (now - startToneTimeRef.current) / secondsPerBeatOld;

      // Advance startBeat so the perceived current beat at `now` stays the same
      startBeatRef.current = startBeatRef.current + beatsSinceLastChange;
      startToneTimeRef.current = now;
    }

    setBpm(next);
    bpmRef.current = next;

    Tone.getTransport().bpm.value = next;
  };

  const handleNoteWidthChange = (value) => {
    setNoteWidth(value);
  };

  const resetTimeoutRef = useRef(null);
  const handleSelectSong = (newSong) => {
    setSong(newSong);

    bpmRef.current = newSong.bpm;
    setBpm(newSong.bpm);

    clearTimeout(resetTimeoutRef.current);
    if (song?.id === newSong?.id) {
      return;
    }

    pausePlayback();

    resetTimeoutRef.current = setTimeout(() => {
      stopPlayback();
      setCurrentBeat(0);
    }, FADE_MS);
  };

  return (
    <div className="w-full text-main pb-8">
      <div className="flex items-center gap-2">
        <Directory onSelect={handleSelectSong} />
        <span>{song ? song.title : "Select a song"}</span>
      </div>
      <div className="w-full flex justify-between">
        <div className="max-w-100 grow text-base">
          <div className="mt-2 flex items-center gap-2">
            <label title="bpm">BPM</label>
            <div className="flex-1 mx-4">
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
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label title="note width">Note Width</label>
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
        </div>

        <div className="flex gap-2 items-center *:w-18 *:h-8">
          <DuoToggleButton
            value={isPlaying}
            onToggle={() => startPlayback()}
            offToggle={() => pausePlayback()}
            onColors={{
              background: "bg-note-full",
              shadowBackground: "bg-note-full-dark",
              border: "border-note-full-dark",
              text: "text-main",
            }}
            offColors={{
              background: "bg-note-half",
              shadowBackground: "bg-note-half-dark",
              border: "border-note-half-dark",
              text: "text-main",
            }}
            disabled={!song}
          >
            {isPlaying ? "Pause" : "Play"}
          </DuoToggleButton>
          <DuoButton
            text="text-main"
            background="bg-note-half"
            shadowBackground="bg-note-half-dark"
            border="border-note-half-dark"
            onClick={handleRestart}
            disabled={!song}
          >
            Restart
          </DuoButton>
          <DuoToggleButton
            onColors={{
              background: "bg-note-full",
              shadowBackground: "bg-note-full-dark",
              border: "border-note-full-dark",
              text: "text-main",
            }}
            offColors={{
              background: "bg-note-half",
              shadowBackground: "bg-note-half-dark",
              border: "border-note-half-dark",
              text: "text-main",
            }}
            initial={repeat}
            onToggle={() => setRepeat(true)}
            offToggle={() => setRepeat(false)}
            aria-label="Repeat song"
          >
            Repeat
          </DuoToggleButton>
        </div>
      </div>
      <Visualizer
        song={song}
        currentBeat={currentBeat}
        durationBeats={durationBeats}
        isPlaying={isPlaying}
        bpm={bpm}
        noteWidth={noteWidth}
        playBarPosition={playBarPosition}
        onScrubStart={handleScrubStart}
        onScrub={handleScrub}
        onNoteClick={handleNoteClick}
        onPlayPause={handlePlayPause}
        onPlayBarPositionChange={setPlayBarPosition}
        fingeringSystem={fingeringSystem}
      />
    </div>
  );
}
