import { useRef, useState, useEffect } from "react";
import { cn } from "../libs/utils";

export default function DuoSlideBar({
  value = 0,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
  thumbColors = {
    background: "bg-note-half",
    border: "border-note-half-dark",
    text: "text-main",
  },
  barColor = "bg-note-full",
  formatValue = (v) => Math.round(Number(v)),
}) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [internalValue, setInternalValue] = useState(Number(value));

  useEffect(() => {
    setInternalValue(Number(value));
  }, [value]);

  const pct = (() => {
    const v = Number.isFinite(internalValue) ? internalValue : min;
    const denom = max - min || 1;
    return Math.min(100, Math.max(0, ((v - min) / denom) * 100));
  })();

  function computeValueFromClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return min;

    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const raw = min + t * (max - min);
    const steps = Math.round((raw - min) / step);
    return Math.min(max, Math.max(min, min + steps * step));
  }

  function handlePointerDown(e) {
    if (disabled) return;
    e.preventDefault();
    draggingRef.current = true;

    // Capture pointer so we continue receiving events even when finger moves outside the button
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    e.currentTarget.setPointerCapture(e.pointerId);

    document.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    document.addEventListener("pointerup", handlePointerUp, { once: true });

    const next = computeValueFromClientX(e.clientX);
    onChange?.(next);
  }

  function handlePointerMove(e) {
    if (!draggingRef.current) return;
    e.preventDefault();
    const next = computeValueFromClientX(e.clientX);
    onChange?.(next);
  }

  function handlePointerUp() {
    draggingRef.current = false;
    document.removeEventListener("pointermove", handlePointerMove);
  }

  function handleTrackClick(e) {
    if (disabled) return;
    const next = computeValueFromClientX(e.clientX);
    onChange?.(next);
  }

  function handleKeyDown(e) {
    if (disabled) return;
    const key = e.key;
    let next = Number(internalValue || 0);

    if (key === "ArrowLeft" || key === "ArrowDown") next -= step;
    else if (key === "ArrowRight" || key === "ArrowUp") next += step;
    else if (key === "PageDown") next -= step * 10;
    else if (key === "PageUp") next += step * 10;
    else if (key === "Home") next = min;
    else if (key === "End") next = max;
    else return;

    e.preventDefault();
    next = Math.min(
      max,
      Math.max(min, Math.round((next - min) / step) * step + min),
    );
    onChange?.(next);
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className={cn(
          "relative h-3 rounded-full select-none touch-none bg-gray-200 active:bg-gray-300",
        )}
        aria-hidden
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", barColor)}
          style={{ width: `${pct}%` }}
        />

        <button
          type="button"
          role="slider"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Number(internalValue)}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={cn(
            "absolute top-1/2 -translate-y-3/5 -translate-x-1/2 flex items-center justify-center",
            "w-10 h-7 rounded-2xl border-b-4 font-bold text-sm cursor-pointer",
            "focus:outline-main shadow-md active:scale-110 transition-transform",
            thumbColors.background,
            thumbColors.text,
            thumbColors.border,
            disabled && "opacity-50 cursor-not-allowed",
          )}
          style={{ left: `${pct}%` }}
        >
          {formatValue(internalValue)}
        </button>
      </div>
    </div>
  );
}
