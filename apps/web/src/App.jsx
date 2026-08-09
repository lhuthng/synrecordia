import { Routes, Route } from "react-router-dom";
import { MobileMenuProvider } from "./context/MobileMenuContext";
import { EcoModeProvider } from "./context/EcoModeContext";
import { RoomSyncProvider } from "./context/RoomSyncContext";
import Player from "./components/player/Player";
import CompactPlayer from "./components/player/CompactPlayer";
import Header from "./components/layout/Header";
import Details from "./components/Details";
import SynthwaveBackground from "./components/layout/SynthwaveBackground";
import EcoModeToast from "./components/EcoModeToast";

function MainLayout() {
  return (
    <MobileMenuProvider>
      <Header />
      <EcoModeToast />
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
      <RoomSyncProvider>
        <div className="w-full min-h-screen bg-dark font-iosevka">
          <SynthwaveBackground />
          <div className="relative z-10">
            <Routes>
              <Route path="/compact/*" element={<CompactPlayer />} />
              <Route path="/*" element={<MainLayout />} />
            </Routes>
          </div>
        </div>
      </RoomSyncProvider>
    </EcoModeProvider>
  );
}

export default App;
