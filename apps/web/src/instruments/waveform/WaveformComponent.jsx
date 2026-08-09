import { createPortal } from "react-dom";
import Instrument from "../Instrument";
import { useState, useEffect, useCallback, useMemo } from "react";
import DuoSlideBar from "../../components/ui/DuoSlideBar";
import DuoSelect from "../../components/ui/DuoSelect";
import { useTranslation } from "react-i18next";
import SettingTooltip from "../../components/ui/SettingTooltip";

export default function Waveform({
  packedSampler: waveformSynth,
  label,
  toggle,
  callbacks,
  onToggleChanged,
  controllerNode,
  onSamplerChanged,
  children,
}) {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(0);
  const [version, setVersion] = useState(null);
  const [alternatives, setAlternatives] = useState([]);

  useEffect(() => {
    setVolume(waveformSynth.getVolume());
    setAlternatives(waveformSynth.getAlternatives());
    setVersion(waveformSynth.getVersion());
  }, [waveformSynth]);

  const waveformOptions = useMemo(
    () =>
      alternatives.map((v) => ({ value: v, label: t(`waveform.types.${v}`) })),
    [alternatives, t],
  );

  const handleVolumeChanged = useCallback(
    (value) => {
      setVolume(value);
      waveformSynth.setVolume(value);
    },
    [waveformSynth],
  );

  const handleVersionChanged = useCallback(
    (value) => {
      callbacks?.pausePlayback?.();
      setVersion(value);
      waveformSynth.setVersion(value, onSamplerChanged);
    },
    [callbacks, waveformSynth, onSamplerChanged],
  );

  return (
    <>
      <Instrument
        label={label}
        logo={
          <svg
            viewBox="0 -63 1019 1019"
            style={{
              shapeRendering: "geometricPrecision",
              textRendering: "geometricPrecision",
              imageRendering: "optimizeQuality",
            }}
          >
            <polygon
              className="fill-none!"
              points="828,0 828,65 893,65 893,130 958,130 958,260 763,260 763,386 828,386 828,451 891,451 891,386 958,386 1019,386 1019,511 954,511 954,576 1019,576 1019,832 954,832 954,893 698,893 698,832 635,832 635,893 461,893 461,832 252,832 252,893 0,893 0,771 61,771 61,702 0,702 0,451 61,451 61,386 126,386 126,191 191,191 191,130 252,130 252,65 317,65 317,0 507,0 507,65 572,65 572,0"
              fillRule="evenodd"
              clipRule="evenodd"
            />
            <path
              d="M317 65l190 0 65 0 256 0 65 0 0 65 65 0 0 65 0 65 -65 0 -130 0 0 61 0 65 65 0 0 65 61 0 0 -65 65 0 65 0 0 65 0 60 -65 0 0 65 65 0 0 256 -65 0 -191 0 0 -65 61 0 0 -61 -61 0 0 61 -65 0 0 -61 -63 0 0 126 -128 0 0 -61 -61 0 -320 0 0 -69 -65 0 -61 0 0 -251 61 0 65 0 65 0 0 125 -65 0 0 -125 0 -65 65 0 0 -195 63 0 0 -61 63 0 0 -65zm125 511l65 0 0 -125 -65 0 0 125zm-129 126l129 0 0 -65 -129 0 0 -65 -61 0 0 65 -61 0 0 65 61 0 0 -65 61 0 0 65zm4 -381l-65 0 0 65 65 0 0 -65 0 -61 125 0 0 -69 -61 0 0 -61 61 0 65 0 65 0 0 -65 0 -65 256 0 0 65 0 65 65 0 0 65 -130 0 0 -65 -65 0 0 65 0 65 -61 0 0 61 61 0 0 65 65 0 0 65 65 0 0 60 61 0 0 65 65 0 0 256 0 61 -191 0 -65 0 0 -61 -63 0 0 61 -128 0 -61 0 0 -61 -194 0 0 61 -191 0 -61 0 0 -61 0 -61 61 0 0 -69 0 -251 0 -65 65 0 0 -195 65 0 0 -61 61 0 0 -65 65 0 0 -65 190 0 0 65 0 65 0 61 0 69 0 61 -65 0 -125 0zm-191 450l0 61 -65 0 0 -61 65 0zm828 -260l0 -60 -65 0 0 60 65 0z"
              fillRule="evenodd"
              clipRule="evenodd"
            />
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
                <label>{t("waveform.volume")}:</label>
                <SettingTooltip>{t("waveform.tips.volume")}</SettingTooltip>
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

              {/* Waveform */}
              <div className="flex items-center gap-1 whitespace-nowrap">
                <label>{t("waveform.waveform")}:</label>
                <SettingTooltip>{t("waveform.tips.waveform")}</SettingTooltip>
              </div>
              <div className="min-w-0">
                <DuoSelect
                  options={waveformOptions}
                  value={version}
                  padding="px-2"
                  onChange={handleVersionChanged}
                />
              </div>
            </div>
          </div>,
          controllerNode,
        )}
    </>
  );
}
