import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DuoToggleButton from "./DuoToggleButton";
import { motion as Motion, AnimatePresence } from "motion/react";

export default function Directory() {
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState(null);
  const [status, setStatus] = useState("idle");
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  // Fetch index on first open (lazy)
  useEffect(() => {
    let mounted = true;
    async function fetchIndex() {
      setStatus("loading");
      try {
        const res = await fetch("/songs/index.json");
        if (!res.ok) throw new Error("Failed to load song index");
        const data = await res.json();
        if (!mounted) return;
        setSongs(Array.isArray(data) ? data : []);
        setStatus("ready");
      } catch (err) {
        if (!mounted) return;
        console.error(err);
        setSongs([]);
        setStatus("error");
      }
    }

    if (open && songs === null) {
      fetchIndex();
    }

    return () => {
      mounted = false;
    };
  }, [open, songs]);

  // Click outside to close panel
  useEffect(() => {
    function onDocPointer(e) {
      if (!open) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleSelect = (meta) => {
    // Navigate to the song URL — Player will handle fetching & loading
    navigate(`/songs/${meta.id}`);
    setOpen(false);
  };

  return (
    <div className="relative block">
      <DuoToggleButton
        className="w-10"
        onColors={{
          background: "bg-note-full",
          shadowBackground: "bg-note-full-dark",
          border: "border-note-full-dark",
          text: "text-main",
        }}
        offColors={{
          background: "bg-note-half",
          shadowBackground: "bg-note-half-dark",
          border: "border-note-half-dark",
          text: "text-main",
        }}
        onToggle={() => setOpen(true)}
        offToggle={() => setOpen(false)}
        value={open}
      >
        <svg
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 fill-main"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M1 5C1 3.34315 2.34315 2 4 2H8.43845C9.81505 2 11.015 2.93689 11.3489 4.27239L11.7808 6H13.5H20C21.6569 6 23 7.34315 23 9V19C23 20.6569 21.6569 22 20 22H4C2.34315 22 1 20.6569 1 19V10V9V5ZM3 9V10V19C3 19.5523 3.44772 20 4 20H20C20.5523 20 21 19.5523 21 19V9C21 8.44772 20.5523 8 20 8H13.5H11.7808H4C3.44772 8 3 8.44772 3 9ZM9.71922 6H4C3.64936 6 3.31278 6.06015 3 6.17071V5C3 4.44772 3.44772 4 4 4H8.43845C8.89732 4 9.2973 4.3123 9.40859 4.75746L9.71922 6Z"
          />
        </svg>
      </DuoToggleButton>

      <AnimatePresence>
        {open && (
          <Motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Song directory"
            className="absolute left-0 mt-2 w-80 overflow-auto border-2 border-note-half bg-dark rounded-2xl shadow-lg p-3 z-50"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <strong className="select-none text-main">Song Directory</strong>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-sm px-2 py-1 rounded-lg text-main bg-card-bg hover:bg-note-half-dark border-2 border-note-half-dark cursor-pointer"
              >
                Close
              </button>
            </div>

            {status === "loading" && <div>Loading songs…</div>}
            {status === "error" && <div>Failed to load songs.</div>}
            {status === "ready" &&
              Array.isArray(songs) &&
              songs.length === 0 && <div>No songs available.</div>}

            {Array.isArray(songs) && songs.length > 0 && (
              <ul className="space-y-1">
                {songs.map((song) => (
                  <li
                    key={song.id}
                    className="flex items-center justify-between"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(song)}
                      className="text-left w-full px-2 py-1 rounded-xl bg-main hover:bg-note-half text-card-bg hover:text-main border-2 border-note-half-dark cursor-pointer"
                    >
                      <div className="font-medium">{song.title}</div>
                      <div className="text-xs">{song.bpm} BPM</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
