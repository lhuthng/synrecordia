import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import DuoButton from "./DuoButton";
import DuoToggleButton from "./DuoToggleButton";

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="border-t border-note-half-dark/50" />;
}

function SectionLabel({ children }) {
  return (
    <span className="text-sm font-semibold shrink-0 min-w-28">{children}</span>
  );
}

function StatusText({ children, variant = "dim" }) {
  const colorMap = {
    dim:   "text-main/50",
    green: "text-green-400",
    red:   "text-red-400",
  };
  return (
    <p className={`text-sm ${colorMap[variant]}`}>{children}</p>
  );
}

function RequestingSpinner() {
  return (
    <span className="text-sm text-main/60 animate-pulse">Requesting…</span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * SelectDeviceModal — lets the user grant microphone / MIDI access and choose
 * an active MIDI input device.  Follows the same portal + spring-animation
 * pattern as AdvancedSettingsModal.
 *
 * Props:
 *   isOpen              boolean
 *   onClose             () => void
 *   micStatus           null | 'requesting' | 'granted' | 'denied'
 *   micName             string | null
 *   onRequestMicrophone () => void
 *   midiStatus          null | 'requesting' | 'granted' | 'denied'
 *   midiInputs          MIDIInput[]
 *   selectedMidiInput   MIDIInput | null
 *   onSelectMidiInput   (input: MIDIInput | null) => void
 *   onRequestMidi       () => void
 */
export default function SelectDeviceModal({
  isOpen,
  onClose,
  micStatus,
  micName,
  onRequestMicrophone,
  midiStatus,
  midiInputs,
  selectedMidiInput,
  onSelectMidiInput,
  onRequestMidi,
}) {
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
          {/* ── Backdrop ───────────────────────────────────────────────── */}
          <Motion.div
            key="sdm-backdrop"
            className="fixed inset-0 z-40 bg-dark/40 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* ── Panel ──────────────────────────────────────────────────── */}
          <Motion.div
            key="sdm-panel"
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(90vw,440px)] text-main bg-dark border-2 border-note-half-dark rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-5 space-y-5"
            initial={{ opacity: 0, scale: 0.94, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <h2 className="font-bold uppercase text-main text-sm tracking-wide">
                Select Device
              </h2>
              <DuoButton
                padding="px-2 py-0.5"
                background="bg-note-half"
                shadowBackground="bg-note-half-dark"
                border="border-note-half-dark"
                text="text-main"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </DuoButton>
            </div>

            <Divider />

            {/* ── Microphone section ─────────────────────────────────── */}
            <div className="space-y-3">
              {/* Label row */}
              <div className="flex items-center gap-1.5">
                <SectionLabel>🎤 Microphone</SectionLabel>
                <span className="text-xs opacity-50">(Experimental)</span>
              </div>

              {/* Status / action */}
              <div className="pl-1">
                {micStatus === null && (
                  <DuoButton
                    padding="px-2 py-1"
                    className="text-sm w-fit"
                    background="bg-note-half"
                    shadowBackground="bg-note-half-dark"
                    border="border-note-half-dark"
                    text="text-main"
                    onClick={onRequestMicrophone}
                  >
                    Request Permission
                  </DuoButton>
                )}

                {micStatus === "requesting" && <RequestingSpinner />}

                {micStatus === "granted" && (
                  <StatusText variant="green">
                    ✓&nbsp;{micName ?? "Microphone"}
                  </StatusText>
                )}

                {micStatus === "denied" && (
                  <StatusText variant="red">
                    Permission denied. Enable microphone access in your browser
                    settings.
                  </StatusText>
                )}
              </div>
            </div>

            <Divider />

            {/* ── MIDI section ────────────────────────────────────────── */}
            <div className="space-y-3">
              {/* Label row */}
              <SectionLabel>🎹 MIDI Controller</SectionLabel>

              {/* Status / action */}
              <div className="pl-1">
                {midiStatus === null && (
                  <DuoButton
                    padding="px-2 py-1"
                    className="text-sm w-fit"
                    background="bg-note-half"
                    shadowBackground="bg-note-half-dark"
                    border="border-note-half-dark"
                    text="text-main"
                    onClick={onRequestMidi}
                  >
                    Request MIDI Access
                  </DuoButton>
                )}

                {midiStatus === "requesting" && <RequestingSpinner />}

                {midiStatus === "denied" && (
                  <StatusText variant="red">MIDI access denied.</StatusText>
                )}

                {midiStatus === "granted" && (
                  <>
                    {midiInputs.length === 0 ? (
                      <StatusText variant="dim">
                        No MIDI devices found. Plug in a device and reopen.
                      </StatusText>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {midiInputs.map((input) => {
                          const isSelected =
                            selectedMidiInput?.id === input.id;
                          return (
                            <DuoToggleButton
                              key={input.id}
                              value={isSelected}
                              padding="px-2 py-1"
                              className="text-sm w-full text-left"
                              onToggle={() => onSelectMidiInput(input)}
                              offToggle={() => onSelectMidiInput(null)}
                              onColors={{
                                background:       "bg-note-full",
                                shadowBackground: "bg-note-full-dark",
                                border:           "border-note-full-dark",
                                text:             "text-dark",
                              }}
                              offColors={{
                                background:       "bg-note-half",
                                shadowBackground: "bg-note-half-dark",
                                border:           "border-note-half-dark",
                                text:             "text-main",
                              }}
                            >
                              {input.name ?? `Device ${input.id}`}
                            </DuoToggleButton>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
