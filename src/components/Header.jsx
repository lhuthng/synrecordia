import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import DuoSelect from "./DuoSelect";
import DuoButton from "./DuoButton";
import { useMobileMenu } from "../context/useMobileMenu";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "vi", label: "Tiếng Việt" },
];

export default function Header() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language?.split("-")[0] ?? "en";

  const { extraContent } = useMobileMenu();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleOutside = (e) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [mobileMenuOpen]);

  const handleLangChange = (code) => {
    if (!code) return;
    i18next.changeLanguage(code);
    setMobileMenuOpen(false);
  };

  return (
    <header className="relative z-10 w-cap px-4 select-none bg-dark/60 backdrop-blur-sm">
      {/* ── Main row ───────────────────────────────────────────────────────── */}
      <div className="py-3 flex items-center justify-between">
        {/* Left spacer to keep logo visually centred */}
        <div className="w-24" />

        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <Link
          to="/"
          className="flex flex-col items-center gap-0.5 cursor-pointer px-2 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-note-full"
        >
          <span
            className="text-4xl font-bold leading-none tracking-tight"
            style={{
              textShadow:
                "0 0 16px var(--color-note-full), 0 0 42px color-mix(in srgb, var(--color-note-half) 55%, transparent)",
            }}
          >
            <span className="text-note-full">Syn</span>
            <span className="text-note-half">Recordia</span>
          </span>

          {/* Tagline */}
          <span
            className="text-dim font-iosevka uppercase"
            style={{ fontSize: "0.58rem", letterSpacing: "0.28em" }}
          >
            recorder visualizer
          </span>
        </Link>

        {/* ── Language controls ─────────────────────────────────────────────── */}
        <div className="w-24 flex justify-end items-center">
          {/* Desktop: show DuoSelect directly */}
          <div className="hidden sm:block">
            <DuoSelect
              options={LANGUAGE_OPTIONS}
              value={currentLang}
              onChange={handleLangChange}
              padding="px-2 py-1"
              className="min-w-28"
            />
          </div>

          {/* Mobile: hamburger that reveals a small panel containing DuoSelect */}
          <div className="relative sm:hidden" ref={mobileMenuRef}>
            <DuoButton
              padding="px-2 py-1.5"
              background="bg-note-half"
              shadowBackground="bg-note-half-dark"
              border="border-note-half-dark"
              text="text-main"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={t("header.changeLanguage")}
              aria-expanded={mobileMenuOpen}
            >
              <svg
                viewBox="0 0 20 14"
                className="w-5 h-3.5 fill-current"
                aria-hidden="true"
              >
                <rect y="0" width="20" height="2" rx="1" />
                <rect y="6" width="20" height="2" rx="1" />
                <rect y="12" width="20" height="2" rx="1" />
              </svg>
            </DuoButton>

            {mobileMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 flex flex-col gap-2 min-w-40 border-2 border-note-half-dark bg-dark rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.55)] p-3">
                <DuoSelect
                  options={LANGUAGE_OPTIONS}
                  value={currentLang}
                  onChange={handleLangChange}
                  padding="px-2 py-1"
                />
                {extraContent && (
                  <div className="border-t border-note-half-dark pt-2">
                    {extraContent}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Horizon gradient rule ──────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          opacity: 0.7,
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-note-half-dark) 18%, var(--color-note-full) 50%, var(--color-accent-pink) 82%, transparent 100%)",
        }}
      />
    </header>
  );
}
