import { useEffect, useState } from "react";

export default function Directory({ onSelect }) {
  const [songs, setSongs] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let isMounted = true;

    async function loadSongs() {
      try {
        const indexResponse = await fetch("/songs/index.json");
        if (!indexResponse.ok) {
          throw new Error("Failed to load song index");
        }

        const indexData = await indexResponse.json();
        const songFiles = Array.isArray(indexData)
          ? indexData
          : Array.isArray(indexData.files)
            ? indexData.files
            : [];

        const songRequests = songFiles.map(async (file) => {
          const response = await fetch(`/songs/${file}`);
          if (!response.ok) {
            throw new Error(`Failed to load song file: ${file}`);
          }
          return response.json();
        });

        const loadedSongs = await Promise.all(songRequests);

        if (isMounted) {
          setSongs(loadedSongs);
          setStatus("ready");
        }
      } catch (error) {
        if (isMounted) {
          setStatus("error");
          console.error(error);
        }
      }
    }

    loadSongs();

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "loading") {
    return <div>Loading songs...</div>;
  }

  if (status === "error") {
    return <div>Failed to load songs.</div>;
  }

  return (
    <div className="text-main">
      <h2>Song Directory</h2>
      <ul>
        {songs.map((song) => (
          <li key={song.id}>
            <button type="button" onClick={() => onSelect?.(song)}>
              {song.title} — {song.bpm} BPM
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
