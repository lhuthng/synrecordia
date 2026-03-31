import { Routes, Route } from "react-router-dom";
import Player from "./components/Player";
import Header from "./components/Header";
import Details from "./components/Details";

function App() {
  return (
    <div className="w-full min-h-screen bg-note-full/50 font-iosevka">
      <Header />
      <div className="w-cap min-h-screen bg-dark px-4 shadow-md">
        <Routes>
          <Route path="/" element={<Player />} />
          <Route path="/songs/:songId" element={<Player />} />
        </Routes>
        <Details />
      </div>
    </div>
  );
}

export default App;
