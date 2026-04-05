import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import DuoToggleButton from "./DuoToggleButton";
import DuoButton from "./DuoButton";
import { motion as Motion, AnimatePresence } from "motion/react";
import { cn } from "../libs/utils";

// ── Difficulty config ─────────────────────────────────────────────────────────

const DIFFICULTY_CONFIG = {
  beginner: { classes: "text-note-full border-note-full/50" },
  easy: { classes: "text-note-full border-note-full/50" },
  medium: { classes: "text-yellow-400 border-yellow-400/50" },
  hard: { classes: "text-accent-pink border-accent-pink/50" },
  expert: { classes: "text-red-400 border-red-400/50" },
};

const DIFFICULTIES = ["beginner", "easy", "medium", "hard", "expert"];

// ── Difficulty badge ──────────────────────────────────────────────────────────

function DifficultyBadge({ difficulty }) {
  const { t } = useTranslation();
  const key = difficulty?.toLowerCase();
  const cfg = DIFFICULTY_CONFIG[key];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "relative z-10 shrink-0 text-xs font-bold uppercase px-1.5 py-0.5 rounded-lg border-2 bg-dark/80",
        cfg.classes,
      )}
    >
      {t(`difficulty.${key}`)}
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
      className={cn(
        className,
        "absolute w-18 h-18 -translate-y-1 -translate-x-10 fill-none stroke-2 pointer-events-none",
      )}
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
          "relative w-full text-left px-3 py-2.5 rounded-2xl border-2",
          "border-note-half-dark bg-note-half text-main",
          "cursor-pointer transition-all duration-75",
          "overflow-hidden",
          "hover:brightness-110 active:translate-y-0.5 focus:outline-main",
        )}
      >
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-md leading-snug">
              {song.title}
            </span>
            <DifficultyBadge difficulty={song.difficulty} />
          </div>
          <div className="text-xs text-main mt-0.5 font-mono">
            {song.composer && (
              <span className="text-main/70 mr-2">{song.composer}</span>
            )}
            {song.bpm} BPM
          </div>
        </div>
        <DifficultyExpression
          className="right-0 top-0 stroke-note-half-dark/40 translate-x-3 translate-y-4 -rotate-30 pointer-events-none z-0"
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
  basePath = "/songs",
  onSelected,
}) {
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState(null);
  const [status, setStatus] = useState("idle");

  const [searchRaw, setSearchRaw] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Difficulty filter — null means "All"
  const [activeDifficulty, setActiveDifficulty] = useState(null);

  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const id = setTimeout(
      () => setSearchTerm(searchRaw.trim().toLowerCase()),
      300,
    );
    return () => clearTimeout(id);
  }, [searchRaw]);

  // Auto-focus the search input whenever the panel opens
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open]);

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

  // Derived: songs filtered by current search term and difficulty chip
  const filteredSongs = useMemo(() => {
    if (!Array.isArray(songs)) return [];
    return songs.filter((song) => {
      const titleMatch =
        !searchTerm || song.title.toLowerCase().includes(searchTerm);
      const diffMatch =
        !activeDifficulty ||
        song.difficulty?.toLowerCase() === activeDifficulty;
      return titleMatch && diffMatch;
    });
  }, [songs, searchTerm, activeDifficulty]);

  const clearSearch = () => {
    setSearchRaw("");
    setSearchTerm("");
    searchRef.current?.focus();
  };

  const handleSelect = (meta) => {
    navigate(`${basePath}/${meta.id}`);
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
        {open ? (
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5 fill-none stroke-dark stroke-2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        ) : (
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
        )}
      </DuoToggleButton>

      {/* ── Dropdown panel ── */}
      <AnimatePresence>
        {open && (
          <Motion.div
            role="dialog"
            aria-label={t("directory.ariaLabel")}
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
                {t("directory.title")}
              </span>
              <DuoButton
                padding="px-2 py-0.5"
                background="bg-note-half"
                shadowBackground="bg-note-half-dark"
                border="border-note-half-dark"
                text="text-main"
                onClick={() => setOpen(false)}
                aria-label={t("directory.closeAriaLabel")}
              >
                ✕
              </DuoButton>
            </div>

            {/* ── Search input ── */}
            <div className="relative mb-2">
              {/* Search icon */}
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-main">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 fill-none stroke-current stroke-2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>

              <input
                ref={searchRef}
                type="text"
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                placeholder={t("directory.searchPlaceholder")}
                className={cn(
                  "w-full bg-note-half border-2 border-note-half-dark rounded-xl",
                  "pl-8 py-1.5 text-sm text-main placeholder:text-main",
                  "focus:outline-main transition-colors duration-75",
                  searchRaw ? "pr-8" : "pr-3",
                )}
              />

              {/* Clear button */}
              {searchRaw && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-main/40 hover:text-main transition-colors duration-75 cursor-pointer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-none stroke-current stroke-2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* ── Difficulty filter chips ── */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {/* "All" chip */}
              <button
                type="button"
                onClick={() => setActiveDifficulty(null)}
                className={cn(
                  "text-xs font-bold uppercase px-2 py-0.5 rounded-lg border-2",
                  "transition-colors duration-75 cursor-pointer",
                  activeDifficulty === null
                    ? "bg-note-full border-note-full-dark text-dark"
                    : "bg-transparent border-note-half-dark text-main/50 hover:text-main hover:border-main/30",
                )}
              >
                {t("directory.filterAll")}
              </button>

              {DIFFICULTIES.map((d) => {
                const isActive = activeDifficulty === d;
                const cfg = DIFFICULTY_CONFIG[d];
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setActiveDifficulty(isActive ? null : d)}
                    className={cn(
                      "text-xs font-bold uppercase px-2 py-0.5 rounded-lg border-2",
                      "transition-colors duration-75 cursor-pointer",
                      isActive
                        ? cn("bg-dark/80", cfg.classes)
                        : "bg-transparent border-note-half-dark text-main/40 hover:text-main/70 hover:border-main/30",
                    )}
                  >
                    {t(`difficulty.${d}`)}
                  </button>
                );
              })}
            </div>

            {/* ── Loading ── */}
            {status === "loading" && <LoadingWave />}

            {/* ── Error ── */}
            {status === "error" && (
              <p className="py-4 text-center text-accent-pink font-bold uppercase text-sm">
                {t("directory.failedToLoad")}
              </p>
            )}

            {/* ── Empty index ── */}
            {status === "ready" && songs?.length === 0 && (
              <p className="py-4 text-center text-dim font-bold uppercase text-sm">
                {t("directory.noSongs")}
              </p>
            )}

            {/* ── Song list (or no-results message) ── */}
            {Array.isArray(songs) && songs.length > 0 && (
              <>
                {filteredSongs.length === 0 ? (
                  <p className="py-4 text-center text-dim font-bold uppercase text-sm">
                    {t("directory.noResults")}
                  </p>
                ) : (
                  <ul
                    className="py-2 space-y-2 max-h-[min(386px,calc(100dvh-18rem))] overflow-y-auto pr-0.5 custom-scrollbar"
                    style={{
                      "--scrollbar-thumb": "var(--color-note-half)",
                      "--scrollbar-thumb-hover": "var(--color-note-half-dark)",
                    }}
                  >
                    {filteredSongs.map((song) => (
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
              </>
            )}
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
