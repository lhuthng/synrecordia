import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import DuoSlideBar from "./DuoSlideBar";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";
import SettingTooltip from "./SettingTooltip";

export default function AdvancedSettingsModal({
  isOpen,
  onClose,
  latencyMs,
  onLatencyChange,
  particlesEnabled,
  onParticlesToggle,
  pulseEnabled,
  onPulseToggle,
  ambientEnabled,
  onAmbientToggle,
  ecoMode,
  autoEcoMode,
  onEcoModeToggle,
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
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,440px)] text-main bg-dark border-2 border-note-half-dark rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-5 space-y-5"
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
              <DuoButton
                padding="px-2 py-0.5"
                background="bg-note-half"
                shadowBackground="bg-note-half-dark"
                border="border-note-half-dark"
                text="text-main"
                onClick={onClose}
                aria-label={t("player.close")}
              >
                ✕
              </DuoButton>
            </div>

            {/* Divider */}
            <div className="border-t border-note-half-dark/50" />

            {/* Particles toggle */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 shrink-0 min-w-28">
                <label className="text-sm">{t("player.particles")}:</label>
                <SettingTooltip>{t("player.tips.particles")}</SettingTooltip>
              </div>
              <DuoToggleButton
                value={particlesEnabled}
                onToggle={() => onParticlesToggle(true)}
                offToggle={() => onParticlesToggle(false)}
                onColors={{
                  background: "bg-note-full",
                  shadowBackground: "bg-note-full-dark",
                  border: "border-note-full-dark",
                  text: "text-dark",
                }}
                offColors={{
                  background: "bg-note-half",
                  shadowBackground: "bg-note-half-dark",
                  border: "border-note-half-dark",
                  text: "text-main",
                }}
              />
            </div>

            {/* Pulse effect toggle */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 shrink-0 min-w-28">
                <label className="text-sm">{t("player.pulseEffect")}:</label>
                <SettingTooltip>{t("player.tips.pulse")}</SettingTooltip>
              </div>
              <DuoToggleButton
                value={pulseEnabled}
                onToggle={() => onPulseToggle(true)}
                offToggle={() => onPulseToggle(false)}
                onColors={{
                  background: "bg-note-full",
                  shadowBackground: "bg-note-full-dark",
                  border: "border-note-full-dark",
                  text: "text-dark",
                }}
                offColors={{
                  background: "bg-note-half",
                  shadowBackground: "bg-note-half-dark",
                  border: "border-note-half-dark",
                  text: "text-main",
                }}
              />
            </div>

            {/* Ambient glow toggle */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 shrink-0 min-w-28">
                <label className="text-sm">{t("player.ambient")}:</label>
                <SettingTooltip>{t("player.tips.ambient")}</SettingTooltip>
              </div>
              <DuoToggleButton
                value={ambientEnabled}
                onToggle={() => onAmbientToggle(true)}
                offToggle={() => onAmbientToggle(false)}
                onColors={{
                  background: "bg-note-full",
                  shadowBackground: "bg-note-full-dark",
                  border: "border-note-full-dark",
                  text: "text-dark",
                }}
                offColors={{
                  background: "bg-note-half",
                  shadowBackground: "bg-note-half-dark",
                  border: "border-note-half-dark",
                  text: "text-main",
                }}
              />
            </div>

            {/* Eco mode toggle */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 shrink-0 min-w-28">
                <label className="text-sm">{t("player.ecoMode")}:</label>
                <SettingTooltip>{t("player.tips.ecoMode")}</SettingTooltip>
              </div>
              <div className="flex items-center gap-2">
                <DuoToggleButton
                  value={ecoMode}
                  onToggle={() => onEcoModeToggle(true)}
                  offToggle={() => onEcoModeToggle(false)}
                  onColors={{
                    background: "bg-note-full",
                    shadowBackground: "bg-note-full-dark",
                    border: "border-note-full-dark",
                    text: "text-dark",
                  }}
                  offColors={{
                    background: "bg-note-half",
                    shadowBackground: "bg-note-half-dark",
                    border: "border-note-half-dark",
                    text: "text-main",
                  }}
                />
                {autoEcoMode && (
                  <span className="text-xs opacity-60 italic">
                    {t("player.ecoModeAuto")}
                  </span>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-note-half-dark/50" />

            {/* Latency Calibration */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 shrink-0 min-w-28">
                <label className="text-sm">
                  {t("player.latencyCalibration")}:
                </label>
                <SettingTooltip>{t("player.tips.latency")}</SettingTooltip>
              </div>
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
