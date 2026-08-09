/**
 * Eco Mode Detection
 *
 * Detects low-end / mobile devices that should run with reduced audio and
 * visual effects to avoid frame drops and audio glitches.
 *
 * Heuristics (all are best-effort; API availability varies by browser):
 *   - Touch device          : navigator.maxTouchPoints > 1
 *   - Low CPU core count    : navigator.hardwareConcurrency <= 4
 *   - Low device memory     : navigator.deviceMemory <= 4  (Chrome only)
 *   - Small viewport        : window.innerWidth < 768
 *
 * Eco mode is activated when the device is a touch device AND at least one
 * of the other indicators is present.
 */
export function detectEcoMode() {
  if (typeof navigator === "undefined") return false;

  const isTouch = navigator.maxTouchPoints > 1;
  const lowCPU =
    navigator.hardwareConcurrency != null &&
    navigator.hardwareConcurrency <= 4;
  const lowMem =
    // deviceMemory is a Chrome-only API; treat undefined as "unknown" (not low)
    navigator.deviceMemory != null && navigator.deviceMemory <= 4;
  const smallScreen =
    typeof window !== "undefined" && window.innerWidth < 768;

  return isTouch && (lowCPU || lowMem || smallScreen);
}

/** Storage key used to persist the user's manual eco-mode preference. */
export const ECO_MODE_STORAGE_KEY = "synrecordia:ecoMode";
