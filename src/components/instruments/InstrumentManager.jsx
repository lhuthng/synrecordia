import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import {
  createPackedSampler,
  isSynthInstrument,
  createSynthInstrument,
  VISUALIZABLE_INSTRUMENTS,
  getSampleDir,
} from "../../libs/packedSampler/factory";
import { motion as Motion, AnimatePresence, useAnimate } from "motion/react";
import { cn, midiToNoteName } from "../../libs/utils";
import DuoSelect from "../DuoSelect";
import DuoButton from "../DuoButton";
import { useTranslation } from "react-i18next";
import { useEcoMode } from "../../context/EcoModeContext";

// ── NoteRangeBar ─────────────────────────────────────────────────────────────
function NoteRangeBar({ instrumentRange, trackRange, transpose }) {
  const effectiveTrackMin =
    trackRange != null ? trackRange.min + transpose : null;
  const effectiveTrackMax =
    trackRange != null ? trackRange.max + transpose : null;

  const hasInstr = !!instrumentRange;
  const hasTrack = effectiveTrackMin !== null && effectiveTrackMax !== null;

  if (!hasInstr && !hasTrack) return null;

  const globalMin = Math.min(
    hasInstr ? instrumentRange.min : Infinity,
    hasTrack ? effectiveTrackMin : Infinity,
  );
  const globalMax = Math.max(
    hasInstr ? instrumentRange.max : -Infinity,
    hasTrack ? effectiveTrackMax : -Infinity,
  );

  if (globalMin > globalMax) return null;

  const span = globalMax - globalMin || 1;

  // Build analytical segments from the union of both ranges
  const breakpoints = [
    ...new Set([
      globalMin,
      ...(hasInstr ? [instrumentRange.min, instrumentRange.max + 1] : []),
      ...(hasTrack ? [effectiveTrackMin, effectiveTrackMax + 1] : []),
      globalMax + 1,
    ]),
  ]
    .sort((a, b) => a - b)
    .filter((p) => p >= globalMin && p <= globalMax + 1);

  const segments = [];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const start = breakpoints[i];
    const end = breakpoints[i + 1] - 1;
    if (start > end) continue;
    const inInstr =
      hasInstr && start >= instrumentRange.min && end <= instrumentRange.max;
    const inTrack =
      hasTrack && start >= effectiveTrackMin && end <= effectiveTrackMax;
    segments.push({
      left: ((start - globalMin) / span) * 100,
      width: ((end - start + 1) / span) * 100,
      inInstr,
      inTrack,
    });
  }

  const instrLabel = hasInstr
    ? `${midiToNoteName(instrumentRange.min)}–${midiToNoteName(instrumentRange.max)}`
    : null;
  const trackLabel = hasTrack
    ? `${midiToNoteName(effectiveTrackMin)}–${midiToNoteName(effectiveTrackMax)}`
    : null;

  const tooltipParts = [
    instrLabel ? `Instrument: ${instrLabel}` : null,
    trackLabel ? `Track: ${trackLabel}` : null,
  ].filter(Boolean);

  return (
    <div className="w-24" title={tooltipParts.join(" | ")}>
      {/* Segmented comparison bar */}
      <div className="relative h-2 rounded-full overflow-hidden bg-white/10">
        {segments.map((seg, i) => {
          let colorClass = "";
          if (seg.inInstr && seg.inTrack) colorClass = "bg-note-full";
          else if (seg.inInstr) colorClass = "bg-accent-pink";
          else if (seg.inTrack) colorClass = "bg-amber-400";
          return (
            <div
              key={i}
              className={cn("absolute top-0 h-full", colorClass)}
              style={{
                left: `${seg.left}%`,
                width: `${seg.width}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── InstrumentManager ────────────────────────────────────────────────────────
const KNOWN_SYSTEMS = ["baroque", "german", "simple"];

const InstrumentManager = memo(function InstrumentManager({
  slot,
  name,
  toggle,
  callbacks,
  onToggleChanged,
  register,
  deregister,
  initialReady,
  handleAudioReady,
  flashCount = 0,
  trackNoteRange = null,
  transpose = 0,
  fingeringSystem = "baroque",
  recorderType = "tenor",
  onOutOfRange = undefined,
  muted = false,
  swappableInstruments = null,
  onSwapInstrument = undefined,
}) {
  const [samplerInstance, setSamplerInstance] = useState(null);
  const [scope, animate] = useAnimate();
  const { t } = useTranslation();
  const { ecoMode } = useEcoMode();

  const isReadyRef = useRef(false);
  const packedSamplerRef = useRef(null);
  const registeredSamplerRef = useRef(null);

  const [Presentation, setPresentation] = useState(null);

  const prevVolumeRef = useRef(null);

  // Popup panel
  const panelContainerRef = useRef(null);
  const [panelContentNode, setPanelContentNode] = useState(null);

  // Popup viewport clamping
  const panelRef = useRef(null);
  const [panelMarginLeft, setPanelMarginLeft] = useState(0);

  // ── Mute / unmute the sampler when the `muted` prop changes ──────────────
  useEffect(() => {
    if (!samplerInstance?.setVolume || !samplerInstance?.getVolume) return;

    if (muted) {
      // Save the original volume the first time we mute (don't overwrite on sampler reload)
      if (prevVolumeRef.current === null) {
        prevVolumeRef.current = samplerInstance.getVolume();
      }
      samplerInstance.setVolume(0);
    } else {
      // Restore the saved volume when unmuting
      if (prevVolumeRef.current !== null) {
        samplerInstance.setVolume(prevVolumeRef.current);
        prevVolumeRef.current = null;
      }
    }
  }, [muted, samplerInstance]);

  // ── Out-of-range detection ────────────────────────────────────────────────
  const samplerNoteRange =
    samplerInstance?.getNoteRange?.(fingeringSystem, recorderType) ?? null;

  const outOfRange = (() => {
    if (!samplerNoteRange || !trackNoteRange) return false;
    const effectiveMin = trackNoteRange.min + transpose;
    const effectiveMax = trackNoteRange.max + transpose;
    return (
      effectiveMin < samplerNoteRange.min || effectiveMax > samplerNoteRange.max
    );
  })();

  // For each known system, compute the semitone window [tMin, tMax] where
  // the system's range fully covers the track. Formula:
  //   track.min + t >= r.min  →  t >= r.min - track.min  (tMin)
  //   track.max + t <= r.max  →  t <= r.max - track.max  (tMax)
  // If tMin <= tMax the system is feasible; otherwise it's impossible.
  const alternatives = useMemo(() => {
    if (!samplerInstance || !trackNoteRange) return [];
    return KNOWN_SYSTEMS.flatMap((sys) => {
      // simple fingering is only available for tenor
      if (sys === "simple" && recorderType !== "tenor") return [];
      const r = samplerInstance.getNoteRange?.(sys, recorderType);
      if (!r) return [];
      const tMin = r.min - trackNoteRange.min;
      const tMax = r.max - trackNoteRange.max;
      if (tMin > tMax) return []; // impossible for this system at any transpose
      return [{ system: sys, tMin, tMax }];
    });
  }, [samplerInstance, trackNoteRange, recorderType]);

  const onOutOfRangeRef = useRef(onOutOfRange);
  useEffect(() => {
    onOutOfRangeRef.current = onOutOfRange;
  }, [onOutOfRange]);

  useEffect(() => {
    onOutOfRangeRef.current?.({ outOfRange, alternatives, slot });
  }, [outOfRange, alternatives, slot]);

  // ── Flash animation ───────────────────────────────────────────────────────
  useEffect(() => {
    if (flashCount === 0 || !scope.current) return;
    animate(
      scope.current,
      {
        scale: [1.05, 1],
        filter: ["brightness(1.2)", "brightness(1)"],
      },
      {
        duration: 0.25,
        ease: "easeOut",
      },
    );
  }, [flashCount, animate, scope]);

  // Close popup when clicking outside the entire InstrumentManager container
  useEffect(() => {
    if (!toggle) return;
    const handleOutside = (e) => {
      if (
        panelContainerRef.current &&
        !panelContainerRef.current.contains(e.target)
      ) {
        onToggleChanged(slot, false);
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [toggle, slot, onToggleChanged]);

  // Clamp the popup panel to stay within the viewport.
  // Runs synchronously after render (useLayoutEffect) so the correction is
  // applied before the browser paints — no visible jump.
  // Calling setState inside useLayoutEffect is the canonical pattern for
  // measurement-based layout corrections — the update is batched into the
  // same paint, so there is no cascading render or visible jump.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!toggle) {
      setPanelMarginLeft(0);
      return;
    }
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    if (rect.left < margin) {
      setPanelMarginLeft(margin - rect.left);
    } else if (rect.right > vw - margin) {
      setPanelMarginLeft(vw - margin - rect.right);
    } else {
      setPanelMarginLeft(0);
    }
  }, [toggle]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSamplerChanged = () => {
    const sampler = packedSamplerRef.current.getSampler();
    register?.(slot, sampler);
    handleAudioReady?.(true);
    isReadyRef.current = true;
  };

  useEffect(() => {
    let isCancelled = false;

    handleAudioReady?.(false);
    isReadyRef.current = false;

    const cleanupCurrentInstance = () => {
      setPresentation(null);

      if (registeredSamplerRef.current && typeof deregister === "function") {
        deregister(slot, () => {
          packedSamplerRef.current?.dispose();
          registeredSamplerRef.current?.dispose();
        });
      } else {
        packedSamplerRef.current?.dispose();
        registeredSamplerRef.current?.dispose();
      }

      packedSamplerRef.current = null;
      registeredSamplerRef.current = null;
    };

    const loadSampler = async () => {
      cleanupCurrentInstance();

      // ── Synthesizer instruments (no sample files needed) ─────────────────
      if (isSynthInstrument(name)) {
        const packedSampler = createSynthInstrument(
          name,
          () => {
            if (!isCancelled) {
              handleAudioReady?.(true);
              isReadyRef.current = true;
            }
          },
          ecoMode,
        );
        if (!packedSampler) return;

        packedSamplerRef.current = packedSampler;
        const sampler = packedSampler.getSampler();
        register?.(slot, sampler);
        registeredSamplerRef.current = sampler;
        setPresentation(() => packedSampler.getPresentation());
        setSamplerInstance(packedSampler);
        return;
      }

      // ── Sampler instruments (load from /samples/) ─────────────────────────
      try {
        const sampleDir = getSampleDir(name);
        const response = await fetch(`/samples/${sampleDir}/index.json`);
        if (!response.ok) return;

        const data = await response.json();
        const version = data.default || data.current;
        if (!version) return;

        const baseUrl = `/samples/${sampleDir}/${version}/`;
        const urlsResponse = await fetch(`${baseUrl}index.json`);
        if (!urlsResponse.ok) return;

        const urls = await urlsResponse.json();
        if (Object.keys(urls).length === 0) return;

        const packedSampler = createPackedSampler(
          name,
          urls,
          baseUrl,
          () => {
            if (!isCancelled) {
              handleAudioReady?.(true);
              isReadyRef.current = true;
            }
          },
          {
            name,
            alternatives: data,
            version,
            ecoMode,
          },
        );

        packedSamplerRef.current = packedSampler;

        const sampler = packedSamplerRef.current.getSampler();
        register?.(slot, sampler);
        registeredSamplerRef.current = sampler;
        setPresentation(() => packedSamplerRef.current.getPresentation());
        setSamplerInstance(packedSampler);
      } catch (e) {
        console.error("Failed to load sampler:", e);
      }
    };

    loadSampler();

    return () => {
      isCancelled = true;
      cleanupCurrentInstance();
    };
  }, [slot, name]);

  useEffect(() => {
    if (
      initialReady !== isReadyRef.current &&
      registeredSamplerRef.current !== null
    ) {
      handleAudioReady?.(isReadyRef.current);
    }
  }, [initialReady, handleAudioReady]);

  // ── Sync eco mode to the running sampler when the user toggles it ─────────
  useEffect(() => {
    samplerInstance?.setEcoMode?.(ecoMode);
  }, [ecoMode, samplerInstance]);

  // Build i18n-labelled options for the swap select
  const swapOptions = swappableInstruments
    ? swappableInstruments.map((n) => ({
        value: n,
        label: t(`instruments.${n}`),
      }))
    : [];
  const canSwap = swapOptions.length > 1;

  return (
    <AnimatePresence>
      {Presentation ? (
        <Motion.div
          key="container"
          initial={{ opacity: 0, x: -5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -5 }}
        >
          {/* Outer container — positioning anchor for the popup panel */}
          <div
            ref={panelContainerRef}
            className="relative inline-flex flex-col items-center gap-2"
          >
            {/* Instrument button with optional ⚠ badge */}
            <Motion.div
              key="button"
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
              }}
              ref={scope}
              className="relative inline-block"
            >
              <Presentation
                packedSampler={samplerInstance}
                label={slot + 1}
                toggle={toggle}
                isReady={!!initialReady}
                offReady={() => {
                  handleAudioReady?.(false);
                  isReadyRef.current = false;
                }}
                onToggleChanged={(value) => onToggleChanged(slot, value)}
                callbacks={callbacks}
                onSamplerChanged={handleSamplerChanged}
                controllerNode={panelContentNode}
                trackNoteRange={trackNoteRange}
                transpose={transpose}
                fingeringSystem={fingeringSystem}
                recorderType={recorderType}
                muted={muted}
              />
              {outOfRange && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-black text-xs font-bold leading-none cursor-help z-10 select-none shadow"
                  title="This instrument cannot play all notes in this track. Consider adjusting the transpose."
                >
                  ⚠
                </span>
              )}
            </Motion.div>

            {/* Range comparison bar — always shown when range data is available */}
            {(samplerNoteRange || trackNoteRange) && (
              <NoteRangeBar
                instrumentRange={samplerNoteRange}
                trackRange={trackNoteRange}
                transpose={transpose}
              />
            )}

            {/* ── Popup panel ── */}
            <AnimatePresence>
              {toggle && (
                <Motion.div
                  key="panel"
                  ref={panelRef}
                  style={{
                    marginLeft:
                      panelMarginLeft !== 0
                        ? `${panelMarginLeft}px`
                        : undefined,
                  }}
                  className={cn(
                    "absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 z-50",
                    "w-80 max-w-[calc(100dvw-2rem)]",
                    "border-2 border-note-half-dark bg-dark rounded-2xl",
                    "shadow-[0_8px_32px_rgba(0,0,0,0.55)] p-3",
                  )}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                >
                  {/* Panel header: name | swap selector | close */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-bold uppercase text-main tracking-wide text-sm select-none flex-1 truncate">
                      {t(`instruments.${name}`)}
                    </span>
                    {canSwap && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-main/50 select-none whitespace-nowrap">
                          {t("instruments.swap")}
                          {"→"}
                        </span>
                        <DuoSelect
                          options={swapOptions}
                          value={name}
                          padding="px-1.5 py-0.5"
                          onChange={onSwapInstrument}
                        />
                      </div>
                    )}
                    <DuoButton
                      padding="px-2 py-0.5"
                      background="bg-note-half"
                      shadowBackground="bg-note-half-dark"
                      border="border-note-half-dark"
                      text="text-main"
                      onClick={() => onToggleChanged(slot, false)}
                      aria-label="Close"
                    >
                      ✕
                    </DuoButton>
                  </div>

                  {/* Portal target — Presentation portals its controls here */}
                  <div ref={setPanelContentNode} />
                </Motion.div>
              )}
            </AnimatePresence>
          </div>
        </Motion.div>
      ) : (
        <></>
      )}
    </AnimatePresence>
  );
});
export default InstrumentManager;
