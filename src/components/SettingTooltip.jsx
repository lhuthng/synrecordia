import { useState, useRef, useEffect } from "react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { cn } from "../libs/utils";

/**
 * A small "?" circle that reveals a help tooltip on click / tap.
 * Touch-friendly: tap to open, tap outside to close (no hover dependency).
 * Positions the tooltip above the button by default.
 *
 * Props:
 *   children  — tooltip text/content
 *   className — extra classes on the outer wrapper
 */
export default function SettingTooltip({ children, className }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when a pointer-down event happens outside this component.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler, { capture: true });
    return () =>
      document.removeEventListener("pointerdown", handler, { capture: true });
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-flex shrink-0 items-center", className)}
    >
      {/* ── "?" trigger button ─────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center justify-center",
          "w-4 h-4 rounded-full",
          "border border-main/70 bg-main text-dark",
          "text-[10px] font-bold leading-none",
          "cursor-pointer select-none",
          "hover:brightness-110 active:scale-95 transition-all duration-75",
          "focus:outline-main",
        )}
      >
        ?
      </button>

      {/* ── Tooltip panel ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <Motion.div
            role="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className={cn(
              // Position above the button, centred horizontally
              "absolute bottom-full left-1/2 -translate-x-1/2 mb-2",
              "w-max max-w-52 z-50",
              "px-3 py-2 rounded-xl",
              // Match AdvancedSettingsModal panel style
              "bg-dark border-2 border-note-half-dark",
              "text-main text-xs text-center leading-snug",
              "shadow-[0_4px_16px_rgba(0,0,0,0.55)]",
              "pointer-events-none",
              "whitespace-normal",
            )}
          >
            {children}
            {/* Downward arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-note-half-dark" />
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
