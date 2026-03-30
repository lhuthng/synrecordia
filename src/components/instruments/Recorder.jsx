import { createPortal } from "react-dom";
import Instrument from "./Instrument";
import { useState } from "react";
import { useEffect } from "react";
import { useCallback } from "react";
import DuoSlideBar from "../DuoSlideBar";

export default function Recorder({
  packedSampler: recorderSampler,
  label,
  toggle,
  callbacks,
  offReady,
  onToggleChanged,
  controllerNode,
  onSamplerChanged,
}) {
  const [volume, setVolume] = useState(0);

  const [version, setVersion] = useState(null);
  const [alternatives, setAlternatives] = useState([]);

  const [fingeringSystem, setFingeringSystem] = useState("recorder");
  const [fingeringSystems, _] = useState(["simple", "recorder"]);

  useEffect(() => {
    setVolume(recorderSampler.getVolume());
    setAlternatives(recorderSampler.getAlternatives());
    setVersion(recorderSampler.getVersion());
  }, [recorderSampler]);

  const handleVolumeChanged = useCallback(
    (value) => {
      setVolume(value);
      recorderSampler.setVolume(value);
    },
    [recorderSampler],
  );

  const handleVersionChanged = useCallback(
    (value) => {
      offReady?.();
      callbacks?.pausePlayback?.();
      setVersion(value);
      recorderSampler.setVersion(value, onSamplerChanged);
    },
    [recorderSampler, onSamplerChanged, callbacks],
  );

  const handleFingeringSystemChanged = useCallback(
    (value) => {
      setFingeringSystem(value);
      callbacks?.setFingeringSystem?.(value);
    },
    [callbacks],
  );

  return (
    <>
      <Instrument
        label={label}
        logo={
          <svg viewBox="0 0 220.219 220.219">
            <g>
              <path d="M218.314,26.91L193.309,1.904c-2.363-2.363-6.135-2.549-8.718-0.43l-41.783,34.27c-1.419,1.164-2.279,2.873-2.37,4.706 		c-0.073,1.493,0.378,2.95,1.246,4.143L21.855,168.035L2.644,182.188c-1.524,1.124-2.483,2.856-2.626,4.745s0.546,3.745,1.886,5.084 		l26.298,26.297c1.223,1.224,2.878,1.904,4.596,1.904c0.162,0,0.325-0.006,0.488-0.019c1.889-0.142,3.621-1.101,4.745-2.626 		l14.153-19.21l123.44-119.827c1.107,0.807,2.442,1.253,3.824,1.253c0.106,0,0.213-0.002,0.32-0.008 		c1.832-0.09,3.542-0.951,4.705-2.37l34.271-41.784C220.864,33.043,220.679,29.273,218.314,26.91z M42.743,189.411 		c-0.257,0.25-0.493,0.52-0.706,0.809l-9.988,13.558L16.441,188.17L30,178.182c0.288-0.213,0.559-0.449,0.809-0.706L150.815,53.85 		l3.306,3.305l12.249,12.249L42.743,189.411z M178.972,63.621l-22.373-22.374l31.683-25.986l16.677,16.676L178.972,63.621z" />
              <circle cx="120.982" cy="99.237" r="4.298" />
              <circle cx="104.329" cy="115.89" r="4.299" />
              <circle cx="87.675" cy="132.543" r="4.298" />
              <circle cx="71.022" cy="149.196" r="4.298" />
              <circle cx="48.314" cy="171.905" r="4.299" />
              <path d="M170.19,40.622c-1.561-1.562-4.096-1.562-5.656,0c-1.563,1.563-1.563,4.095,0,5.657l9.406,9.406 		c0.78,0.781,1.805,1.171,2.828,1.171s2.048-0.391,2.828-1.171c1.563-1.563,1.563-4.095,0-5.657L170.19,40.622z" />
            </g>
          </svg>
        }
        toggle={toggle}
        onToggleChanged={onToggleChanged}
      />
      {toggle &&
        controllerNode &&
        createPortal(
          <div className="flex flex-col gap-2 max-w-100 [&>*>label]:w-10">
            <div className="flex items-center gap-2">
              <label title="volume">Volume:</label>
              <div className="flex-1 mx-4">
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
            </div>
            <div className="flex items-center gap-2">
              <label title="variant">Variant:</label>
              <div className="flex-1 mx-4">
                <select
                  className="rounded-xl px-1 focus:outline-main"
                  value={version}
                  onChange={(e) => handleVersionChanged(e.target.value)}
                >
                  {alternatives.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label title="version">System:</label>
              <div className="flex-1 mx-4">
                <select
                  className="rounded-xl px-1 focus:outline-main"
                  value={fingeringSystem}
                  onChange={(e) => handleFingeringSystemChanged(e.target.value)}
                >
                  {fingeringSystems.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>,
          controllerNode,
        )}
    </>
  );
}
