import { useState } from "react";
import InstrumentControls from "./components/InstrumentControls";
import Player from "./components/Player";
import Header from "./components/Header";

function App() {
  const [fluteDynamic, setFluteDynamic] = useState("mezzo-forte");
  const [pianoVersion, setPianoVersion] = useState("v8");

  return (
    <div className="w-full min-h-screen bg-dim font-iosevka">
      <Header />
      <div className="w-cap min-h-screen bg-dark px-4 shadow-md">
        <Player fluteDynamic={fluteDynamic} pianoVersion={pianoVersion} />
        <InstrumentControls
          fluteDynamic={fluteDynamic}
          pianoVersion={pianoVersion}
          onFluteChange={setFluteDynamic}
          onPianoChange={setPianoVersion}
        />
        {/* Add fingering system select here */}
        {/* <div className="text-main">
          <label htmlFor="fingering-system">Fingering System</label>
          <select
            id="fingering-system"
            value={fingeringSystem}
            onChange={(e) => setFingeringSystem(e.target.value)}
          >
            <option value="recorder">Recorder</option>
            <option value="simple">Simple</option>
          </select>
        </div>*/}
      </div>
    </div>
  );
}

export default App;
