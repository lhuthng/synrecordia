import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import DuoSelect from "./DuoSelect";
import DuoButton from "./DuoButton";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "vi", label: "Tiếng Việt" },
];

export default function Header() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language?.split("-")[0] ?? "en";

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
    <header className="w-cap py-2 px-4 flex items-center justify-between bg-dark select-none">
      {/* Left spacer to balance the centered logo */}
      <div className="w-24" />

      {/* Centered logo */}
      <Link
        to="/"
        className="text-white text-4xl font-bold cursor-pointer select-none px-2 focus:outline-main rounded-xl"
      >
        <span className="text-note-full">Syn</span>
        <span className="text-note-half">Recordia</span>
      </Link>

      {/* Right: language controls */}
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
            <div className="absolute right-0 top-[calc(100%+6px)] z-50">
              <DuoSelect
                options={LANGUAGE_OPTIONS}
                value={currentLang}
                onChange={handleLangChange}
                padding="px-2 py-1"
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
