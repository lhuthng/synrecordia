import { useRef, useState } from "react";
import Directory from "./components/Directory";
import InstrumentControls from "./components/InstrumentControls";
import Player from "./components/Player";
import Visualizer from "./components/Visualizer";

function App() {
  const [selectedSong, setSelectedSong] = useState(null);
  const [fluteDynamic, setFluteDynamic] = useState("mezzo-forte");
  const [pianoVersion, setPianoVersion] = useState("v8");
  const [noteWidth, setNoteWidth] = useState(70);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [durationBeats, setDurationBeats] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBpm, setCurrentBpm] = useState(120);
  const playerControlRef = useRef(null);

  const handleSelectSong = (song) => {
    setSelectedSong(song);
    setCurrentBeat(0);
    setDurationBeats(0);
  };

  const handleScrubStart = () => {
    playerControlRef.current?.pause();
  };

  const handleScrub = (beat) => {
    setCurrentBeat(beat);
    playerControlRef.current?.seek(beat);
  };

  const handleNoteClick = ({ note, duration }) => {
    playerControlRef.current?.playNote(note, duration);
  };

  const handlePlayPause = () => {
    playerControlRef.current?.togglePlayPause();
  };

  return (
    <div>
      <Directory onSelect={handleSelectSong} />
      <InstrumentControls
        fluteDynamic={fluteDynamic}
        pianoVersion={pianoVersion}
        onFluteChange={setFluteDynamic}
        onPianoChange={setPianoVersion}
      />
      <div className="text-main">
        <label htmlFor="note-width">Note width</label>
        <input
          id="note-width"
          type="range"
          min="20"
          max="200"
          value={noteWidth}
          onChange={(event) => setNoteWidth(Number(event.target.value))}
        />
        <input
          type="number"
          min="20"
          max="200"
          value={noteWidth}
          onChange={(event) => setNoteWidth(Number(event.target.value))}
        />
      </div>
      <Visualizer
        song={selectedSong}
        currentBeat={currentBeat}
        durationBeats={durationBeats}
        isPlaying={isPlaying}
        bpm={currentBpm}
        noteWidth={noteWidth}
        onScrubStart={handleScrubStart}
        onScrub={handleScrub}
        onNoteClick={handleNoteClick}
        onPlayPause={handlePlayPause}
      />
      <Player
        key={selectedSong?.id ?? "no-song"}
        song={selectedSong}
        fluteDynamic={fluteDynamic}
        pianoVersion={pianoVersion}
        onBeatChange={setCurrentBeat}
        onDurationChange={setDurationBeats}
        onIsPlayingChange={setIsPlaying}
        onBpmChange={setCurrentBpm}
        controlRef={playerControlRef}
      />
    </div>
  );
}

export default App;
