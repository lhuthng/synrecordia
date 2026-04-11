import { cn } from "../libs/utils";
import DuoToggleButton from "../components/ui/DuoToggleButton";

export default function Instrument({ label, logo, toggle, onToggleChanged }) {
  return (
    <DuoToggleButton
      value={toggle}
      className="w-24 h-24"
      padding=""
      onColors={{
        background: "bg-note-full",
        shadowBackground: "bg-note-full-dark",
        border: "border-note-full-dark",
        text: "text-main",
      }}
      offColors={{
        background: "bg-note-half",
        shadowBackground: "bg-note-half-dark",
        border: "border-note-half-dark",
        text: "text-main",
      }}
      onToggle={() => onToggleChanged(true)}
      offToggle={() => onToggleChanged(false)}
    >
      <div
        className={cn(
          "absolute w-7 h-7",
          "text-xl",
          "border-r-3 border-b-3 rounded-br-2xl",
          "transition-colors duration-75",
          "text-note-sub/70 bg-sub/70",
          toggle ? " border-note-full-dark" : " border-note-half-dark",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "px-2 py-1.5",
          "[&>svg]:transition-colors [&>svg]:duration-75",
          toggle
            ? "[&>svg]:fill-note-full-dark"
            : "[&>svg]:fill-note-half-dark",
        )}
      >
        {logo}
      </div>
    </DuoToggleButton>
  );
}
