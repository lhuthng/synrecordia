import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as PIXI from "pixi.js";
import { GlowFilter } from "pixi-filters";
import {
  DEFAULT_WIDTH,
  FADE_MS,
  ZONE_COLOR,
  PARTICLE_RADIUS,
  NOTE_GLOW_PADDING,
  NOTE_LAZY_BUFFER_PX,
  NOTE_FADE_SPEED,
  MAX_PARTICLES,
} from "../components/utils/constants.js";
import {
  cssColorToPixiHex,
  lerpColor,
} from "../components/utils/colorUtils.js";
import { getBeatsPerBar } from "../components/utils/fingeringUtils.js";
import { createVisualizerInstrument } from "../libs/visualizer/VisualizerInstrumentFactory.js";

/**
 * Encapsulates all PixiJS initialisation, the animation ticker, and pointer/wheel
 * interaction logic for the Visualizer component.
 *
 * @param {object} props - Same shape as the Visualizer component props (minus onPlayPause).
 * @returns {{ wrapperRef, containerRef, width, isReady, displaySong,
 *             isDragging, isHoveringNote, isHoveringPlayBar, isPlayBarDragging,
 *             cursor, handleDragStart, handleDragMove, handleDragEnd }}
 */
export function usePixiVisualizer({
  song,
  currentBeat = 0,
  durationBeats = 0,
  isPlaying = false,
  bpm = 120,
  fingeringSystem = "baroque",
  recorderType = "tenor",
  noteWidth = 70,
  height,
  playBarPosition = 0.95,
  transpose = 0,
  onReady,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayBarPositionChange,
  onScrollHint,
  interactionLocked = false,
  latencyMs = 0,
  particlesEnabled = true,
  ecoMode = false,
  // Instrument-specific overrides.  For the guitar, pass a stable (memoized)
  // object so this reference only changes when the user actually edits a value.
  guitarOptions = {},
}) {
  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const wrapperRef = useRef(null);
  const containerRef = useRef(null);

  // ─── Canvas sizing ───────────────────────────────────────────────────────────
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH);
  const width = canvasWidth;
  const canvasWidthRef = useRef(canvasWidth);

  // ─── PIXI refs ───────────────────────────────────────────────────────────────
  const appRef = useRef(null);
  // noteEventsRef: sorted raw event data (no PIXI objects).
  // activeSpriteMapRef: Map<index, sprite> – only the currently-allocated PIXI containers.
  const noteEventsRef = useRef([]);
  const activeSpriteMapRef = useRef(new Map());
  // ─── Instrument visualizer (set in noteEvents useMemo, used in init) ─────────
  const instrumentRef = useRef(null);
  const guideLayerRef = useRef(null);
  const holesLayerRef = useRef(null);
  const notesLayerRef = useRef(null);
  const playBarLayerRef = useRef(null);
  const scrollLayerRef = useRef(null);
  const particleLayerRef = useRef(null);
  const particlesRef = useRef([]);
  const particleTextureRef = useRef(null);
  const particlePoolRef = useRef(null);

  // ─── Rebuild callbacks (set once inside init, called by external effects) ────
  const buildGuidesRef = useRef(null);
  const buildPlayBarRef = useRef(null);
  const buildSpritesRef = useRef(null);
  const buildZonesRef = useRef(null);
  const buildGuidesDebounceRef = useRef(null);

  // ─── Playback / scroll state refs ────────────────────────────────────────────
  // targetBeatRef: the external target the ticker interpolates displayBeatRef toward.
  const currentBeatRef = useRef(currentBeat);
  const displayBeatRef = useRef(currentBeat);
  const targetBeatRef = useRef(currentBeat);
  const latencyMsRef = useRef(latencyMs);
  const bpmRef = useRef(bpm);
  const isPlayingRef = useRef(isPlaying);
  const durationBeatsRef = useRef(durationBeats);
  const lastFrameTimeRef = useRef(0);
  const pixelsPerBeatRef = useRef(noteWidth);
  const barXRef = useRef(0);
  const playBarPositionRef = useRef(playBarPosition);

  // ─── Interaction refs ─────────────────────────────────────────────────────────
  const onNoteClickRef = useRef(onNoteClick);
  const mouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartBeatRef = useRef(0);
  const playBarHoveredRef = useRef(false);
  const isPlayBarDraggingRef = useRef(false);
  const dragStartPlayBarPositionRef = useRef(0);

  // ─── Multi-touch tracking refs ───────────────────────────────────────────────
  const activeTouchPointersRef = useRef(new Map()); // pointerId → clientX

  // ─── Interaction lock ref ────────────────────────────────────────────────────
  const interactionLockedRef = useRef(interactionLocked);

  // ─── Particles enabled ref ───────────────────────────────────────────────────
  const particlesEnabledRef = useRef(particlesEnabled);
  const ecoModeRef = useRef(ecoMode);

  // ─── Lazy allocation refs ────────────────────────────────────────────────────
  // maxSpriteWidthRef: widest note sprite (px) – used as conservative left-boundary buffer.
  // visWinRef: [start, end) index range into noteEventsRef that is currently allocated.
  const maxSpriteWidthRef = useRef(0);
  const visWinRef = useRef({ start: 0, end: 0 });
  // guideVisWinRef: inclusive [left, right] index range into guideLayer.children
  // that is currently visible. Children are sorted by .x descending (0, -ppb, -2ppb…)
  // so the visible slice is always contiguous — we only touch edges each frame.
  const guideVisWinRef = useRef({ left: 0, right: -1 });
  // heightRef: current canvas height, kept in sync for use by rebuildStaticLayerRef.
  const heightRef = useRef(height);
  // rebuildStaticLayerRef: registered by init to allow in-place static-layer rebuilds.
  const rebuildStaticLayerRef = useRef(null);

  // ─── React state ─────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringNote, setIsHoveringNote] = useState(false);
  const [isHoveringPlayBar, setIsHoveringPlayBar] = useState(false);
  const [isPlayBarDragging, setIsPlayBarDragging] = useState(false);
  const [songState, setSongState] = useState({
    displaySong: song,
    isReady: false,
  });
  const { displaySong, isReady } = songState;

  // ─── Resize observer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapperRef.current) return;
    let timeoutId;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = Math.floor(entry.contentRect.width);
      if (newWidth > 0) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => setCanvasWidth(newWidth), 80);
      }
    });
    observer.observe(wrapperRef.current);
    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  // ─── Derived state ───────────────────────────────────────────────────────────
  const effectiveTimeSignature = useMemo(() => {
    const s = displaySong ?? song;
    if (!s) return null;
    if (s.timeSignature) return s.timeSignature;
    if (Array.isArray(s.timeSignatures) && s.timeSignatures.length > 0) {
      return s.timeSignatures[0]?.timeSignature ?? null;
    }
    return null;
  }, [displaySong, song]);

  // ─── Instrument visualizer factory ────────────────────────────────────────────
  // Always visualize tracks[0].  A fresh instrument instance is created whenever
  // the song or the active instrument changes so that buildStaticLayer / createSprite
  // / onTickSprite use the correct renderer for the track type.
  //
  // instrumentMemo bundles the instrument instance and its note events in one pass.
  // instrumentRef is kept in sync via useLayoutEffect (outside render) so the init
  // effect and the ticker can access the current instrument without appearing in
  // their dependency arrays.
  const instrumentMemo = useMemo(() => {
    if (
      !displaySong ||
      !Array.isArray(displaySong.tracks) ||
      displaySong.tracks.length === 0
    )
      return { events: [], instrument: null };

    const track = displaySong.tracks[0];
    const instrument = createVisualizerInstrument(
      track.instrument ?? "recorder",
    );
    return {
      events: instrument.computeNoteEvents(
        track,
        fingeringSystem,
        transpose,
        recorderType,
        guitarOptions,
      ),
      instrument,
    };
  }, [displaySong, fingeringSystem, transpose, recorderType, guitarOptions]);

  // Extract the events array used as an effect dependency and captured by the
  // init closure.  Changing this reference is what triggers a scene rebuild.
  const noteEvents = instrumentMemo.events;

  // Sync instrumentRef outside of render so the async init() and the ticker
  // always read the correct instrument instance.  useLayoutEffect fires before
  // useEffect, guaranteeing the ref is updated before init() runs.
  useLayoutEffect(() => {
    instrumentRef.current = instrumentMemo.instrument;
    // Pre-sort events into noteEventsRef so buildSprites can read from it
    // without relying on a stale closure-captured noteEvents variable.
    noteEventsRef.current = [...(instrumentMemo.events ?? [])].sort(
      (a, b) => a.time - b.time,
    );
  }, [instrumentMemo]);

  // ─── Sync simple props into refs ─────────────────────────────────────────────
  useEffect(() => {
    onNoteClickRef.current = onNoteClick;
  }, [onNoteClick]);

  useEffect(() => {
    interactionLockedRef.current = interactionLocked;
  }, [interactionLocked]);

  useEffect(() => {
    particlesEnabledRef.current = particlesEnabled;
    // When particles are disabled, destroy any already-live particles immediately
    if (!particlesEnabled && particleLayerRef.current) {
      for (const p of particlesRef.current) {
        particlePoolRef.current?.release(p.spr);
      }
      particlesRef.current = [];
    }
  }, [particlesEnabled]);

  useEffect(() => {
    ecoModeRef.current = ecoMode;
  }, [ecoMode]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) {
      // Snap the display beat immediately when playback starts so the LERP
      // doesn't visibly pull the canvas backward to reach the latency offset.
      const latencyBeats =
        (latencyMsRef.current / 1000) * ((bpmRef.current || 120) / 60);
      displayBeatRef.current = (currentBeatRef.current ?? 0) - latencyBeats;
    }
  }, [isPlaying]);

  useEffect(() => {
    latencyMsRef.current = latencyMs;
  }, [latencyMs]);

  useEffect(() => {
    canvasWidthRef.current = canvasWidth;
  }, [canvasWidth]);

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  // ─── Song fade / transition ───────────────────────────────────────────────────
  useEffect(() => {
    const sameId = !!(song?.id && displaySong?.id === song.id);
    const sameInstrument =
      displaySong?.tracks?.[0]?.instrument === song?.tracks?.[0]?.instrument;
    // Fully identical — nothing to do.
    if (sameId && sameInstrument) return;
    if (sameId && !sameInstrument) {
      // Same song, instrument swapped: update displaySong in-place, no opacity flash.
      // The noteEvents useEffect will immediately rebuild sprites and static layer.
      setSongState((prev) => ({ ...prev, displaySong: song }));
      return;
    }
    // Different song — full fade transition.
    const t = setTimeout(() => {
      setSongState({ displaySong: song, isReady: false });
      onReady?.();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [song, displaySong?.id, displaySong?.tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Beat tracking ────────────────────────────────────────────────────────────
  useEffect(() => {
    const prev = currentBeatRef.current;
    currentBeatRef.current = currentBeat;
    targetBeatRef.current = currentBeat;
    const latencyBeats =
      (latencyMsRef.current / 1000) * ((bpmRef.current || 120) / 60);
    if (!isPlayingRef.current) {
      displayBeatRef.current = currentBeat - latencyBeats;
    } else if (prev - currentBeat > 0.5) {
      displayBeatRef.current = currentBeat - latencyBeats;
    }
    lastFrameTimeRef.current = performance.now();
  }, [currentBeat]);

  // ─── Duration / time-signature changes → rebuild guides + zones ──────────────
  useEffect(() => {
    const timeSignatures = displaySong?.timeSignatures;
    let lastBarBeat;

    if (Array.isArray(timeSignatures) && timeSignatures.length > 1) {
      // Multi-segment: round up to the bar boundary inside the segment that
      // actually contains durationBeats, not just the first segment's bar size.
      let segStart = 0;
      lastBarBeat = durationBeats;
      for (const seg of timeSignatures) {
        const segBpb = Math.max(1, getBeatsPerBar(seg?.timeSignature ?? "4/4"));
        const segLen = Math.max(0, Number(seg?.length) || 0);
        const segEnd = segStart + segLen;
        if (durationBeats <= segEnd) {
          const beatsIn = durationBeats - segStart;
          lastBarBeat = segStart + Math.ceil(beatsIn / segBpb) * segBpb;
          break;
        }
        segStart = segEnd;
      }
    } else {
      const beatsPerBar = getBeatsPerBar(effectiveTimeSignature);
      lastBarBeat =
        beatsPerBar > 0
          ? Math.ceil(durationBeats / beatsPerBar) * beatsPerBar
          : durationBeats;
    }

    durationBeatsRef.current = lastBarBeat;
    buildGuidesRef.current?.();
    buildZonesRef.current?.();
  }, [durationBeats, effectiveTimeSignature, displaySong?.timeSignatures]);

  // ─── Note width changes → full scene rebuild + scroll correction ──────────────
  useEffect(() => {
    const prevPpb = pixelsPerBeatRef.current;
    pixelsPerBeatRef.current = noteWidth;

    // Immediately rescale existing guide bar/beat line positions by the zoom
    // ratio so they stay aligned with notes and the scroll layer during the
    // 60 ms debounce window before the full rebuild fires.
    // (Text label positions scale with their parent Graphics, so no separate pass needed.)
    const guideLayer = guideLayerRef.current;
    if (guideLayer && prevPpb > 0 && prevPpb !== noteWidth) {
      const ratio = noteWidth / prevPpb;
      for (let i = 0; i < guideLayer.children.length; i++) {
        guideLayer.children[i].x *= ratio;
      }
    }

    // Debounce guide rebuild so dragging the zoom handle doesn't create/destroy
    // hundreds of PIXI objects on every pointer-move event.
    clearTimeout(buildGuidesDebounceRef.current);
    buildGuidesDebounceRef.current = setTimeout(() => {
      buildGuidesRef.current?.();
    }, 60);
    buildZonesRef.current?.();
    buildSpritesRef.current?.();

    const scrollLayer = scrollLayerRef.current;
    if (scrollLayer) {
      const bx = barXRef.current || 0;
      const beat = displayBeatRef.current || 0;
      const pxPerBeat = pixelsPerBeatRef.current || 1;
      scrollLayer.x = bx + beat * pxPerBeat;
    }
  }, [noteWidth]);

  // ─── Play-bar position / canvas width changes ─────────────────────────────────
  useEffect(() => {
    playBarPositionRef.current = playBarPosition;
    barXRef.current = Math.round(canvasWidth * playBarPosition);
    buildPlayBarRef.current?.();
  }, [playBarPosition, canvasWidth]);

  // ─── PIXI init / teardown ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    // Capture the map reference now so the cleanup closure uses the value
    // at effect-run time, satisfying the react-hooks/exhaustive-deps rule.
    const activeMap = activeSpriteMapRef.current;

    let cancelled = false;
    let ticker = null;
    let tick = null;

    const init = async () => {
      const app = new PIXI.Application();
      const canvasEl = document.createElement("canvas");
      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: !ecoModeRef.current,
        resolution: ecoModeRef.current
          ? 1
          : Math.min(window.devicePixelRatio || 1, 2),
        canvas: canvasEl,
      });

      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      // Force the canvas element itself to be CSS-transparent so that the
      // WebGL alpha channel composites against whatever DOM layer sits behind
      // it (the AmbientLight glow) rather than defaulting to an opaque black.
      canvasEl.style.background = "transparent";

      appRef.current = app;
      if (containerRef.current) {
        containerRef.current.appendChild(canvasEl);
      }

      // ── Layout constants ────────────────────────────────────────────────────
      const barX = Math.round(width * playBarPositionRef.current);
      barXRef.current = barX;
      const beatsPerBar = getBeatsPerBar(effectiveTimeSignature);

      // ── Layers ──────────────────────────────────────────────────────────────
      const guideLayer = new PIXI.Container();
      guideLayer.eventMode = "none";
      guideLayerRef.current = guideLayer;

      const holesLayer = new PIXI.Container();
      holesLayer.eventMode = "none";
      holesLayerRef.current = holesLayer;

      const notesLayer = new PIXI.Container();
      notesLayerRef.current = notesLayer;

      const playBarLayer = new PIXI.Container();
      playBarLayerRef.current = playBarLayer;

      const particleLayer = new PIXI.Container();
      particleLayer.eventMode = "none";
      particleLayerRef.current = particleLayer;

      // ── Particle texture (shared circle sprite) ──────────────────────────────
      const BIG = 1_000_000;
      const ptGfx = new PIXI.Graphics();
      ptGfx.circle(0, 0, PARTICLE_RADIUS);
      ptGfx.fill({ color: 0xffffff });
      particleTextureRef.current = app.renderer.generateTexture(ptGfx);
      ptGfx.destroy();

      // ── Pre-allocate particle sprite pool ────────────────────────────────────
      const pool = {
        _free: [],
        acquire() {
          const spr = this._free.pop();
          if (!spr) return null; // pool exhausted (shouldn't happen if sized correctly)
          spr.visible = true;
          spr.alpha = 1;
          spr.tint = 0xffffff;
          return spr;
        },
        release(spr) {
          spr.visible = false;
          spr.alpha = 0;
          this._free.push(spr);
        },
      };
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const spr = new PIXI.Sprite(particleTextureRef.current);
        spr.anchor.set(0.5);
        spr.visible = false;
        particleLayer.addChild(spr);
        pool._free.push(spr);
      }
      particlePoolRef.current = pool;

      // ── Scroll / zone layers ─────────────────────────────────────────────────
      const scrollLayer = new PIXI.Container();
      scrollLayerRef.current = scrollLayer;

      const zonesLayer = new PIXI.Container();
      zonesLayer.eventMode = "none";
      const leftZone = new PIXI.Graphics();
      const rightZone = new PIXI.Graphics();
      zonesLayer.addChild(leftZone);
      zonesLayer.addChild(rightZone);

      scrollLayer.addChild(zonesLayer);
      scrollLayer.addChild(guideLayer);
      scrollLayer.addChild(notesLayer);

      app.stage.addChild(holesLayer);
      app.stage.addChild(scrollLayer);
      app.stage.addChild(particleLayer);
      app.stage.addChild(playBarLayer);

      // ── Static layer (instrument-specific guide decorations) ─────────────────
      instrumentRef.current?.buildStaticLayer(holesLayer, { width, height });

      // ── Builder: zones ───────────────────────────────────────────────────────
      const buildZones = () => {
        const pxPerBeat = pixelsPerBeatRef.current || 1;
        const duration = durationBeatsRef.current ?? 0;

        leftZone.clear();
        rightZone.clear();
        if (duration > 0) {
          leftZone.rect(-BIG, 0, BIG, height);
          leftZone.fill({ color: ZONE_COLOR, alpha: 0.35 });
          leftZone.x = -duration * pxPerBeat;

          rightZone.rect(0, 0, BIG, height);
          rightZone.fill({ color: ZONE_COLOR, alpha: 0.35 });
          rightZone.x = 0;
        }
      };

      // ── Builder: bar / beat guides ───────────────────────────────────────────
      const buildGuides = () => {
        guideLayer.removeChildren();

        const pxPerBeat = pixelsPerBeatRef.current || 1;

        // Compute how many bars to skip between visible labels.
        // When bars are narrow, labels would overlap; skip every N bars.
        // Bar width ≈ pxPerBeat × typical beats-per-bar (use 4 as default for the density check).
        const approxBarPx = pxPerBeat * 4; // approximate — good enough for threshold
        const labelInterval =
          approxBarPx < 80
            ? 8
            : approxBarPx < 160
              ? 4
              : approxBarPx < 320
                ? 2
                : 1;

        const duration = durationBeatsRef.current ?? Infinity;

        // Multi-segment time signatures take priority over single ts.
        const ts =
          Array.isArray(displaySong?.timeSignatures) &&
          displaySong.timeSignatures.length > 0
            ? displaySong.timeSignatures
            : null;

        if (ts) {
          let segmentStart = 0;
          let globalBarIndex = 0;

          for (const seg of ts) {
            const sig = seg?.timeSignature ?? "4/4";
            const segBeatsPerBar = Math.max(1, getBeatsPerBar(sig));
            const segLengthBeats = Math.max(0, Number(seg?.length) || 0);
            const segEndBeat = Math.min(
              segmentStart + segLengthBeats,
              duration,
            );

            const numBars =
              segBeatsPerBar > 0
                ? Math.ceil((segEndBeat - segmentStart) / segBeatsPerBar)
                : 0;

            for (let barInSeg = 0; barInSeg < numBars; barInSeg += 1) {
              const barBeat = segmentStart + barInSeg * segBeatsPerBar;
              if (barBeat > segEndBeat) break;

              const barLine = new PIXI.Graphics();
              barLine.setStrokeStyle({
                width: 2,
                color: 0xffffff,
                alpha: 0.35,
              });
              barLine.moveTo(0, 0);
              barLine.lineTo(0, height);
              barLine.stroke();
              barLine.x = -barBeat * pxPerBeat;
              guideLayer.addChild(barLine);

              if (globalBarIndex % labelInterval === 0) {
                const barLabel = new PIXI.Text({
                  text: String(globalBarIndex + 1) + " ",
                  style: {
                    fill: 0xffffff,
                    fontSize: 12,
                    fontFamily: "Iosevka Charon",
                    align: "right",
                  },
                });
                barLabel.anchor.set(1, 0);
                barLabel.y = 6;
                barLabel.x = -barBeat * pxPerBeat;
                guideLayer.addChild(barLabel);
              }

              for (
                let beatIndex = 1;
                beatIndex < segBeatsPerBar;
                beatIndex += 1
              ) {
                const beatBeat = barBeat + beatIndex;
                if (beatBeat >= segmentStart + segLengthBeats) break;
                const beatLine = new PIXI.Graphics();
                beatLine.setStrokeStyle({
                  width: 1,
                  color: 0xffffff,
                  alpha: 0.15,
                });
                beatLine.moveTo(0, 0);
                beatLine.lineTo(0, height);
                beatLine.stroke();
                beatLine.x = -beatBeat * pxPerBeat;
                guideLayer.addChild(beatLine);
              }

              globalBarIndex += 1;
            }

            segmentStart += segLengthBeats;
            if (segmentStart >= duration) break;
          }
        } else {
          const beatsPerBarLocal = beatsPerBar || 4;
          const lastBar = Math.ceil(
            (durationBeatsRef.current ?? 0) / beatsPerBarLocal,
          );
          const pxPerBeatLocal = pxPerBeat;

          for (let barIndex = 0; barIndex <= lastBar; barIndex += 1) {
            const barBeat = barIndex * beatsPerBarLocal;
            const barLine = new PIXI.Graphics();
            barLine.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.35 });
            barLine.moveTo(0, 0);
            barLine.lineTo(0, height);
            barLine.stroke();
            barLine.x = -barBeat * pxPerBeatLocal;
            guideLayer.addChild(barLine);

            if (barIndex % labelInterval === 0) {
              const barLabel = new PIXI.Text({
                text: String(barIndex + 1) + " ",
                style: {
                  fill: 0xffffff,
                  fontSize: 12,
                  fontFamily: "Iosevka Charon",
                  align: "right",
                },
              });
              barLabel.anchor.set(1, 0);
              barLabel.y = 6;
              barLabel.x = -barBeat * pxPerBeatLocal;
              guideLayer.addChild(barLabel);
            }

            for (
              let beatIndex = 1;
              beatIndex < beatsPerBarLocal;
              beatIndex += 1
            ) {
              const beatBeat = barBeat + beatIndex;
              const beatLine = new PIXI.Graphics();
              beatLine.setStrokeStyle({
                width: 1,
                color: 0xffffff,
                alpha: 0.15,
              });
              beatLine.moveTo(0, 0);
              beatLine.lineTo(0, height);
              beatLine.stroke();
              beatLine.x = -beatBeat * pxPerBeatLocal;
              guideLayer.addChild(beatLine);
            }
          }
        }

        // Reset the visibility window and hide every child so the ticker
        // reveals only the on-screen slice on the very next frame.
        guideVisWinRef.current = { left: 0, right: -1 };
        for (const c of guideLayer.children) c.visible = false;
      };

      // ── Builder: play-bar line + gradient vignette ───────────────────────────
      const buildPlayBar = () => {
        if (!playBarLayerRef.current) return;
        const removed = playBarLayerRef.current.removeChildren();
        for (const child of removed) {
          child.destroy({ texture: true, children: true });
        }

        const styles = getComputedStyle(document.documentElement);
        const darkStr =
          styles.getPropertyValue("--color-dark").trim() || "#060a0c";
        const darkHex = cssColorToPixiHex(darkStr, 0x060a0c);
        const r = (darkHex >> 16) & 0xff;
        const g = (darkHex >> 8) & 0xff;
        const b = darkHex & 0xff;

        const gradWidth = Math.max(1, width - barXRef.current);
        const gradCanvas = document.createElement("canvas");
        gradCanvas.width = gradWidth;
        gradCanvas.height = 1;
        const ctx = gradCanvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, gradWidth, 0);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, gradWidth, 1);
        const gradTexture = PIXI.Texture.from(gradCanvas);
        const gradSprite = new PIXI.Sprite(gradTexture);
        gradSprite.x = barXRef.current;
        gradSprite.y = 0;
        gradSprite.width = gradWidth;
        gradSprite.height = height;
        playBarLayerRef.current.addChild(gradSprite);

        const pb = new PIXI.Graphics();
        pb.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.9 });
        pb.moveTo(barXRef.current, 0);
        pb.lineTo(barXRef.current, height);
        pb.stroke();
        if (!ecoModeRef.current) {
          pb.filters = [
            new GlowFilter({
              distance: 14,
              outerStrength: 2.2,
              innerStrength: 0.4,
              color: 0xffffff,
              quality: 0.2,
              knockout: false,
            }),
          ];
        }
        pb.eventMode = "static";
        pb.hitArea = new PIXI.Rectangle(barXRef.current - 12, 0, 24, height);
        pb.on("pointerover", () => {
          playBarHoveredRef.current = true;
          setIsHoveringPlayBar(true);
        });
        pb.on("pointerout", () => {
          playBarHoveredRef.current = false;
          setIsHoveringPlayBar(false);
        });
        playBarLayerRef.current.addChild(pb);
      };

      // ── Factory: build one PIXI container for a single note event ─────────────
      // Delegates all instrument-specific rendering to the active instrument class.
      // The container starts at alpha=0; the ticker lerps it to 1 each frame so
      // the fade-in completes offscreen during normal playback.
      const createSpriteForEvent = (event) =>
        instrumentRef.current?.createSprite(event, {
          ppb: pixelsPerBeatRef.current || 1,
          height,
          notesLayer,
          isPlayingRef,
          hasDraggedRef,
          onNoteClickRef,
          setIsHoveringNote,
          ecoMode: ecoModeRef.current,
        }) ?? null;

      // ── Builder: lazy note allocation ─────────────────────────────────────────
      // Replaces the old eager build. Stores sorted raw event data so the ticker
      // can create PIXI containers on demand as notes enter the buffered viewport.
      const buildSprites = () => {
        // Destroy every currently-allocated sprite.
        for (const spr of activeSpriteMapRef.current.values()) {
          notesLayer.removeChild(spr.container);
          spr.container.destroy({ children: true });
        }
        activeSpriteMapRef.current.clear();

        // noteEventsRef.current is pre-sorted by the instrumentMemo useLayoutEffect.
        // Do NOT re-sort or overwrite here — the ref is the single source of truth.
        const ppb = pixelsPerBeatRef.current || 1;
        const maxDuration = noteEventsRef.current.reduce(
          (m, e) => Math.max(m, e.duration ?? 0),
          0,
        );
        maxSpriteWidthRef.current = Math.max(maxDuration * ppb, 6);

        // Reset the allocation window so the ticker starts fresh.
        visWinRef.current = { start: 0, end: 0 };

        // Only update isReady if it isn't already true (instrument-swap case keeps it
        // at true the whole time to avoid an opacity flash).
        requestAnimationFrame(() => {
          if (!cancelled)
            setSongState((prev) =>
              prev.isReady ? prev : { ...prev, isReady: true },
            );
        });
      };

      // ── Register builders and do initial draw ────────────────────────────────
      buildGuidesRef.current = buildGuides;
      buildPlayBarRef.current = buildPlayBar;
      buildSpritesRef.current = buildSprites;
      buildZonesRef.current = buildZones;
      // Lightweight static-layer rebuild for in-place instrument swaps.
      rebuildStaticLayerRef.current = () => {
        if (!holesLayerRef.current) return;
        holesLayerRef.current.removeChildren();
        instrumentRef.current?.buildStaticLayer(holesLayerRef.current, {
          width: canvasWidthRef.current,
          height: heightRef.current,
        });
      };
      buildGuides();
      buildZones();
      buildPlayBar();
      buildSprites();

      // ── Ticker ───────────────────────────────────────────────────────────────
      ticker = app.ticker ?? PIXI.Ticker.shared;
      tick = (tickerArg) => {
        const now = performance.now();
        const elapsed = (now - lastFrameTimeRef.current) / 1000;

        // Latency compensation: displayBeat = currentBeat - latencyBeats.
        // Positive latencyMs → visual lags behind audio (compensates for late audio).
        const latencyBeats =
          (latencyMsRef.current / 1000) * ((bpmRef.current ?? 120) / 60);

        // Project ahead when playing, otherwise hold at current beat.
        const targetBeat = isPlayingRef.current
          ? (currentBeatRef.current ?? 0) -
            latencyBeats +
            elapsed * ((bpmRef.current ?? 120) / 60)
          : (currentBeatRef.current ?? 0) - latencyBeats;

        const LERP_SPEED = 8;
        const lerpAlpha = 1 - Math.exp(-LERP_SPEED * Math.max(0, elapsed));
        const externalTarget =
          targetBeatRef.current !== null
            ? targetBeatRef.current - latencyBeats
            : null;
        const resolvedTarget = Math.max(
          targetBeat,
          externalTarget ?? targetBeat,
        );

        displayBeatRef.current +=
          (resolvedTarget - displayBeatRef.current) * lerpAlpha;
        const beat = displayBeatRef.current;
        lastFrameTimeRef.current = now;

        // ── Smooth scroll ──────────────────────────────────────────────────────
        const pxPerBeat = pixelsPerBeatRef.current || 1;
        const bx = barXRef.current || barX;
        const desiredX = bx + beat * pxPerBeat;
        const currentX = typeof scrollLayer.x === "number" ? scrollLayer.x : 0;
        const diff = desiredX - currentX;

        if (Math.abs(diff) > 120) {
          scrollLayer.x = desiredX;
          // Large jump (restart / big scrub): the neighbour-walk window can't
          // catch up in one step, so reset it and hide every guide child now.
          // The culling block below will re-reveal the correct slice this frame.
          guideVisWinRef.current = { left: 0, right: -1 };
          for (let _i = 0; _i < guideLayer.children.length; _i++) {
            guideLayer.children[_i].visible = false;
          }
        } else {
          scrollLayer.x = currentX + diff * 0.18;
        }
        const actualScrollX = scrollLayer.x;

        // ── Guide visibility culling (neighbor-walk sliding window) ──────────
        // guideLayer.children are in monotonically non-increasing .x order
        // (0, -ppb, -2·ppb, …) so the visible slice [left, right] is always
        // contiguous. We store the two boundary indices and only peek at their
        // immediate neighbors each frame — pure O(Δ), no log-n search at all.
        {
          const gc = guideLayer.children;
          const gn = gc.length;
          if (gn > 0) {
            const xMin = -2 - actualScrollX; // child.x must be > xMin  (left screen edge)
            const xMax = width - actualScrollX; // child.x must be < xMax  (right screen edge)

            let { left, right } = guideVisWinRef.current;

            // Expand right – children entering from the left as the song advances
            while (right < gn - 1 && gc[right + 1].x > xMin) {
              right++;
              gc[right].visible = true;
            }

            // Shrink right – children that have scrolled off the left edge
            while (right >= left && gc[right].x <= xMin) {
              gc[right].visible = false;
              right--;
            }

            // Shrink left – children that have scrolled off the right edge
            // (also corrects left on the first frame after buildGuides)
            while (left <= right && gc[left].x >= xMax) {
              gc[left].visible = false;
              left++;
            }

            // Expand left – children re-entering from the right (scrubbing backward)
            while (left > 0 && gc[left - 1].x < xMax && gc[left - 1].x > xMin) {
              left--;
              gc[left].visible = true;
            }

            guideVisWinRef.current = { left, right };
          }
        }

        // ── Lazy note-sprite allocation (sliding-window) ───────────────────────
        // noteEventsRef holds sorted raw event data; activeSpriteMapRef holds only
        // the PIXI containers that are currently allocated. Sprites are created as
        // notes enter the buffered viewport and destroyed when they leave.
        //
        // Derivation (container.x = -sprWidth - time * ppb):
        //   screenX = actualScrollX - sprWidth - time * ppb
        //   Right edge visible → time < (actualScrollX + glowPad + BUFFER) / ppb  [timeMaxBuf]
        //   Left  edge visible → time > (actualScrollX - maxW - glowPad - width - BUFFER) / ppb  [timeMinBuf]
        //
        // Higher time values = notes further ahead = LEFT side of the screen.
        // As the song plays forward, newStart and newEnd both increase:
        //   newStart increases → old past-notes are destroyed (right buffer expired).
        //   newEnd   increases → new future-notes are allocated (left buffer entered).
        {
          const events = noteEventsRef.current;
          const activeMap = activeSpriteMapRef.current;
          const n = events.length;
          if (n > 0) {
            const ppb = pixelsPerBeatRef.current || 1;
            const glowPad = NOTE_GLOW_PADDING;
            const maxW = maxSpriteWidthRef.current;
            const BUFFER_PX = NOTE_LAZY_BUFFER_PX;

            // Allocation bounds – extend the visible area by BUFFER_PX on each side
            // so fade-in completes before notes reach the viewport edge.
            const timeMaxBuf = (actualScrollX + glowPad + BUFFER_PX) / ppb;
            const timeMinBuf =
              (actualScrollX - maxW - glowPad - width - BUFFER_PX) / ppb;

            // Binary search: first index where time >= timeMinBuf
            let lo = 0;
            let hi = n;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (events[mid].time < timeMinBuf) lo = mid + 1;
              else hi = mid;
            }
            const newStart = lo;

            // Binary search: first index where time > timeMaxBuf
            lo = 0;
            hi = n;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (events[mid].time <= timeMaxBuf) lo = mid + 1;
              else hi = mid;
            }
            const newEnd = lo;

            const prev = visWinRef.current;

            // ── Destroy sprites that slid out of the window ──────────────────
            // Past notes whose time is now below timeMinBuf (exited right buffer).
            for (let i = prev.start; i < Math.min(prev.end, newStart); i++) {
              const spr = activeMap.get(i);
              if (spr) {
                notesLayer.removeChild(spr.container);
                spr.container.destroy({ children: true });
                activeMap.delete(i);
              }
            }
            // Future notes whose time exceeded timeMaxBuf (jump backward cleared them).
            for (let i = Math.max(prev.start, newEnd); i < prev.end; i++) {
              const spr = activeMap.get(i);
              if (spr) {
                notesLayer.removeChild(spr.container);
                spr.container.destroy({ children: true });
                activeMap.delete(i);
              }
            }

            // ── Allocate newly-needed sprites ────────────────────────────────
            // Helper: create a sprite and skip fade-in if it is already on screen
            // (e.g. after a noteWidth rebuild that destroys and recreates all sprites).
            const allocate = (idx) => {
              if (activeMap.has(idx)) return;
              const spr = createSpriteForEvent(events[idx]);
              // If the note is already inside the visible viewport, snap alpha to 1
              // so it doesn't fade in unnecessarily.
              const sX = actualScrollX + spr.container.x;
              if (sX + spr.width + glowPad > 0 && sX - glowPad < width) {
                spr.fadeAlpha = 1;
                spr.container.alpha = 1;
              }
              activeMap.set(idx, spr);
            };

            // Jumping backward – past/current notes now in the newly-visible range.
            for (let i = newStart; i < Math.min(newEnd, prev.start); i++)
              allocate(i);
            // Normal forward playback or jump forward – upcoming notes enter the
            // left buffer and begin fading in before they reach the viewport.
            for (let i = Math.max(newStart, prev.end); i < newEnd; i++)
              allocate(i);

            visWinRef.current = { start: newStart, end: newEnd };

            // ── Per-frame update for every allocated sprite ──────────────────
            for (let i = newStart; i < newEnd; i++) {
              const sprite = activeMap.get(i);
              if (!sprite) continue;

              // Fade-in: progress alpha every frame even when the sprite is in the
              // buffer zone (off-screen) so the animation completes before the note
              // enters the visible area during normal playback. On a timeline jump
              // the fade plays out visibly for notes inside the viewport.
              if (sprite.fadeAlpha < 1) {
                sprite.fadeAlpha = Math.min(
                  1,
                  sprite.fadeAlpha + NOTE_FADE_SPEED,
                );
                sprite.container.alpha = sprite.fadeAlpha;
              }

              const screenX = actualScrollX + sprite.container.x;
              const isOnScreen =
                screenX + sprite.width + glowPad > 0 &&
                screenX - glowPad < width;

              // Keep visible while fading (even if off-screen) so alpha progresses.
              // Once fully faded, cull sprites outside the viewport for GPU savings.
              sprite.container.visible = sprite.fadeAlpha < 1 || isOnScreen;
              if (!isOnScreen) continue;

              const isActive =
                beat >= sprite.time && beat < sprite.time + sprite.duration;

              // Hover background fade
              if (sprite.hoverBg && sprite.hoverState) {
                sprite.hoverBg.alpha +=
                  (sprite.hoverState.targetAlpha - sprite.hoverBg.alpha) * 0.2;
              }

              // Brightness pulse on active note (generic — works for any instrument)
              if (sprite.brightnessFilter && sprite.brightnessState) {
                sprite.brightnessState.target = isActive ? 1.2 : 1.0;
                sprite.brightnessState.current +=
                  (sprite.brightnessState.target -
                    sprite.brightnessState.current) *
                  0.25;
                sprite.brightnessFilter.brightness(
                  sprite.brightnessState.current,
                  false,
                );
              }

              // Instrument-specific per-sprite tick (hole bounce, particles, etc.)
              instrumentRef.current?.onTickSprite(sprite, {
                isActive,
                particleRefs: {
                  particleLayerRef,
                  particlesRef,
                  particlePoolRef,
                },
                particleTextureRef,
                isPlayingRef,
                particlesEnabledRef,
                barXRef,
              });
            }
          }
        }

        // ── Particle lifecycle ─────────────────────────────────────────────────
        for (let i = particlesRef.current.length - 1; i >= 0; i -= 1) {
          const p = particlesRef.current[i];
          const dtSeconds = (tickerArg?.deltaMS ?? 16.67) / 1000;
          p.age += dtSeconds;
          const t = Math.min(1, p.age / p.lifetime);
          p.spr.tint = lerpColor(p.targetColor, 0xffffff, t);
          p.spr.alpha = 1 - t;
          p.x += p.vx * dtSeconds * 60;
          p.y += p.vy * dtSeconds * 60;
          p.spr.x = p.x;
          p.spr.y = p.y;
          if (p.age >= p.lifetime) {
            particlePoolRef.current?.release(p.spr);
            particlesRef.current.splice(i, 1);
          }
        }
      };

      ticker.add(tick);
    };

    init();

    return () => {
      cancelled = true;
      buildGuidesRef.current = null;
      buildPlayBarRef.current = null;
      buildSpritesRef.current = null;
      buildZonesRef.current = null;
      rebuildStaticLayerRef.current = null;
      if (ticker && tick) ticker.remove(tick);
      if (scrollLayerRef.current) scrollLayerRef.current = null;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      // activeSpriteMapRef entries are already destroyed by app.destroy above;
      // just clear the map so stale refs don't linger.
      activeMap.clear();
      particlesRef.current = [];
      particleTextureRef.current = null;
      particlePoolRef.current = null;
    };
  }, [width, height, effectiveTimeSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Lightweight sprite rebuild on note-events / instrument change ────────────
  // Replaces what used to be a full PIXI teardown (init rerun) with an in-place
  // clear-and-rebuild.  This keeps isReady true throughout, avoiding the opacity
  // flash that occurred when simply switching the visualizer instrument.
  useEffect(() => {
    if (!buildSpritesRef.current) return; // PIXI not yet initialised — init handles it
    rebuildStaticLayerRef.current?.();
    buildSpritesRef.current();
  }, [noteEvents]);

  // ─── Renderer resize on dimension changes ────────────────────────────────────
  useEffect(() => {
    if (!appRef.current) return;
    appRef.current.renderer.resize(width, height);
  }, [width, height]);

  // ─── Wheel scrub ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      if (interactionLockedRef.current) return;
      if (!e.ctrlKey && !e.metaKey) {
        onScrollHint?.();
        return;
      }
      e.preventDefault();
      onScrubStart?.();
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const deltaBeat = delta / (pixelsPerBeatRef.current || 1);
      const newBeat = Math.max(
        0,
        Math.min(
          durationBeatsRef.current || Infinity,
          currentBeatRef.current + deltaBeat,
        ),
      );
      currentBeatRef.current = newBeat;
      onScrub?.(newBeat);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onScrubStart, onScrub, onScrollHint]);

  // ─── Pointer / drag handlers ─────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e) => {
      if (interactionLockedRef.current) return;
      const isTouch = e.pointerType === "touch";

      if (isTouch) {
        // Track this pointer by id
        activeTouchPointersRef.current.set(e.pointerId, e.clientX);

        if (activeTouchPointersRef.current.size === 1) {
          const containerRect = containerRef.current?.getBoundingClientRect();
          const relX = containerRect
            ? e.clientX - containerRect.left
            : e.clientX;
          if (Math.abs(relX - barXRef.current) <= 16) {
            // Single finger on playbar → drag playbar
            dragStartXRef.current = e.clientX;
            isPlayBarDraggingRef.current = true;
            dragStartPlayBarPositionRef.current = playBarPositionRef.current;
            setIsPlayBarDragging(true);
          } else {
            // Single finger elsewhere → scrub the view
            dragStartXRef.current = e.clientX;
            dragStartBeatRef.current = currentBeatRef.current;
            mouseDownRef.current = true;
            isDraggingRef.current = true;
            hasDraggedRef.current = true;
            setIsDragging(true);
            onScrubStart?.();
          }
        }
        return;
      }

      // Mouse / stylus — original behaviour
      dragStartXRef.current = e.clientX;

      if (playBarHoveredRef.current) {
        isPlayBarDraggingRef.current = true;
        dragStartPlayBarPositionRef.current = playBarPositionRef.current;
        setIsPlayBarDragging(true);
      } else {
        dragStartBeatRef.current = currentBeatRef.current;
        mouseDownRef.current = true;
        hasDraggedRef.current = false;
        isDraggingRef.current = false;
        isPlayBarDraggingRef.current = false;
      }
    },
    [onScrubStart],
  );

  const handleDragMove = useCallback(
    (e) => {
      const isTouch = e.pointerType === "touch";

      if (isTouch) {
        // Keep this pointer's position up-to-date
        if (activeTouchPointersRef.current.has(e.pointerId)) {
          activeTouchPointersRef.current.set(e.pointerId, e.clientX);
        }

        // Single-finger playbar drag
        if (
          isPlayBarDraggingRef.current &&
          activeTouchPointersRef.current.size === 1
        ) {
          const deltaX = e.clientX - dragStartXRef.current;
          const newPosition = Math.max(
            0.5,
            Math.min(
              0.99,
              dragStartPlayBarPositionRef.current +
                deltaX / (canvasWidthRef.current || 1),
            ),
          );
          onPlayBarPositionChange?.(newPosition);
          return;
        }

        // Single-finger scrub
        if (isDraggingRef.current) {
          const deltaX = e.clientX - dragStartXRef.current;
          const deltaBeat = deltaX / (pixelsPerBeatRef.current || 1);
          const newBeat = Math.max(
            0,
            Math.min(
              durationBeatsRef.current || Infinity,
              dragStartBeatRef.current + deltaBeat,
            ),
          );
          currentBeatRef.current = newBeat;
          onScrub?.(newBeat);
        }
        return;
      }

      // Mouse / stylus — original behaviour
      const deltaX = e.clientX - dragStartXRef.current;

      if (isPlayBarDraggingRef.current) {
        const newPosition = Math.max(
          0.5,
          Math.min(
            0.99,
            dragStartPlayBarPositionRef.current +
              deltaX / (canvasWidthRef.current || 1),
          ),
        );
        onPlayBarPositionChange?.(newPosition);
        return;
      }

      if (!mouseDownRef.current) return;
      if (!isDraggingRef.current) {
        if (Math.abs(deltaX) <= 4) return;
        isDraggingRef.current = true;
        hasDraggedRef.current = true;
        setIsDragging(true);
        onScrubStart?.();
      }

      const deltaBeat = deltaX / (pixelsPerBeatRef.current || 1);
      const newBeat = Math.max(
        0,
        Math.min(
          durationBeatsRef.current || Infinity,
          dragStartBeatRef.current + deltaBeat,
        ),
      );
      onScrub?.(newBeat);
    },
    [onScrub, onScrubStart, onPlayBarPositionChange],
  );

  const handleDragEnd = useCallback((e) => {
    const isTouch = e?.pointerType === "touch";

    if (isTouch) {
      activeTouchPointersRef.current.delete(e?.pointerId);
      if (activeTouchPointersRef.current.size === 0) {
        isPlayBarDraggingRef.current = false;
        mouseDownRef.current = false;
        isDraggingRef.current = false;
        setIsDragging(false);
        setIsPlayBarDragging(false);
      }
      return;
    }

    // Mouse / stylus
    mouseDownRef.current = false;
    isDraggingRef.current = false;
    isPlayBarDraggingRef.current = false;
    setIsDragging(false);
    setIsPlayBarDragging(false);
  }, []);

  // ─── Cursor ───────────────────────────────────────────────────────────────────
  const cursor =
    isPlayBarDragging || isHoveringPlayBar
      ? "ew-resize"
      : isDragging
        ? "grabbing"
        : isHoveringNote && !isPlaying
          ? "pointer"
          : "grab";

  // ─── Public API ───────────────────────────────────────────────────────────────
  return {
    wrapperRef,
    containerRef,
    width,
    isReady,
    displaySong,
    isDragging,
    isHoveringNote,
    isHoveringPlayBar,
    isPlayBarDragging,
    cursor,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}
