import Player from "./components/Player";
import Header from "./components/Header";

function App() {
  return (
    <div className="w-full min-h-screen bg-dim font-iosevka">
      <Header />
      <div className="w-cap min-h-screen bg-dark px-4 shadow-md">
        <Player />
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
