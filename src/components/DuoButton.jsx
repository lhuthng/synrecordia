import { cn } from "../libs/utils";

export default function DuoButton({
  children,
  onClick,
  disabled,
  className,
  padding = "px-2 py-1.5",
  background = "bg-green-500",
  shadowBackground = "bg-green-700",
  border = "border-green-700",
  text = "text-white",
}) {
  return (
    <div className={cn("relative min-h-fit", className)}>
      {!disabled && (
        <div
          className={cn(
            "absolute inset-0 translate-y-0.5 rounded-2xl z-0",
            shadowBackground,
          )}
        />
      )}

      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "relative z-10 block w-full text-center rounded-2xl border-2 font-bold uppercase text-nowrap transition-all duration-75 cursor-pointer",

          padding,
          background,
          text,
          border,
          "hover:brightness-110",
          "active:translate-y-0.5",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-1",
          `focus:outline-main`,
        )}
      >
        {children}
      </button>
    </div>
  );
}
