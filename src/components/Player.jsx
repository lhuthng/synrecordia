import { useState } from "react";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import DuoSlideBar from "./DuoSlideBar";
import Directory from "./Directory";
import Visualizer, { FADE_MS } from "./Visualizer";
import InstrumentManager from "./instruments/InstrumentManager";
import usePlayer from "../hooks/usePlayer.js";

export default function Player() {
  // player hook encapsulates audio/playback logic
  const {
    song,
    selectSong,
    isPlaying,
    currentBeat,
    bpm,
    noteWidth,
    repeat,
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

  // play bar position is a UI concern kept locally
  const [playBarPosition, setPlayBarPosition] = useState(0.95);

  // instrument controller DOM node
  const [controllerNode, setControllerNode] = useState(null);

  const isReady = isVisualReady && isAudioReadyAll;

  const handleSelect = (newSong) => {
    // reset visual ready before selecting new song so Visualizer fades properly
    setIsVisualReady(false);
    selectSong(newSong);
    // Visualizer will call onReady to set isVisualReady
    // small timeout to match Visualizer fade can be handled by Visualizer itself
    setTimeout(() => {
      // ensure playback position reset after fade (Visualizer coordinates with FADE_MS)
    }, FADE_MS);
  };

  return (
    <div className="w-full min-h-[calc(100dvh-8rem)] text-main space-y-2">
      <div className="flex items-center gap-2">
        <Directory onSelect={handleSelect} />
        <span>{song ? song.title : "Select a song"}</span>
      </div>

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
            initial={repeat}
            onToggle={() => {}}
            offToggle={() => {}}
            aria-label="Repeat song"
          >
            {/* The usePlayer hook manages repeat; toggle wiring can be added if required */}
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
