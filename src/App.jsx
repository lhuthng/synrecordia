import { Routes, Route } from "react-router-dom";
import Player from "./components/Player";
import CompactPlayer from "./components/CompactPlayer";
import Header from "./components/Header";
import Details from "./components/Details";
import SynthwaveBackground from "./components/SynthwaveBackground";

function MainLayout() {
  return (
    <>
      <Header />
      <div className="w-cap min-h-screen bg-dark/70 px-4 shadow-md">
        <Player />
        <Details />
      </div>
    </>
  );
}

function App() {
  return (
    <div className="w-full min-h-screen bg-dark font-iosevka">
      <SynthwaveBackground />
      <div className="relative z-10">
        <Routes>
          <Route path="/compact/*" element={<CompactPlayer />} />
          <Route path="/*" element={<MainLayout />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
