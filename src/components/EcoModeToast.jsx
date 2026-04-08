import { useState, useEffect, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useEcoMode } from "../context/EcoModeContext";
import { useTranslation } from "react-i18next";

const ECO_TOAST_KEY = "synrecordia:ecoToastShown";

export default function EcoModeToast() {
  const { autoDetected } = useEcoMode();
  const { t } = useTranslation();

  const [visible, setVisible] = useState(() => {
    if (!autoDetected) return false;
    try {
      return sessionStorage.getItem(ECO_TOAST_KEY) !== "true";
    } catch {
      // sessionStorage may be unavailable in some iframe/private contexts
      return true;
    }
  });

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      sessionStorage.setItem(ECO_TOAST_KEY, "true");
    } catch {
      // ignore storage errors
    }
  }, []);

  // Auto-dismiss after 7 seconds
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(dismiss, 7000);
    return () => clearTimeout(id);
  }, [visible, dismiss]);

  if (!autoDetected) return null;

  return (
    <AnimatePresence>
      {visible && (
        <Motion.div
          key="eco-toast"
          className="fixed top-20 inset-x-0 flex justify-center px-4 z-100 pointer-events-none"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
        >
          <div className="flex items-start gap-3 max-w-sm w-full rounded-xl bg-note-half border-2 border-note-half-dark px-4 py-3 text-main shadow-2xl backdrop-blur-sm pointer-events-auto">
            <span className="text-lg leading-none mt-0.5" aria-hidden="true">
              🌿
            </span>
            <div className="flex-1 text-note-half-dark">
              <p className="font-bold text-lg">
                {t("player.ecoMode")} {t("player.ecoModeAuto")}
              </p>
              <p className="opacity-75 mt-0.5 font-semibold text-base leading-relaxed">
                {t("ecoToast.message")}
              </p>
            </div>
            <button
              className="text-main/40 hover:text-main transition-colors cursor-pointer leading-none mt-0.5 shrink-0"
              onClick={dismiss}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
