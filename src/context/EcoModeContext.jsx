import { createContext, useCallback, useContext, useState } from "react";
import { detectEcoMode, ECO_MODE_STORAGE_KEY } from "../libs/ecoMode.js";

/**
 * EcoModeContext
 *
 * Provides eco-mode state throughout the app:
 *   ecoMode        – the effective boolean (auto OR manual override)
 *   autoDetected   – what the auto-detector decided
 *   setManualEcoMode(v: boolean | null) – null = revert to auto-detection
 */
const EcoModeContext = createContext({
  ecoMode: false,
  autoDetected: false,
  setManualEcoMode: () => {},
});

export function EcoModeProvider({ children }) {
  // Lazy initializer — runs once on the client, never on the server (SSR-safe
  // because detectEcoMode() guards against missing navigator/window).
  const [autoDetected] = useState(() => detectEcoMode());

  // null  → follow auto-detection
  // true/false → user override
  // Lazy initializer restores any previously stored manual preference.
  const [manual, setManual] = useState(() => {
    try {
      const stored = sessionStorage.getItem(ECO_MODE_STORAGE_KEY);
      if (stored === "true") return true;
      if (stored === "false") return false;
      // "null" or missing → keep auto
    } catch {
      // sessionStorage may be unavailable in some iframe contexts
    }
    return null;
  });

  const setManualEcoMode = useCallback((value) => {
    setManual(value);
    try {
      if (value === null) {
        sessionStorage.removeItem(ECO_MODE_STORAGE_KEY);
      } else {
        sessionStorage.setItem(ECO_MODE_STORAGE_KEY, String(value));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const ecoMode = manual !== null ? manual : autoDetected;

  return (
    <EcoModeContext.Provider
      value={{ ecoMode, autoDetected, setManualEcoMode }}
    >
      {children}
    </EcoModeContext.Provider>
  );
}

/** Convenience hook — use anywhere inside <EcoModeProvider>. */
// eslint-disable-next-line react-refresh/only-export-components
export function useEcoMode() {
  return useContext(EcoModeContext);
}
