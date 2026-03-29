import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import Directory from "./Directory";
import Visualizer, { FADE_MS } from "./Visualizer";
import InstrumentManager from "./instruments/InstrumentManager";

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

const getFingeringSystems = () => ["recorder", "simple"];
const getFingeringStyles = () => ["german", "baroque"];

export default function Player() {
  const [song, setSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(() => song?.bpm ?? 120);
  const [noteWidth, setNoteWidth] = useState(70);
  const [repeat, setRepeat] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [playBarPosition, setPlayBarPosition] = useState(0.95);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [controllerNode, setControllerNode] = useState(null);

  const [fingeringSystem, setFingeringSystem] = useState("recorder");

  const durationBeats = computeSongEndBeat(song);

  const samplersRef = useRef({});
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
    const sampler = samplersRef.current[0];
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

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const registerSampler = (slot, sampler) => {
    samplersRef.current[slot] = sampler;
  };

  const deregisterSampler = (slot, onCallback) => {
    delete samplersRef.current[slot];
    onCallback?.();
  };

  const startPlayback = async () => {
    if (!song) return;

    await Tone.start();
    await Tone.loaded();

    const pianoDelaySeconds = 0.08;
    const getSecondsPerBeat = () => 60 / bpmRef.current;
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

  const handleToggleChanged = (slot, value) => {
    if (slot === selectedTrack) {
      if (!value) setSelectedTrack(null);
    } else if (value) {
      setSelectedTrack(slot);
    }
  };

  return (
    <div className="w-full text-main space-y-2">
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
      <div className="flex gap-2">
        {song?.tracks?.map((track, index) => (
          <InstrumentManager
            controllerNode={controllerNode}
            key={`${index}-${track.instrument}`}
            slot={index}
            name={track.instrument}
            register={registerSampler}
            deregister={deregisterSampler}
            toggle={index === selectedTrack}
            onToggleChanged={handleToggleChanged}
            callbacks={{
              pausePlayback,
              getFingeringSystems,
              getFingeringStyles,
              setFingeringSystem,
            }}
          />
        ))}
      </div>
      <div ref={(node) => setControllerNode(node)}></div>
    </div>
  );
}
