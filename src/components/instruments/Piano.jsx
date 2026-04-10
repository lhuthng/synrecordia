import { createPortal } from "react-dom";
import Instrument from "./Instrument";
import { useState } from "react";
import DuoSlideBar from "../DuoSlideBar";
import DuoSelect from "../DuoSelect";
import { useCallback } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import SettingTooltip from "../SettingTooltip";

export default function Piano({
  packedSampler: pianoSampler,
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

  useEffect(() => {
    setVolume(pianoSampler.getVolume());
    setAlternatives(pianoSampler.getAlternatives());
    setVersion(pianoSampler.getVersion());
  }, [pianoSampler]);

  const handleVolumeChanged = useCallback(
    (value) => {
      setVolume(value);
      pianoSampler.setVolume(value);
    },
    [pianoSampler],
  );
  const handleVersionChanged = useCallback(
    (value) => {
      offReady?.();
      callbacks?.pausePlayback?.();
      setVersion(value);
      pianoSampler.setVersion(value, onSamplerChanged);
    },
    [offReady, callbacks, pianoSampler, onSamplerChanged],
  );

  return (
    <>
      <Instrument
        label={label}
        logo={
          <svg viewBox="0 0 512 512">
            <g>
              <g>
                <path d="m480.7,11h-449.2c-11.3,0-20.4,9.1-20.4,20.4v449.2c0,11.3 9.1,20.4 20.4,20.4h449.2c11.3,0 20.4-9.1 20.4-20.4v-449.2c5.68434e-14-11.3-9.2-20.4-20.4-20.4zm-354.1,40.8h60.6v229.8c0,16.7-13.6,30.3-30.3,30.3-16.7,0-30.3-13.6-30.3-30.3v-229.8zm50.7,298c29.3-8.8 50.7-36 50.7-68.2v-229.8h56.1v229.8c0,32.1 21.4,59.4 50.7,68.2v110.4h-157.5v-110.4zm178-37.9c-16.7,0-30.3-13.6-30.3-30.3v-229.8h60.6v229.8c0,16.7-13.6,30.3-30.3,30.3zm-303.4-260.1h33.8v229.8c0,32.1 21.4,59.4 50.7,68.2v110.4h-84.5v-408.4zm408.3,408.4h-84.6v-110.4c29.3-8.8 50.7-36 50.7-68.2v-229.8h33.8v408.4z" />
              </g>
            </g>
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
                <label>{t("piano.volume")}:</label>
                <SettingTooltip>{t("piano.tips.volume")}</SettingTooltip>
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
                <label>{t("piano.variant")}:</label>
                <SettingTooltip>{t("piano.tips.variant")}</SettingTooltip>
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
            </div>
          </div>,
          controllerNode,
        )}
    </>
  );
}
