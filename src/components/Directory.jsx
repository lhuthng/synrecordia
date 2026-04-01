import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DuoToggleButton from "./DuoToggleButton";
import DuoButton from "./DuoButton";
import { motion as Motion, AnimatePresence } from "motion/react";
import { cn } from "../libs/utils";

// ── Difficulty badge ──────────────────────────────────────────────────────────

const DIFFICULTY_CONFIG = {
  beginner: {
    label: "Beginner",
    classes: "text-note-full border-note-full/50",
  },
  easy: {
    label: "Easy",
    classes: "text-note-full border-note-full/50",
  },
  medium: {
    label: "Medium",
    classes: "text-yellow-400 border-yellow-400/50",
  },
  hard: {
    label: "Hard",
    classes: "text-accent-pink border-accent-pink/50",
  },
  expert: {
    label: "Expert",
    classes: "text-red-400 border-red-400/50",
  },
};

function DifficultyBadge({ difficulty }) {
  const cfg = DIFFICULTY_CONFIG[difficulty?.toLowerCase()];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "relative z-10 shrink-0 text-xs font-bold uppercase px-1.5 py-0.5 rounded-lg border-2 bg-dark/80",
        cfg.classes,
      )}
    >
      {cfg.label}
    </span>
  );
}

const DIFFICULTY_SVGS = {
  beginner: (
    <>
      <ellipse cx="16.407" cy="16.043" rx="14.225" ry="14.225"></ellipse>
      <path
        style={{ strokeLinecap: "round" }}
        d="M 8.857 10.915 C 8.165 14.544 14.829 14.66 13.946 10.8"
      ></path>
      <path
        style={{ strokeLinecap: "round" }}
        d="M 19.853 11.043 C 19.322 14.795 25.672 14.723 24.942 10.928"
      ></path>
      <path
        style={{ strokeLinecap: "round" }}
        d="M 9.172 20.226 C 10.289 26.337 21.332 27.241 23.329 20.304"
      ></path>
    </>
  ),
  easy: (
    <>
      <ellipse cx="16.407" cy="16.043" rx="14.225" ry="14.225"></ellipse>
      <line
        style={{ strokeLinecap: "round" }}
        x1="12.492"
        y1="9.907"
        x2="12.379"
        y2="13.377"
      />
      <line
        style={{ strokeLinecap: "round" }}
        x1="19.988"
        y1="9.973"
        x2="19.875"
        y2="13.443"
      />
      <path d="M 9.172 20.226 C 10.289 26.337 21.332 27.241 23.329 20.304"></path>
    </>
  ),
  medium: (
    <>
      <ellipse cx="16.407" cy="16.043" rx="14.225" ry="14.225"></ellipse>
      <line
        style={{ strokeLinecap: "round" }}
        x1="12.492"
        y1="9.907"
        x2="12.379"
        y2="13.377"
      />
      <line
        style={{ strokeLinecap: "round" }}
        x1="19.988"
        y1="9.973"
        x2="19.875"
        y2="13.443"
      />
      <path
        style={{ strokeLinecap: "round" }}
        d="M 9.172 20.226 C 14.203 20.815 17.966 20.767 23.329 20.304"
      />
    </>
  ),
  hard: (
    <>
      <ellipse cx="16.407" cy="16.043" rx="14.225" ry="14.225"></ellipse>

      <path
        style={{ strokeLinecap: "round" }}
        d="M 9.172 20.226 C 14.876 16.39 16.95 23.597 23.329 20.304"
      />
      <path
        style={{ strokeLinejoin: "round", strokeLinecap: "round" }}
        d="M 11.74 9.764 C 13.357 10.461 14.321 12.584 14.309 12.579 C 10.684 11.654 9.746 12.875 9.774 12.882"
      />
      <path
        style={{ strokeLinejoin: "round", strokeLinecap: "round" }}
        d="M 22.412 10.572 C 22.427 10.554 21.435 10.729 19.482 13.055 C 23.599 12.452 25.023 13.814 25.023 13.814"
      />
    </>
  ),
  expert: (
    <>
      <ellipse cx="16.407" cy="16.043" rx="14.225" ry="14.225"></ellipse>

      <path
        style={{ strokeLinecap: "round" }}
        d="M 9.172 20.226 C 14.876 16.39 16.95 23.597 23.329 20.304"
      />
      <path
        style={{ strokeLinejoin: "round", strokeLinecap: "round" }}
        d="M 11.74 9.764 C 13.357 10.461 14.321 12.584 14.309 12.579 C 10.684 11.654 9.746 12.875 9.774 12.882"
      />
      <path
        style={{ strokeLinejoin: "round", strokeLinecap: "round" }}
        d="M 22.412 10.572 C 22.427 10.554 21.435 10.729 19.482 13.055 C 23.599 12.452 25.023 13.814 25.023 13.814"
      />
    </>
  ),
};

