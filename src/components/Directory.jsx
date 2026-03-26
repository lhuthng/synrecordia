import { useEffect, useState } from "react";

export default function Directory({ onSelect }) {
  const [songs, setSongs] = useState([]);
  const [status, setStatus] = useState("loading");
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadIndex() {
      try {
        const response = await fetch("/songs/index.json");
        if (!response.ok) throw new Error("Failed to load song index");
        const data = await response.json();
        if (isMounted) {
          setSongs(Array.isArray(data) ? data : []);
          setStatus("ready");
        }
      } catch (error) {
        if (isMounted) {
          setStatus("error");
          console.error(error);
        }
      }
    }

    loadIndex();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelect = async (meta) => {
    setLoadingId(meta.id);
    try {
      const response = await fetch(`/songs/${meta.file}`);
      if (!response.ok) throw new Error(`Failed to load song: ${meta.file}`);
      const song = await response.json();
      onSelect?.(song);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingId(null);
    }
  };

  if (status === "loading") return <div>Loading songs...</div>;
  if (status === "error") return <div>Failed to load songs.</div>;

  return (
    <div className="text-main">
      <h2>Song Directory</h2>
      <ul>
        {songs.map((song) => (
          <li key={song.id}>
            <button
              type="button"
              onClick={() => handleSelect(song)}
              disabled={loadingId !== null}
            >
              {song.title} — {song.bpm} BPM
              {loadingId === song.id ? " (loading...)" : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
