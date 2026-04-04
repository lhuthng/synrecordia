import { useEffect, useMemo, useRef, useState } from "react";
import { createPackedSampler } from "../../libs/packedSampler/factory";
import { motion as Motion, AnimatePresence, useAnimate } from "motion/react";
import { cn, midiToNoteName } from "../../libs/utils";

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

export default function InstrumentManager({
  slot,
  name,
  toggle,
  callbacks,
  onToggleChanged,
  register,
  deregister,
  initialReady,
  handleAudioReady,
  controllerNode,
  flashCount = 0,
  trackNoteRange = null,
  transpose = 0,
  fingeringSystem = "baroque",
  onOutOfRange = undefined,
}) {
  const [samplerInstance, setSamplerInstance] = useState(null);
  const [scope, animate] = useAnimate();

  const isReadyRef = useRef(false);
  const packedSamplerRef = useRef(null);
  const registeredSamplerRef = useRef(null);

  const [Presentation, setPresentation] = useState(null);

  // ── Out-of-range detection ────────────────────────────────────────────────
  const samplerNoteRange =
    samplerInstance?.getNoteRange?.(fingeringSystem) ?? null;

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
      const r = samplerInstance.getNoteRange?.(sys);
      if (!r) return [];
      const tMin = r.min - trackNoteRange.min;
      const tMax = r.max - trackNoteRange.max;
      if (tMin > tMax) return []; // impossible for this system at any transpose
      return [{ system: sys, tMin, tMax }];
    });
  }, [samplerInstance, trackNoteRange]);

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

      try {
        const response = await fetch(`/samples/${name}/index.json`);
        if (!response.ok) return;

        const data = await response.json();
        const version = data.default || data.current;
        if (!version) return;

        const baseUrl = `/samples/${name}/${version}/`;
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

  return (
    <AnimatePresence>
      {Presentation ? (
        <Motion.div
          key="container"
          initial={{ opacity: 0, x: -5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -5 }}
        >
          {/* Flex column: button on top, range bar + warning below */}
          <div className="inline-flex flex-col items-center gap-2">
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
                controllerNode={controllerNode}
                trackNoteRange={trackNoteRange}
                transpose={transpose}
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
          </div>
        </Motion.div>
      ) : (
        <></>
      )}
    </AnimatePresence>
  );
}
