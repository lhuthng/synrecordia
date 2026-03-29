import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { createPackedSampler } from "../../libs/packedSampler/factory";
import { useCallback } from "react";

export default function InstrumentManager({
  slot,
  name,
  toggle,
  callbacks,
  onToggleChanged,
  register,
  deregister,
  onReady,
  controllerNode,
}) {
  const [ready, setReady] = useState(false);
  const [samplerInstance, setSamplerInstance] = useState(null);

  const packedSamplerRef = useRef(null);
  const registeredSamplerRef = useRef(null);

  const [Presentation, setPresentation] = useState(null);

  const handleSamplerChanged = () => {
    const sampler = packedSamplerRef.current.getSampler();
    register?.(slot, sampler);
  };

  useEffect(() => {
    let isCancelled = false;

    const cleanupCurrentInstance = () => {
      setPresentation(null);

      if (registeredSamplerRef.current && typeof deregister === "function") {
        deregister(slot, () => {
          packedSamplerRef.current?.dispose();
          registeredSamplerRef.current?.dispose();
        });
      } else {
        // Direct cleanup if no deregister callback
        packedSamplerRef.current?.dispose();
        registeredSamplerRef.current?.dispose();
      }

      packedSamplerRef.current = null;
      registeredSamplerRef.current = null;
    };

    const loadSampler = async () => {
      // Always clean up previous instance first (fixes double register in StrictMode)
      cleanupCurrentInstance();

      setReady(false);

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
              setReady(true);
              onReady?.();
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

    // Cleanup when component unmounts or dependencies change
    return () => {
      isCancelled = true;
      cleanupCurrentInstance();
    };
  }, [slot, name]);

  return (
    <>
      {Presentation ? (
        <Presentation
          packedSampler={samplerInstance}
          label={slot}
          toggle={toggle}
          onToggleChanged={(value) => onToggleChanged(slot, value)}
          callbacks={callbacks}
          onSamplerChanged={handleSamplerChanged}
          controllerNode={controllerNode}
        />
      ) : (
        <div></div>
      )}
    </>
  );
}
