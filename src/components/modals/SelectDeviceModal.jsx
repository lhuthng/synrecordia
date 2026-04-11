import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { motion as Motion, AnimatePresence } from "motion/react";
import DuoButton from "../ui/DuoButton";
import DuoToggleButton from "../ui/DuoToggleButton";

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
    dim: "text-main/50",
    green: "text-green-400",
    red: "text-red-400",
  };
  return <p className={`text-sm ${colorMap[variant]}`}>{children}</p>;
}

function RequestingSpinner({ label }) {
  return <span className="text-sm text-main/60 animate-pulse">{label}</span>;
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
  onStopMicrophone,
  midiStatus,
  midiInputs,
  selectedMidiInput,
  onSelectMidiInput,
  onRequestMidi,
}) {
  const { t } = useTranslation();
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
                {t("playMode.modal.title")} {t("playMode.modal.experimental")}
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

            <Divider />

            {/* ── Microphone section ─────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {/* Label row */}
              <div className="flex items-center gap-1.5">
                <SectionLabel>
                  <svg
                    viewBox="-3 0 19 19"
                    className="inline w-8 fill-note-half-dark"
                  >
                    <path d="M11.665 7.915v1.31a5.257 5.257 0 0 1-1.514 3.694 5.174 5.174 0 0 1-1.641 1.126 5.04 5.04 0 0 1-1.456.384v1.899h2.312a.554.554 0 0 1 0 1.108H3.634a.554.554 0 0 1 0-1.108h2.312v-1.899a5.045 5.045 0 0 1-1.456-.384 5.174 5.174 0 0 1-1.641-1.126 5.257 5.257 0 0 1-1.514-3.695v-1.31a.554.554 0 1 1 1.109 0v1.31a4.131 4.131 0 0 0 1.195 2.917 3.989 3.989 0 0 0 5.722 0 4.133 4.133 0 0 0 1.195-2.917v-1.31a.554.554 0 1 1 1.109 0zM3.77 10.37a2.875 2.875 0 0 1-.233-1.146V4.738A2.905 2.905 0 0 1 3.77 3.58a3 3 0 0 1 1.59-1.59 2.902 2.902 0 0 1 1.158-.233 2.865 2.865 0 0 1 1.152.233 2.977 2.977 0 0 1 1.793 2.748l-.012 4.487a2.958 2.958 0 0 1-.856 2.09 3.025 3.025 0 0 1-.937.634 2.865 2.865 0 0 1-1.152.233 2.905 2.905 0 0 1-1.158-.233A2.957 2.957 0 0 1 3.77 10.37z"></path>
                  </svg>{" "}
                  {t("playMode.modal.microphone")}
                </SectionLabel>
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
                    {t("playMode.modal.requestPermission")}
                  </DuoButton>
                )}

                {micStatus === "requesting" && (
                  <RequestingSpinner label={t("playMode.modal.requesting")} />
                )}

                {micStatus === "granted" && (
                  <div className="flex items-center gap-3">
                    <StatusText variant="green">
                      ✓&nbsp;{micName ?? t("playMode.modal.microphone")}
                    </StatusText>
                    <DuoButton
                      padding="px-2 py-1"
                      className="text-sm w-fit"
                      background="bg-note-half"
                      shadowBackground="bg-note-half-dark"
                      border="border-note-half-dark"
                      text="text-main"
                      onClick={onStopMicrophone}
                    >
                      {t("playMode.modal.disconnect")}
                    </DuoButton>
                  </div>
                )}

                {micStatus === "denied" && (
                  <StatusText variant="red">
                    {t("playMode.modal.micDenied")}
                  </StatusText>
                )}
              </div>
            </div>

            <Divider />

            {/* ── MIDI section ────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {/* Label row */}
              <SectionLabel>
                <svg
                  viewBox="0 0 377.625 377.625"
                  className="inline w-8 fill-note-half-dark"
                >
                  <path d="m276.729,99.273l-87.916-99.273-87.917,99.273 72.917,53.03v74.206h-43.041v151.116h116.082v-151.116h-43.041v-74.206l72.916-53.03zm-59.875,248.352h-56.082v-91.116h56.082v91.116zm-28.041-302.375l43.562,49.188-43.562,31.681-43.562-31.681 43.562-49.188z"></path>
                </svg>{" "}
                {t("playMode.modal.midiController")}
              </SectionLabel>

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
                    {t("playMode.modal.requestMidi")}
                  </DuoButton>
                )}

                {midiStatus === "requesting" && (
                  <RequestingSpinner label={t("playMode.modal.requesting")} />
                )}

                {midiStatus === "denied" && (
                  <StatusText variant="red">
                    {t("playMode.modal.midiDenied")}
                  </StatusText>
                )}

                {midiStatus === "granted" && (
                  <>
                    {midiInputs.length === 0 ? (
                      <StatusText variant="dim">
                        {t("playMode.modal.noDevices")}
                      </StatusText>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {midiInputs.map((input) => {
                          const isSelected = selectedMidiInput?.id === input.id;
                          return (
                            <DuoToggleButton
                              key={input.id}
                              value={isSelected}
                              padding="px-2 py-1"
                              className="text-sm w-full text-left"
                              onToggle={() => onSelectMidiInput(input)}
                              offToggle={() => onSelectMidiInput(null)}
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
