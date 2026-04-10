import { createPortal } from "react-dom";
import Instrument from "./Instrument";
import { useState, useEffect, useCallback } from "react";
import DuoSlideBar from "../DuoSlideBar";
import DuoSelect from "../DuoSelect";
import { useTranslation } from "react-i18next";
import SettingTooltip from "../SettingTooltip";

const formatWeight = (v) => Number(v).toFixed(2);

// Mirrors the preset leftHandWeight / rightHandWeight values from
// GuitarMapper.js PRESETS.  Used to reset the sliders when the mode changes.
const MAPPER_PRESETS = {
  balanced: { leftHandWeight: 0.5, rightHandWeight: 0.5 },
  comfort: { leftHandWeight: 0.8, rightHandWeight: 0.3 },
  sustain: { leftHandWeight: 0.3, rightHandWeight: 0.8 },
};

export default function Guitar({
  packedSampler: guitarSampler,
  label,
  toggle,
  callbacks,
  offReady,
  onToggleChanged,
  controllerNode,
  onSamplerChanged,
  isReady,
  children,
}) {
  const { t } = useTranslation();

  const [volume, setVolume] = useState(0);
  const [version, setVersion] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [mode, setMode] = useState("balanced");
  const [leftHandWeight, setLeftHandWeight] = useState(
    MAPPER_PRESETS.balanced.leftHandWeight,
  );
  const [rightHandWeight, setRightHandWeight] = useState(
    MAPPER_PRESETS.balanced.rightHandWeight,
  );

  // Sync component state from the sampler on mount / sampler swap.
  // Also immediately notifies Player of the current mapper options so the
  // visualizer uses the correct settings from the very first render.
  // Calling setState inside useEffect is intentional here: we are reading from
  // an external object (the sampler instance) and hydrating local state — the
  // canonical use-case for useEffect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setVolume(guitarSampler.getVolume());
    setAlternatives(guitarSampler.getAlternatives());
    setVersion(guitarSampler.getVersion());

    const opts = guitarSampler.getMapperOptions();
    setMode(opts.mode);
    setLeftHandWeight(opts.leftHandWeight);
    setRightHandWeight(opts.rightHandWeight);
    callbacks?.setGuitarOptions?.(opts);
  }, [guitarSampler, callbacks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Audio handlers ──────────────────────────────────────────────────────────

  const handleVolumeChanged = useCallback(
    (value) => {
      setVolume(value);
      guitarSampler.setVolume(value);
    },
    [guitarSampler],
  );

  const handleVersionChanged = useCallback(
    (value) => {
      offReady?.();
      callbacks?.pausePlayback?.();
      setVersion(value);
      guitarSampler.setVersion(value, onSamplerChanged);
    },
    [offReady, callbacks, guitarSampler, onSamplerChanged],
  );

  // ── Mapper handlers ─────────────────────────────────────────────────────────

  const handleModeChanged = useCallback(
    (value) => {
      const preset = MAPPER_PRESETS[value] ?? MAPPER_PRESETS.balanced;
      const opts = {
        mode: value,
        leftHandWeight: preset.leftHandWeight,
        rightHandWeight: preset.rightHandWeight,
      };
      setMode(value);
      setLeftHandWeight(preset.leftHandWeight);
      setRightHandWeight(preset.rightHandWeight);
      guitarSampler.setMapperOptions(opts);
      callbacks?.setGuitarOptions?.(opts);
    },
    [guitarSampler, callbacks],
  );

  const handleLeftHandWeightChanged = useCallback(
    (value) => {
      setLeftHandWeight(value);
      const opts = { mode, leftHandWeight: value, rightHandWeight };
      guitarSampler.setMapperOptions(opts);
      callbacks?.setGuitarOptions?.(opts);
    },
    [mode, rightHandWeight, guitarSampler, callbacks],
  );

  const handleRightHandWeightChanged = useCallback(
    (value) => {
      setRightHandWeight(value);
      const opts = { mode, leftHandWeight, rightHandWeight: value };
      guitarSampler.setMapperOptions(opts);
      callbacks?.setGuitarOptions?.(opts);
    },
    [mode, leftHandWeight, guitarSampler, callbacks],
  );

  const modeOptions = [
    { value: "balanced", label: t("guitar.modes.balanced") },
    { value: "comfort", label: t("guitar.modes.comfort") },
    { value: "sustain", label: t("guitar.modes.sustain") },
  ];

  return (
    <>
      <Instrument
        label={label}
        logo={
          <svg viewBox="0 0 16 16">
            <path d="M14.17 3.59 16 1.76 14.24 0l-1.83 1.83v.85l-1.8 1.83a4.18 4.18 0 0 0-2.34-.85 3.73 3.73 0 0 0-2.8 1.07 4.61 4.61 0 0 0-1 1.34.79.79 0 0 1-.23.34 1.77 1.77 0 0 1-.39 0 2.8 2.8 0 0 0-2.46.84A4.73 4.73 0 0 0 0 10.8 5.46 5.46 0 0 0 5.38 16a4.76 4.76 0 0 0 3.39-1.38 2.8 2.8 0 0 0 .83-2.46 1.76 1.76 0 0 1 0-.39.85.85 0 0 1 .34-.23 4.42 4.42 0 0 0 1.34-1 3.71 3.71 0 0 0 1.07-2.79 4.11 4.11 0 0 0-.85-2.35l1.83-1.83zm-3.05 4.19a2.46 2.46 0 0 1-.72 1.88 3.23 3.23 0 0 1-1 .78 1.94 1.94 0 0 0-.69.47 1.57 1.57 0 0 0-.34 1.34 1.6 1.6 0 0 1-.48 1.51 3.86 3.86 0 0 1-5.44-.22 4.17 4.17 0 0 1-1.24-2.79 3.55 3.55 0 0 1 1-2.65 1.61 1.61 0 0 1 1.51-.48 1.56 1.56 0 0 0 1.34-.34 2.15 2.15 0 0 0 .48-.69 3 3 0 0 1 .77-1 2.47 2.47 0 0 1 1.88-.72 3 3 0 0 1 1.52.5L7.4 7.73l.88.88 2.34-2.35a3 3 0 0 1 .5 1.52z" />
            <path d="M5.83 8.33a1.76 1.76 0 0 0-1.29.51 1.82 1.82 0 0 0 0 2.57 1.88 1.88 0 0 0 1.38.59 1.75 1.75 0 0 0 1.24-.51 1.82 1.82 0 0 0 0-2.57 1.93 1.93 0 0 0-1.33-.59zm.47 2.27a.64.64 0 0 1-.9-.9.56.56 0 0 1 .38-.15.74.74 0 0 1 .45.2.6.6 0 0 1 .07.85z" />
          </svg>
        }
        toggle={toggle}
        onToggleChanged={onToggleChanged}
      />

      {controllerNode &&
        createPortal(
          <div className="flex flex-col gap-2 max-w-100">
            {children}
            <div className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
              {/* Volume */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("guitar.volume")}:</label>
                <SettingTooltip>{t("guitar.tips.volume")}</SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSlideBar
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  onChange={handleVolumeChanged}
                  thumbColors={{
                    background: "bg-note-half",
                    border: "border-note-half-dark",
                    text: "text-main",
                  }}
                  barColor="bg-note-full"
                />
              </div>

              {/* Variant */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("guitar.variant")}:</label>
                <SettingTooltip>{t("guitar.tips.variant")}</SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSelect
                  options={alternatives}
                  value={version}
                  padding="px-2"
                  onChange={handleVersionChanged}
                  disabled={!isReady}
                />
              </div>

              {/* ── Fret-mapper settings ──────────────────────────────────── */}
              <div className="col-span-2 border-t border-white/10 my-1" />

              {/* Mode */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("guitar.mapperMode")}:</label>
                <SettingTooltip>{t("guitar.tips.mapperMode")}</SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSelect
                  options={modeOptions}
                  value={mode}
                  padding="px-2"
                  onChange={handleModeChanged}
                />
              </div>

              {/* Left Hand Priority */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("guitar.leftHandPriority")}:</label>
                <SettingTooltip>
                  {t("guitar.tips.leftHandPriority")}
                </SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSlideBar
                  min={0}
                  max={2}
                  step={0.01}
                  value={leftHandWeight}
                  onChange={handleLeftHandWeightChanged}
                  formatValue={formatWeight}
                  thumbColors={{
                    background: "bg-note-half",
                    border: "border-note-half-dark",
                    text: "text-main",
                  }}
                  barColor="bg-note-full"
                />
              </div>

              {/* Right Hand Priority */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("guitar.rightHandPriority")}:</label>
                <SettingTooltip>
                  {t("guitar.tips.rightHandPriority")}
                </SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSlideBar
                  min={0}
                  max={2}
                  step={0.01}
                  value={rightHandWeight}
                  onChange={handleRightHandWeightChanged}
                  formatValue={formatWeight}
                  thumbColors={{
                    background: "bg-note-half",
                    border: "border-note-half-dark",
                    text: "text-main",
                  }}
                  barColor="bg-note-full"
                />
              </div>
            </div>
          </div>,
          controllerNode,
        )}
    </>
  );
}
