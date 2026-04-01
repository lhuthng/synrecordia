import { useState, useRef, useEffect } from "react";
import { Activity } from "react";
import { cn } from "../libs/utils";

export default function DuoSelect({
  options = [],
  /** Controlled selected value. */
  value,
  /** Called with the new value string when the user picks an option. */
  onChange,
  disabled = false,
  className,
  padding = "px-3 py-1.5",
  /* ── Resting state colours ─────────────────────────────────────────── */
  background = "bg-note-half",
  shadowBackground = "bg-note-half-dark",
  border = "border-note-half-dark",
  text = "text-main",
  /* ── Open / selected state colours ────────────────────────────────── */
  activeBackground = "bg-note-full",
  activeShadowBackground = "bg-note-full-dark",
  activeBorder = "border-note-full-dark",
  activeText = "text-dark",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  /* Normalise plain strings to `{ value, label }` objects once. */
  const normalizedOptions = options.map((opt) =>
    typeof opt === "string" ? { value: opt, label: opt } : opt,
  );

  const selectedOption = normalizedOptions.find((o) => o.value === value);

  /* Colours swap when the panel is open, matching the "pressed" feel. */
  const triggerBg = isOpen ? activeBackground : background;
  const triggerBorder = isOpen ? activeBorder : border;
  const triggerText = isOpen ? activeText : text;
  const triggerShadow = isOpen ? activeShadowBackground : shadowBackground;

  /* ── Handlers ──────────────────────────────────────────────────────── */

  const handleSelect = (optValue) => {
    onChange?.(optValue);
    setIsOpen(false);
  };

  const handleTriggerClick = () => {
    if (!disabled) setIsOpen((v) => !v);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        setIsOpen((v) => !v);
        break;
      case "Escape":
        setIsOpen(false);
        break;
      case "ArrowDown":
      case "ArrowRight": {
        e.preventDefault();
        const idx = normalizedOptions.findIndex((o) => o.value === value);
        const next =
          normalizedOptions[Math.min(idx + 1, normalizedOptions.length - 1)];
        if (next && next.value !== value) onChange?.(next.value);
        break;
      }
      case "ArrowUp":
      case "ArrowLeft": {
        e.preventDefault();
        const idx = normalizedOptions.findIndex((o) => o.value === value);
        const prev = normalizedOptions[Math.max(idx - 1, 0)];
        if (prev && prev.value !== value) onChange?.(prev.value);
        break;
      }
      default:
        break;
    }
  };

  /* Close when the user clicks anywhere outside the component. */
  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block select-none", className)}
    >
      {/* ── Raised shadow layer (hidden when disabled) ────────────────── */}
      <Activity mode={disabled ? "hidden" : "visible"}>
        <div
          className={cn(
            "absolute inset-0 translate-y-0.5 rounded-2xl z-0 transition-colors duration-75",
            triggerShadow,
          )}
        />
      </Activity>

      {/* ── Trigger button ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "relative z-10 flex w-full items-center justify-between gap-2",
          "rounded-2xl border-2 font-bold uppercase cursor-pointer text-nowrap",
          "transition-all duration-75",
          "hover:brightness-110",
          "focus:outline-main",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-1",
          !isOpen && "active:translate-y-0.5",
          padding,
          triggerBg,
          triggerText,
          triggerBorder,
        )}
      >
        <span>{selectedOption?.label ?? value ?? "—"}</span>

        {/* Chevron — rotates 180° when open */}
        <svg
          className={cn(
            "w-3 h-3 shrink-0 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
          viewBox="0 0 10 6"
          fill="currentColor"
          aria-hidden
        >
          <path d="M0 0L5 6L10 0H0Z" />
        </svg>
      </button>

      {/* ── Dropdown panel ────────────────────────────────────────────── */}
      {isOpen && (
        <ul
          role="listbox"
          className={cn(
            "absolute left-0 top-[calc(100%+6px)] z-50 min-w-full",
            "overflow-hidden rounded-2xl border-2",
            "bg-dark border-note-half-dark",
            "shadow-[0_6px_20px_rgba(0,0,0,0.45)]",
          )}
        >
          {normalizedOptions.map((opt) => {
            const isSel = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSel}
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "cursor-pointer px-3 py-1.5 font-bold uppercase text-nowrap",
                  "transition-colors duration-75",
                  isSel
                    ? cn(activeBackground, activeText)
                    : cn(text, "hover:bg-note-half/50"),
                )}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
