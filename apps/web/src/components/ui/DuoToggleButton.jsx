import { useState } from "react";
import { cn } from "../../libs/utils";

export default function DuoToggleButton({
  children,
  onToggle,
  offToggle,
  disabled,
  className,
  padding = "px-2 py-1.5",
  onColors = {
    background: "bg-green-500",
    shadowBackground: "bg-green-700",
    border: "border-green-700",
    text: "text-white",
  },
  offColors = {
    background: "bg-gray-200",
    shadowBackground: "bg-gray-400",
    border: "border-gray-400",
    text: "text-black",
  },
  initial = false,
  // controlled value prop
  value,
  // optional generic change handler for controlled usage
  onChange,
}) {
  const isControlled = value !== undefined;
  const [internalOn, setInternalOn] = useState(Boolean(initial));
  const isOn = isControlled ? Boolean(value) : internalOn;

  const current = isOn ? onColors : offColors;
  const { background, shadowBackground, border, text } = current;

  function handleClick(e) {
    if (disabled) return;
    const next = !isOn;

    if (!isControlled) {
      setInternalOn(next);
    }

    if (next) {
      if (typeof onToggle === "function") onToggle(e);
    } else {
      if (typeof offToggle === "function") offToggle(e);
    }

    if (typeof onChange === "function") {
      onChange(next, e);
    }
  }

  return (
    <div className={cn("relative min-h-fit", className)}>
      {!disabled && (
        <div
          className={cn(
            "absolute inset-0 rounded-2xl translate-y-0.5 z-0",
            "transition-colors duration-75",
            shadowBackground,
          )}
        />
      )}
      <button
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={isOn}
        className={cn(
          "relative z-10 block w-full text-center rounded-2xl border-2 font-bold uppercase text-nowrap transition-all duration-75 cursor-pointer overflow-hidden",
          padding,
          background,
          text,
          border,
          "transition-all duration-75",
          "hover:brightness-110",
          "active:translate-y-0.5",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-1",
          `focus:outline-main`,
        )}
      >
        {children ?? (isOn ? "On" : "Off")}
      </button>
    </div>
  );
}
