import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { createPackedSampler } from "../../libs/packedSampler";

export default function InstrumentController({
  slot,
  name,
  register,
  deregister,
  onReady,
}) {
  const [ready, setReady] = useState(false);

  const packedSamplerRef = useRef(null);
  const registeredSamplerRef = useRef(null);

  useEffect(() => {
    let isCancelled = false;

    const cleanupCurrentInstance = () => {
      if (registeredSamplerRef.current && typeof deregister === "function") {
        deregister(registeredSamplerRef.current, () => {
          packedSamplerRef.current?.dispose();
        });
      } else {
        // Direct cleanup if no deregister callback
        packedSamplerRef.current?.dispose();
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

        packedSamplerRef.current = createPackedSampler(
          name,
          urls,
          baseUrl,
          () => {
            if (!isCancelled) {
              setReady(true);
              onReady?.();
            }
          },
        );

        const sampler = packedSamplerRef.current.getSampler();
        register?.(slot, sampler);
        registeredSamplerRef.current = sampler;
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
    <div>
      {name}-{slot}
    </div>
  );
}
