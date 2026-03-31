import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import Directory from "./Directory";
import Visualizer from "./Visualizer";
import InstrumentManager from "./instruments/InstrumentManager";
import usePlayer from "../hooks/usePlayer.js";

export default function Player() {
  // URL param — present when route is /songs/:songId
  const { songId: urlSongId } = useParams();

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
    // handlers
    registerSampler,
    deregisterSampler,
    startPlayback,
    pausePlayback,
    handlePlayPause,
    handleNoteClick,
    handleScrubStart,
    handleScrub,
    handleRestart,
    handleBpmChange,
    handleNoteWidthChange,
    handleToggleChanged,
    handleAudioReady,
    setFingeringSystem,
  } = usePlayer();

  // visual readiness is owned by the Visualizer component
  const [isVisualReady, setIsVisualReady] = useState(false);

  // URL-based loading state
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState(null);

  // Cache for songs fetched via URL so navigating back doesn't re-fetch
  const songCacheRef = useRef({});

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
      {/* Song selector row */}
      <div className="flex items-center gap-2">
        <Directory />

        {urlLoading ? (
          <span className="opacity-60 italic">Loading song…</span>
        ) : urlError ? (
          /* Error banner for invalid / failed song IDs */
          <span className="flex items-center gap-2 text-sm">
            <span className="inline-block rounded-lg bg-red-900/60 border border-red-500 px-3 py-1 text-red-200">
              ⚠ {urlError}
            </span>
          </span>
        ) : (
          <span>{song ? song.title : "Select a song"}</span>
        )}
      </div>

      {/* Controls */}
      <div className="w-full flex justify-between gap-2 not-md:flex-col">
        <div className="max-w-100 grow text-base">
          <div className="mt-2 flex items-center gap-2">
            <label title="bpm">BPM:</label>
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
              Reset
            </DuoButton>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <label title="note width">Note Width:</label>
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

        <div className="flex gap-2 not-md:ml-auto items-center *:w-18 *:h-8">
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
            disabled={!isReady}
          >
            {isPlaying ? "Pause" : "Play"}
          </DuoToggleButton>

          <DuoButton
            text="text-main"
            background="bg-note-half"
            shadowBackground="bg-note-half-dark"
            border="border-note-half-dark"
            onClick={handleRestart}
            disabled={!isReady}
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
            value={repeat}
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
        onReady={() => setIsVisualReady(true)}
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
            flashCount={flashCounters[index] ?? 0}
            name={track.instrument}
            register={registerSampler}
            deregister={deregisterSampler}
            toggle={index === selectedTrack}
            onToggleChanged={handleToggleChanged}
            initialReady={isAudioReady?.[index]}
            handleAudioReady={(value) => handleAudioReady(index, value)}
            onReady={() => handleAudioReady(index, true)}
            offReady={() => handleAudioReady(index, false)}
            callbacks={{
              pausePlayback,
              getFingeringSystems: () => ["recorder", "simple"],
              getFingeringStyles: () => ["german", "baroque"],
              setFingeringSystem,
            }}
          />
        ))}
      </div>

      {isReady && (
        <div className="space-y-2">
          <h2>
            Instrument Controller:
            {selectedTrack === null && (
              <span> Select an instrument above to edit</span>
            )}
          </h2>
          <div className="pl-2" ref={(node) => setControllerNode(node)}></div>
        </div>
      )}
    </div>
  );
}
