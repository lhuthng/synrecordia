import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import DuoSlideBar from "./DuoSlideBar";
import DuoButton from "./DuoButton";

export default function AdvancedSettingsModal({
  isOpen,
  onClose,
  noteWidth,
  onNoteWidthChange,
  latencyMs,
  onLatencyChange,
}) {
  const { t } = useTranslation();
  const panelRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <Motion.div
            key="adv-backdrop"
            className="fixed inset-0 z-40 bg-dark/40 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Panel */}
          <Motion.div
            key="adv-panel"
            ref={panelRef}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,420px)] text-main bg-dark border-2 border-note-half-dark rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-5 space-y-5"
            initial={{ opacity: 0, scale: 0.94, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="font-bold uppercase text-main text-sm tracking-wide">
                {t("player.advancedSettings")}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-full text-main/60 hover:text-main hover:bg-note-half transition-colors duration-100 text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Note Width */}
            <div className="flex items-center gap-2">
              <label className="shrink-0 min-w-20 text-sm" title="note width">
                {t("player.noteWidth")}:
              </label>
              <div className="flex-1 mx-2">
                <DuoSlideBar
                  min={40}
                  max={200}
                  step={1}
                  value={noteWidth}
                  onChange={onNoteWidthChange}
                  thumbColors={{
                    background: "bg-note-half",
                    border: "border-note-half-dark",
                    text: "text-main",
                  }}
                  barColor="bg-note-full"
                />
              </div>
            </div>

            {/* Latency Calibration */}
            <div className="flex items-center gap-2">
              <label
                className="shrink-0 min-w-20 text-sm"
                title="latency calibration"
              >
                {t("player.latencyCalibration")}:
              </label>
              <div className="flex flex-1 items-center gap-4 mx-2">
                <DuoSlideBar
                  min={0}
                  max={200}
                  step={1}
                  value={latencyMs}
                  onChange={onLatencyChange}
                  thumbColors={{
                    background:
                      latencyMs !== 0 ? "bg-amber-400" : "bg-note-half",
                    border:
                      latencyMs !== 0
                        ? "border-amber-600"
                        : "border-note-half-dark",
                    text: latencyMs !== 0 ? "text-black" : "text-main",
                  }}
                  barColor={
                    latencyMs !== 0 ? "bg-amber-400/60" : "bg-note-full"
                  }
                />
                <DuoButton
                  className="text-sm shrink-0"
                  text="text-main"
                  background="bg-note-half"
                  padding="px-1.5"
                  shadowBackground="bg-note-half-dark"
                  border="border-note-half-dark"
                  onClick={() => onLatencyChange(0)}
                  disabled={latencyMs === 0}
                >
                  {t("player.reset")}
                </DuoButton>
              </div>
            </div>
          </Motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
