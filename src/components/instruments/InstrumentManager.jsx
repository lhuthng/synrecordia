import { useEffect, useRef, useState } from "react";
import { createPackedSampler } from "../../libs/packedSampler/factory";
import { motion as Motion, AnimatePresence, useAnimate } from "motion/react";

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
}) {
  const [samplerInstance, setSamplerInstance] = useState(null);
  const [scope, animate] = useAnimate();

  const isReadyRef = useRef(false);
  const packedSamplerRef = useRef(null);
  const registeredSamplerRef = useRef(null);

  const [Presentation, setPresentation] = useState(null);

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

    // Cleanup when component unmounts or dependencies change
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
          ref={scope}
          initial={{ opacity: 0, x: -5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -5 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
          }}
        >
          <Presentation
            packedSampler={samplerInstance}
            label={slot + 1}
            toggle={toggle}
            offReady={() => {
              handleAudioReady?.(false);
              isReadyRef.current = false;
            }}
            onToggleChanged={(value) => onToggleChanged(slot, value)}
            callbacks={callbacks}
            onSamplerChanged={handleSamplerChanged}
            controllerNode={controllerNode}
          />
        </Motion.div>
      ) : (
        <></>
      )}
    </AnimatePresence>
  );
}
