import { createPortal } from "react-dom";
import Instrument from "../Instrument";
import { useState, useEffect, useCallback } from "react";
import DuoSlideBar from "../../components/ui/DuoSlideBar";
import DuoSelect from "../../components/ui/DuoSelect";
import { useTranslation } from "react-i18next";
import SettingTooltip from "../../components/ui/SettingTooltip";

export default function Harpsichord({
  packedSampler: harpsichordSampler,
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
    setVolume(harpsichordSampler.getVolume());
    setAlternatives(harpsichordSampler.getAlternatives());
    setVersion(harpsichordSampler.getVersion());
  }, [harpsichordSampler]);

  const handleVolumeChanged = useCallback(
    (value) => {
      setVolume(value);
      harpsichordSampler.setVolume(value);
    },
    [harpsichordSampler],
  );

  const handleVersionChanged = useCallback(
    (value) => {
      offReady?.();
      callbacks?.pausePlayback?.();
      setVersion(value);
      harpsichordSampler.setVersion(value, onSamplerChanged);
    },
    [offReady, callbacks, harpsichordSampler, onSamplerChanged],
  );

  return (
    <>
      <Instrument
        label={label}
        logo={
          <svg viewBox="0 0 512 512">
            <path d="M31.3 501H480.5c11.3 0 20.4 -9.1 20.4 -20.4v-449.2c0 -11.3 -9.1 -20.4 -20.4 -20.4h-449.2c-11.3 0 -20.4 9.1 -20.4 20.4V480.6c0 11.3 9.2 20.4 20.4 20.4M385.4 460.2h-60.6v-229.8c0 -16.7 13.6 -30.3 30.3 -30.3s30.3 13.6 30.3 30.3zm-50.7 -298c-29.3 8.8 -50.7 36 -50.7 68.2V460.2h-56.1v-229.8c0 -32.1 -21.4 -59.4 -50.7 -68.2v-110.4H334.7zm-178 37.9c16.7 0 30.3 13.6 30.3 30.3V460.2h-60.6v-229.8c0 -16.7 13.6 -30.3 30.3 -30.3M460.1 460.2h-33.8v-229.8c0 -32.1 -21.4 -59.4 -50.7 -68.2v-110.4H460.1zm-408.3 -408.4h84.6V162.2c-29.3 8.8 -50.7 36 -50.7 68.2V460.2h-33.8v-408.4z" />
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
                <label>{t("harpsichord.volume")}:</label>
                <SettingTooltip>{t("harpsichord.tips.volume")}</SettingTooltip>
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
                <label>{t("harpsichord.variant")}:</label>
                <SettingTooltip>{t("harpsichord.tips.variant")}</SettingTooltip>
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
