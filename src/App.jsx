import { Routes, Route } from "react-router-dom";
import { MobileMenuProvider } from "./context/MobileMenuContext";
import { EcoModeProvider } from "./context/EcoModeContext";
import Player from "./components/Player";
import CompactPlayer from "./components/CompactPlayer";
import Header from "./components/Header";
import Details from "./components/Details";
import SynthwaveBackground from "./components/SynthwaveBackground";

function MainLayout() {
  return (
    <MobileMenuProvider>
      <Header />
      <div className="w-cap min-h-screen bg-dark/70 px-4 shadow-md">
        <Player />
        <Details />
      </div>
    </MobileMenuProvider>
  );
}

function App() {
  return (
    <EcoModeProvider>
      <div className="w-full min-h-screen bg-dark font-iosevka">
        <SynthwaveBackground />
        <div className="relative z-10">
          <Routes>
            <Route path="/compact/*" element={<CompactPlayer />} />
            <Route path="/*" element={<MainLayout />} />
          </Routes>
        </div>
      </div>
    </EcoModeProvider>
  );
}

export default App;
