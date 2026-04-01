import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from "pixi.js";
import { GlowFilter } from "pixi-filters";
import {
  DEFAULT_WIDTH,
  FADE_MS,
  ZONE_COLOR,
  MAX_PARTICLES,
  PARTICLE_RADIUS,
  PARTICLE_LIFETIME_MIN,
  PARTICLE_LIFETIME_MAX,
  PARTICLE_SPAWN_CHANCE,
  NUM_HOLES,
  NOTE_GLOW_PADDING,
  HOLE_SIZE,
  HOLE_PLAY_SCALE,
  HOLE_SCALE_ALPHA,
} from "../components/utils/constants.js";
import {
  cssColorToPixiHex,
  brightenColor,
  lerpColor,
  getFingeringColors,
} from "../components/utils/colorUtils.js";
import {
  getHighestNote,
  getBeatsPerBar,
} from "../components/utils/fingeringUtils.js";
import { createFingeringResolver } from "../libs/fingering/FingeringResolverFactory.js";
import {
  getHolePositions,
  drawFingering,
} from "../components/utils/geometryUtils.js";

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
  noteWidth = 70,
  height,
  playBarPosition = 0.95,
  onReady,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayBarPositionChange,
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
  const noteSpritesRef = useRef([]);
  const guideLayerRef = useRef(null);
  const holesLayerRef = useRef(null);
  const notesLayerRef = useRef(null);
  const playBarLayerRef = useRef(null);
  const scrollLayerRef = useRef(null);
  const particleLayerRef = useRef(null);
  const particlesRef = useRef([]);
  const particleTextureRef = useRef(null);

  // ─── Rebuild callbacks (set once inside init, called by external effects) ────
  const buildGuidesRef = useRef(null);
  const buildPlayBarRef = useRef(null);
  const buildSpritesRef = useRef(null);
  const buildZonesRef = useRef(null);

  // ─── Playback / scroll state refs ────────────────────────────────────────────
  // targetBeatRef: the external target the ticker interpolates displayBeatRef toward.
  const currentBeatRef = useRef(currentBeat);
  const displayBeatRef = useRef(currentBeat);
  const targetBeatRef = useRef(currentBeat);
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

  // ─── Sliding-window culling refs ──────────────────────────────────────────────
  // maxSpriteWidthRef: widest note sprite (px) – used as conservative left-boundary buffer.
  // visWinRef: [start, end) index range into noteSpritesRef that was visible last frame.
  const maxSpriteWidthRef = useRef(0);
  const visWinRef = useRef({ start: 0, end: 0 });

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

  const noteEvents = useMemo(() => {
    if (!displaySong || !Array.isArray(displaySong.tracks)) return [];
    const recorderTrack =
      displaySong.tracks.find((track) => track.instrument === "recorder") ??
      displaySong.tracks[0];

    if (!recorderTrack || !Array.isArray(recorderTrack.actions)) return [];

    const resolver = createFingeringResolver(fingeringSystem);

    return recorderTrack.actions
      .filter((action) => action.type === "note")
      .map((action) => {
        const noteName = getHighestNote(action.pitches ?? action.pitch);
        if (!noteName) return null;
        const fingering = resolver.getPattern(noteName);
        if (!fingering) return null;
        return {
          time: action.time ?? 0,
          duration: action.duration ?? 0,
          note: noteName,
          fingering,
        };
      })
      .filter(Boolean);
  }, [displaySong, fingeringSystem]);

  // ─── Sync simple props into refs ─────────────────────────────────────────────
  useEffect(() => {
    onNoteClickRef.current = onNoteClick;
  }, [onNoteClick]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    canvasWidthRef.current = canvasWidth;
  }, [canvasWidth]);

  // ─── Song fade / transition ───────────────────────────────────────────────────
  useEffect(() => {
    if (song?.id && displaySong?.id === song.id) return;
    const t = setTimeout(() => {
      setSongState({ displaySong: song, isReady: false });
      onReady?.();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [song, displaySong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Beat tracking ────────────────────────────────────────────────────────────
  useEffect(() => {
    currentBeatRef.current = currentBeat;
    targetBeatRef.current = currentBeat;
    if (!isPlayingRef.current) {
      displayBeatRef.current = currentBeat;
    }
    lastFrameTimeRef.current = performance.now();
  }, [currentBeat]);

  // ─── Duration / time-signature changes → rebuild guides ──────────────────────
  useEffect(() => {
    const beatsPerBar = getBeatsPerBar(effectiveTimeSignature);
    const lastBarBeat =
      beatsPerBar > 0
        ? Math.ceil(durationBeats / beatsPerBar) * beatsPerBar
        : durationBeats;
    durationBeatsRef.current = lastBarBeat;
    buildGuidesRef.current?.();
  }, [durationBeats, effectiveTimeSignature]);

  // ─── Note width changes → full scene rebuild + scroll correction ──────────────
  useEffect(() => {
    pixelsPerBeatRef.current = noteWidth;
    buildGuidesRef.current?.();
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
        antialias: true,
        canvas: canvasEl,
      });

      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

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
      guideLayerRef.current = guideLayer;

      const holesLayer = new PIXI.Container();
      holesLayerRef.current = holesLayer;

      const notesLayer = new PIXI.Container();
      notesLayerRef.current = notesLayer;

      const playBarLayer = new PIXI.Container();
      playBarLayerRef.current = playBarLayer;

      const particleLayer = new PIXI.Container();
      particleLayerRef.current = particleLayer;

      // ── Particle texture (shared circle sprite) ──────────────────────────────
      const BIG = 1_000_000;
      const ptGfx = new PIXI.Graphics();
      ptGfx.circle(0, 0, PARTICLE_RADIUS);
      ptGfx.fill({ color: 0xffffff });
      particleTextureRef.current = app.renderer.generateTexture(ptGfx);
      ptGfx.destroy();

      // ── Scroll / zone layers ─────────────────────────────────────────────────
      const scrollLayer = new PIXI.Container();
      scrollLayerRef.current = scrollLayer;

      const zonesLayer = new PIXI.Container();
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

      // ── Static hole guide lines ──────────────────────────────────────────────
      const holePositions = getHolePositions(HOLE_SIZE.y);
      const holesTop =
        (height - (holePositions[NUM_HOLES - 1] + HOLE_SIZE.y)) / 2;
      for (let i = 0; i < NUM_HOLES; i += 1) {
        const cy = holesTop + holePositions[i] + HOLE_SIZE.y / 2;
        const holeLine = new PIXI.Graphics();
        holeLine.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.5 });
        holeLine.moveTo(0, cy);
        holeLine.lineTo(width, cy);
        holeLine.stroke();
        holesLayer.addChild(holeLine);
      }

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

      // ── Builder: note sprites ────────────────────────────────────────────────
      const buildSprites = () => {
        notesLayer.removeChildren();
        noteSpritesRef.current = [];

        const fingeringColors = getFingeringColors();

        noteEvents.forEach((event) => {
          const graphics = new PIXI.Container();
          const durationForWidth = Math.max(event.duration ?? 0, 0);
          const targetWidth = Math.max(
            durationForWidth * (pixelsPerBeatRef.current || 1),
            6,
          );

          const dims = drawFingering(
            graphics,
            event.fingering,
            { x: targetWidth / 1.2, y: HOLE_SIZE.y },
            2,
            fingeringColors,
          );

          const noteHolePositions = getHolePositions(HOLE_SIZE.y);
          const containerY = (height - dims.height) / 2;
          const activeHoles = [];
          for (let i = 0; i < NUM_HOLES; i += 1) {
            const state = event.fingering[i];
            if (!state || state === "0") continue;
            const color = fingeringColors[state];
            if (!color) continue;
            activeHoles.push({
              y: containerY + noteHolePositions[i] + HOLE_SIZE.y / 2,
              color: brightenColor(color, 1.2),
            });
          }

          const container = new PIXI.Container();
          const brightnessFilter = new ColorMatrixFilter();
          graphics.filters = [brightnessFilter];
          const brightnessState = { current: 1.0, target: 1.0 };

          const scaledGraphicsWidth = dims.width;
          const containerOffsetY = (height - dims.height) / 2;

          const hoverBg = new PIXI.Graphics();
          hoverBg.rect(0, -containerOffsetY, scaledGraphicsWidth, height);
          hoverBg.fill({ color: 0xffffff, alpha: 1 });
          hoverBg.alpha = 0;

          const label = new PIXI.Text({
            text: event.note,
            style: {
              fill: 0xffffff,
              fontSize: 14,
              fontFamily: "Iosevka Charon",
            },
          });
          label.x = Math.max((scaledGraphicsWidth - label.width) / 2, 0);
          label.y = -22;

          container.addChild(hoverBg);
          container.addChild(label);
          container.addChild(graphics);

          const hoverState = { targetAlpha: 0 };
          container.eventMode = "static";
          container.hitArea = new PIXI.Rectangle(0, 0, dims.width, dims.height);
          container.on("pointerover", () => {
            if (isPlayingRef.current) return;
            hoverState.targetAlpha = 0.07;
            setIsHoveringNote(true);
          });
          container.on("pointerout", () => {
            hoverState.targetAlpha = 0;
            setIsHoveringNote(false);
          });
          container.on("pointerup", () => {
            if (hasDraggedRef.current || isPlayingRef.current) return;
            onNoteClickRef.current?.({
              note: event.note,
              duration: event.duration,
            });
          });

          container.x =
            -scaledGraphicsWidth - event.time * (pixelsPerBeatRef.current || 1);
          container.y = containerY;
          // Start hidden; the ticker's sliding window will reveal on first frame.
          container.visible = false;
          notesLayer.addChild(container);
          noteSpritesRef.current.push({
            container,
            time: event.time,
            width: scaledGraphicsWidth,
            duration: durationForWidth,
            baseWidth: durationForWidth,
            graphics,
            brightnessFilter,
            brightnessState,
            label,
            hoverBg,
            hoverState,
            activeHoles,
            holeSprites: graphics.holeSprites || [],
            glowPadding: NOTE_GLOW_PADDING,
          });
        });

        // Sort by start time so binary search in the ticker is valid.
        noteSpritesRef.current.sort((a, b) => a.time - b.time);

        // Widest sprite (px) – conservative buffer for the left time boundary.
        maxSpriteWidthRef.current = noteSpritesRef.current.reduce(
          (m, s) => Math.max(m, s.width),
          0,
        );

        // Reset window so the ticker doesn't try to clean up stale indices.
        visWinRef.current = { start: 0, end: 0 };

        requestAnimationFrame(() => {
          if (!cancelled) setSongState((prev) => ({ ...prev, isReady: true }));
        });
      };

      // ── Register builders and do initial draw ────────────────────────────────
      buildGuidesRef.current = buildGuides;
      buildPlayBarRef.current = buildPlayBar;
      buildSpritesRef.current = buildSprites;
      buildZonesRef.current = buildZones;
      buildGuides();
      buildZones();
      buildPlayBar();
      buildSprites();

      // ── Ticker ───────────────────────────────────────────────────────────────
      ticker = app.ticker ?? PIXI.Ticker.shared;
      tick = (tickerArg) => {
        const now = performance.now();
        const elapsed = (now - lastFrameTimeRef.current) / 1000;

        // Project ahead when playing, otherwise hold at current beat.
        const targetBeat = isPlayingRef.current
          ? (currentBeatRef.current ?? 0) +
            elapsed * ((bpmRef.current ?? 120) / 60)
          : (currentBeatRef.current ?? 0);

        const LERP_SPEED = 8;
        const lerpAlpha = 1 - Math.exp(-LERP_SPEED * Math.max(0, elapsed));
        const externalTarget = targetBeatRef.current ?? targetBeat;
        const resolvedTarget = Math.max(targetBeat, externalTarget);

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
        } else {
          scrollLayer.x = currentX + diff * 0.18;
        }
        const actualScrollX = scrollLayer.x;

        // ── Guide visibility culling ───────────────────────────────────────────
        guideLayer.children.forEach((child) => {
          const screenX = actualScrollX + child.x;
          child.visible = screenX > -2 && screenX < width;
        });

        // ── Note sprite updates (sliding-window culling) ───────────────────────
        // Sprites are sorted by `time`. We compute beat-time bounds for the
        // visible screen and binary-search into the array instead of scanning
        // every note.
        //
        // Derivation (container.x = -sprWidth - time * ppb):
        //   screenX            = actualScrollX + container.x
        //                      = actualScrollX - sprWidth - time * ppb
        //   right edge on screen → screenX + sprWidth + glowPad > 0
        //                        → time < (actualScrollX + glowPad) / ppb   [timeMax]
        //   left  edge on screen → screenX - glowPad < width
        //                        → time > (actualScrollX - maxW - glowPad - width) / ppb  [timeMin, conservative]
        {
          const sprites = noteSpritesRef.current;
          const n = sprites.length;
          if (n > 0) {
            const ppb = pixelsPerBeatRef.current || 1;
            const glowPad = NOTE_GLOW_PADDING;
            const maxW = maxSpriteWidthRef.current;

            const timeMax = (actualScrollX + glowPad) / ppb;
            const timeMin = (actualScrollX - maxW - glowPad - width) / ppb;

            // Binary search: first index where time >= timeMin
            let lo = 0;
            let hi = n;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (sprites[mid].time < timeMin) lo = mid + 1;
              else hi = mid;
            }
            const newStart = lo;

            // Binary search: first index where time > timeMax
            lo = 0;
            hi = n;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (sprites[mid].time <= timeMax) lo = mid + 1;
              else hi = mid;
            }
            const newEnd = lo;

            // Hide sprites that slid out of the window on the left
            const prev = visWinRef.current;
            for (let i = prev.start; i < Math.min(prev.end, newStart); i++) {
              sprites[i].container.visible = false;
            }
            // Hide sprites that slid out of the window on the right
            for (let i = Math.max(prev.start, newEnd); i < prev.end; i++) {
              sprites[i].container.visible = false;
            }

            visWinRef.current = { start: newStart, end: newEnd };

            // Process only the candidate window; fine-cull each sprite exactly.
            for (let i = newStart; i < newEnd; i++) {
              const sprite = sprites[i];
              const screenX = actualScrollX + sprite.container.x;
              const isVisible =
                screenX + sprite.width + glowPad > 0 &&
                screenX - glowPad < width;
              sprite.container.visible = isVisible;
              if (!isVisible) continue;

              const isActive =
                beat >= sprite.time && beat < sprite.time + sprite.duration;

              // Hover background fade
              if (sprite.hoverBg && sprite.hoverState) {
                sprite.hoverBg.alpha +=
                  (sprite.hoverState.targetAlpha - sprite.hoverBg.alpha) * 0.2;
              }

              // Brightness pulse on active note
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

              // Hole scale bounce on active note
              if (sprite.holeSprites?.length) {
                sprite.holeSprites.forEach((hole) => {
                  const target = isActive ? HOLE_PLAY_SCALE : 1.0;
                  hole.scale.y += (target - hole.scale.y) * HOLE_SCALE_ALPHA;
                });
              }

              // Particle emission from active holes while playing
              if (
                sprite.activeHoles?.length &&
                particleLayerRef.current &&
                particleTextureRef.current &&
                isActive &&
                isPlayingRef.current &&
                particlesRef.current.length < MAX_PARTICLES
              ) {
                sprite.activeHoles.forEach(({ y, color }) => {
                  if (Math.random() > PARTICLE_SPAWN_CHANCE) return;
                  if (particlesRef.current.length >= MAX_PARTICLES) return;
                  const spr = new PIXI.Sprite(particleTextureRef.current);
                  spr.anchor.set(0.5);
                  spr.tint = 0xffffff;
                  const spawnX = barXRef.current + (Math.random() - 0.5) * 10;
                  const spawnY = y + (Math.random() - 0.5) * 5;
                  spr.x = spawnX;
                  spr.y = spawnY;
                  particleLayerRef.current.addChild(spr);
                  particlesRef.current.push({
                    spr,
                    x: spawnX,
                    y: spawnY,
                    vx: -(Math.random() * 3 + 1),
                    vy: (Math.random() - 0.5) * 2,
                    age: 0,
                    lifetime:
                      PARTICLE_LIFETIME_MIN +
                      Math.random() *
                        (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN),
                    targetColor: color,
                  });
                });
              }
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
            p.spr.destroy();
            particlesRef.current.splice(i, 1);
          }
        }
      };

      ticker.add(tick);
    };

    init();

    return () => {
      cancelled = true;
      if (ticker && tick) ticker.remove(tick);
      if (scrollLayerRef.current) scrollLayerRef.current = null;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      noteSpritesRef.current = [];
      particlesRef.current = [];
      particleTextureRef.current = null;
    };
  }, [noteEvents, width, height, effectiveTimeSignature]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [onScrubStart, onScrub]);

  // ─── Pointer / drag handlers ─────────────────────────────────────────────────
  const handleDragStart = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragStartXRef.current = clientX;

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
  }, []);

  const handleDragMove = useCallback(
    (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const deltaX = clientX - dragStartXRef.current;

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

  const handleDragEnd = useCallback(() => {
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
