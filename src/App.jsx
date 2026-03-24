import { useState } from "react";
import Directory from "./components/Directory";
import InstrumentControls from "./components/InstrumentControls";
import Player from "./components/Player";

function App() {
  const [selectedSong, setSelectedSong] = useState(null);
  const [fluteDynamic, setFluteDynamic] = useState("mezzo-forte");
  const [pianoVersion, setPianoVersion] = useState("v8");

  return (
    <div>
      <Directory onSelect={setSelectedSong} />
      <InstrumentControls
        fluteDynamic={fluteDynamic}
        pianoVersion={pianoVersion}
        onFluteChange={setFluteDynamic}
        onPianoChange={setPianoVersion}
      />
      <Player
        song={selectedSong}
        fluteDynamic={fluteDynamic}
        pianoVersion={pianoVersion}
      />
    </div>
  );
}

export default App;