function DifficultyExpression({ className, difficulty }) {
  const svg = DIFFICULTY_SVGS[difficulty?.toLowerCase()];
  if (!svg) return null;
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn(className, "absolute z-9 w-18 h-18 fill-none stroke-2")}
    >
      {svg}
    </svg>
  );
}

// ── Wave loading dots ─────────────────────────────────────────────────────────

function LoadingWave() {
  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {[0, 1, 2].map((i) => (
        <Motion.span
          key={i}
          className="block w-2.5 h-2.5 rounded-full bg-note-full"
          animate={{ y: [0, -10, 0] }}
          transition={{
            duration: 0.7,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ── Song entry ────────────────────────────────────────────────────────────────

function SongEntry({ song, onSelect }) {
  return (
    <li className="relative">
      {/* Raised shadow — mirrors the DuoButton floor layer */}
      <div className="absolute inset-0 translate-y-0.5 rounded-2xl bg-note-half-dark z-0" />

      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "relative z-10 w-full text-left px-3 py-2.5 rounded-2xl border-2",
          "border-note-half-dark bg-note-half text-main",
          "cursor-pointer transition-all duration-75",
          "overflow-hidden",
          "hover:brightness-110 active:translate-y-0.5 focus:outline-main",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm leading-snug">
            {song.title}
          </span>
          <DifficultyBadge difficulty={song.difficulty} />
        </div>
        <div className="text-xs text-main/50 mt-0.5 font-mono">
          {song.bpm} BPM
        </div>
        <DifficultyExpression
          className="right-0 bottom-0 stroke-note-half-dark/40 translate-x-3 translate-y-4 -rotate-30"
          difficulty={song.difficulty}
        />
      </button>
    </li>
  );
}

// ── Directory ─────────────────────────────────────────────────────────────────

export default function Directory({
  className,
  display = "block",
  position = "left-0",
  onSelected,
}) {
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState(null);
  const [status, setStatus] = useState("idle");
  const containerRef = useRef(null);
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

    if (open && songs === null) fetchIndex();

    return () => {
      mounted = false;
    };
  }, [open, songs]);

  // Click outside the entire Directory widget → close
  useEffect(() => {
    function onDocPointer(e) {
      if (!open) return;
      if (containerRef.current && !containerRef.current.contains(e.target)) {
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
    navigate(`/songs/${meta.id}`);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className, display)}>
      {/* ── Trigger button ── */}
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

      {/* ── Dropdown panel ── */}
      <AnimatePresence>
        {open && (
          <Motion.div
            role="dialog"
            aria-label="Song directory"
            className={cn(
              "absolute mt-2 w-80 border-2 border-note-half-dark bg-dark rounded-2xl",
              "shadow-[0_8px_32px_rgba(0,0,0,0.55)] p-3 z-50",
              position,
            )}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold uppercase text-main tracking-wide text-sm select-none">
                Song Directory
              </span>
              <DuoButton
                padding="px-2 py-0.5"
                background="bg-note-half"
                shadowBackground="bg-note-half-dark"
                border="border-note-half-dark"
                text="text-main"
                onClick={() => setOpen(false)}
                aria-label="Close directory"
              >
                ✕
              </DuoButton>
            </div>

            {/* ── Loading ── */}
            {status === "loading" && <LoadingWave />}

            {/* ── Error ── */}
            {status === "error" && (
              <p className="py-4 text-center text-accent-pink font-bold uppercase text-sm">
                Failed to load songs.
              </p>
            )}

            {/* ── Empty ── */}
            {status === "ready" && songs?.length === 0 && (
              <p className="py-4 text-center text-dim font-bold uppercase text-sm">
                No songs available.
              </p>
            )}

            {/* ── Song list ── */}
            {Array.isArray(songs) && songs.length > 0 && (
              <ul className="space-y-2">
                {songs.map((song) => (
                  <SongEntry
                    key={song.id}
                    song={song}
                    onSelect={() => {
                      handleSelect(song);
                      onSelected?.();
                    }}
                  />
                ))}
              </ul>
            )}
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
