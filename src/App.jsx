import { Routes, Route } from "react-router-dom";
import Player from "./components/Player";
import Header from "./components/Header";
import Details from "./components/Details";
import SynthwaveBackground from "./components/SynthwaveBackground";

function App() {
  return (
    <div className="w-full min-h-screen bg-dark font-iosevka">
      <SynthwaveBackground />
      <div className="relative z-10">
        <Header />
        <div className="w-cap min-h-screen bg-dark/90 px-4 shadow-md">
          <Routes>
            <Route path="/" element={<Player />} />
            <Route path="/songs/:songId" element={<Player />} />
          </Routes>
          <Details />
        </div>
      </div>
    </div>
  );
}

export default App;
