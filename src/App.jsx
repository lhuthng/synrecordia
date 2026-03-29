import Player from "./components/Player";
import Header from "./components/Header";

function App() {
  return (
    <div className="w-full min-h-screen bg-note-full/50 font-iosevka">
      <Header />
      <div className="w-cap min-h-screen bg-dark px-4 shadow-md">
        <Player />
      </div>
    </div>
  );
}

export default App;
